export const DEFAULT_RESOURCE_STORAGE_LIMIT_BYTES = 750 * 1024 * 1024;
export const MAX_RESOURCE_VALUE_BYTES = 25 * 1024 * 1024;
export const RESOURCE_GC_BATCH_SIZE = 200;

type ResourceStorageUsageRow = {
  used_bytes: number;
  reserved_bytes: number;
  pending_deletion_bytes: number;
};

type ResourceGarbageCollectionRow = {
  object_key: string;
  byte_size: number;
};

export type ResourceStorageUsage = {
  usedBytes: number;
  reservedBytes: number;
  pendingDeletionBytes: number;
};

export class ResourceStorageQuotaExceededError extends Error {
  constructor() {
    super("Resource storage quota exceeded.");
    this.name = "ResourceStorageQuotaExceededError";
  }
}

export class ResourceObjectWriteError extends Error {
  readonly storageError: unknown;
  readonly reservationReleaseError: unknown;

  constructor(storageError: unknown, reservationReleaseError?: unknown) {
    super("Workers KV resource write failed.");
    this.name = "ResourceObjectWriteError";
    this.storageError = storageError;
    this.reservationReleaseError = reservationReleaseError;
  }
}

export const resolveResourceStorageLimit = (value: string | undefined) => {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return DEFAULT_RESOURCE_STORAGE_LIMIT_BYTES;
  }

  return parsed;
};

export const reserveResourceStorage = async (
  db: D1Database,
  byteSize: number,
  storageLimitBytes: number,
) => {
  const reserved = await db
    .prepare(
      `UPDATE resource_storage_usage
       SET reserved_bytes = reserved_bytes + ?, updated_at = ?
       WHERE id = 1 AND used_bytes + reserved_bytes + ? <= ?
       RETURNING id`,
    )
    .bind(byteSize, new Date().toISOString(), byteSize, storageLimitBytes)
    .first<{ id: number }>();

  if (!reserved) {
    throw new ResourceStorageQuotaExceededError();
  }
};

export const releaseResourceStorageReservation = async (
  db: D1Database,
  byteSize: number,
) => {
  await db
    .prepare(
      `UPDATE resource_storage_usage
       SET reserved_bytes = MAX(0, reserved_bytes - ?), updated_at = ?
       WHERE id = 1`,
    )
    .bind(byteSize, new Date().toISOString())
    .run();
};

export const commitResourceStorageReservationStatement = (
  db: D1Database,
  byteSize: number,
) =>
  db
    .prepare(
      `UPDATE resource_storage_usage
       SET used_bytes = used_bytes + ?,
           reserved_bytes = MAX(0, reserved_bytes - ?),
           updated_at = ?
       WHERE id = 1`,
    )
    .bind(byteSize, byteSize, new Date().toISOString());

export const enqueueResourceDeletionStatement = (
  db: D1Database,
  objectKey: string,
  byteSize: number,
) =>
  db
    .prepare(
      `INSERT INTO resource_gc_queue (
         object_key, byte_size, attempts, last_error, created_at, updated_at
       ) VALUES (?, ?, 0, NULL, ?, ?)
       ON CONFLICT(object_key) DO NOTHING`,
    )
    .bind(objectKey, byteSize, new Date().toISOString(), new Date().toISOString());

export const trackOrphanedResourceObject = async (
  db: D1Database,
  objectKey: string,
  byteSize: number,
) => {
  await db.batch([
    enqueueResourceDeletionStatement(db, objectKey, byteSize),
    commitResourceStorageReservationStatement(db, byteSize),
  ]);
};

export const getResourceStorageUsage = async (
  db: D1Database,
): Promise<ResourceStorageUsage> => {
  const row = await db
    .prepare(
      `SELECT used_bytes, reserved_bytes,
              COALESCE((SELECT SUM(byte_size) FROM resource_gc_queue), 0) AS pending_deletion_bytes
       FROM resource_storage_usage
       WHERE id = 1`,
    )
    .first<ResourceStorageUsageRow>();

  return {
    usedBytes: row?.used_bytes ?? 0,
    reservedBytes: row?.reserved_bytes ?? 0,
    pendingDeletionBytes: row?.pending_deletion_bytes ?? 0,
  };
};

export const recalculateResourceStorageUsage = async (db: D1Database) => {
  await db
    .prepare(
      `UPDATE resource_storage_usage
       SET used_bytes =
             COALESCE((SELECT SUM(byte_size) FROM resources), 0)
             + COALESCE((SELECT SUM(byte_size) FROM resource_gc_queue), 0),
           reserved_bytes = 0,
           updated_at = ?
       WHERE id = 1`,
    )
    .bind(new Date().toISOString())
    .run();
};

export const putResourceObject = (
  resources: KVNamespace,
  objectKey: string,
  bytes: Uint8Array,
) => resources.put(objectKey, bytes);

export const writeResourceObjectWithQuota = async (
  db: D1Database,
  resources: KVNamespace,
  objectKey: string,
  bytes: Uint8Array,
  storageLimitBytes: number,
) => {
  await reserveResourceStorage(db, bytes.byteLength, storageLimitBytes);

  try {
    await putResourceObject(resources, objectKey, bytes);
  } catch (storageError) {
    let reservationReleaseError: unknown;

    try {
      await releaseResourceStorageReservation(db, bytes.byteLength);
    } catch (error) {
      reservationReleaseError = error;
    }

    throw new ResourceObjectWriteError(storageError, reservationReleaseError);
  }
};

export const getResourceObject = (
  resources: KVNamespace,
  objectKey: string,
) => resources.get(objectKey, "stream");

export const drainResourceGarbageCollection = async (
  db: D1Database,
  resources: KVNamespace,
  limit = RESOURCE_GC_BATCH_SIZE,
) => {
  const rows = await db
    .prepare(
      `SELECT object_key, byte_size
       FROM resource_gc_queue
       ORDER BY created_at ASC, object_key ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<ResourceGarbageCollectionRow>();

  let deleted = 0;

  for (const row of rows.results) {
    try {
      await resources.delete(row.object_key);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .prepare(
          `UPDATE resource_gc_queue
           SET attempts = attempts + 1, last_error = ?, updated_at = ?
           WHERE object_key = ?`,
        )
        .bind(message.slice(0, 500), new Date().toISOString(), row.object_key)
        .run();
      break;
    }

    await db.batch([
      db.prepare(`DELETE FROM resource_gc_queue WHERE object_key = ?`).bind(row.object_key),
      db
        .prepare(
          `UPDATE resource_storage_usage
           SET used_bytes = MAX(0, used_bytes - ?), updated_at = ?
           WHERE id = 1`,
        )
        .bind(row.byte_size, new Date().toISOString()),
    ]);
    deleted += 1;
  }

  return { deleted, attempted: rows.results.length };
};
