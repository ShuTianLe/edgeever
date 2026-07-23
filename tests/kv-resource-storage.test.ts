import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_RESOURCE_STORAGE_LIMIT_BYTES,
  drainResourceGarbageCollection,
  MAX_RESOURCE_VALUE_BYTES,
  ResourceObjectWriteError,
  RESOURCE_GC_BATCH_SIZE,
  resolveResourceStorageLimit,
  trackOrphanedResourceObject,
  writeResourceObjectWithQuota,
} from "../apps/api/src/resource-store";

const repositoryRoot = resolve(import.meta.dir, "..");
const readRepositoryFile = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

describe("Workers KV resource storage", () => {
  test("uses conservative hard limits", () => {
    expect(MAX_RESOURCE_VALUE_BYTES).toBe(25 * 1024 * 1024);
    expect(DEFAULT_RESOURCE_STORAGE_LIMIT_BYTES).toBe(750 * 1024 * 1024);
    expect(RESOURCE_GC_BATCH_SIZE).toBe(200);
    expect(resolveResourceStorageLimit("786432000")).toBe(750 * 1024 * 1024);
    expect(resolveResourceStorageLimit("invalid")).toBe(DEFAULT_RESOURCE_STORAGE_LIMIT_BYTES);
  });

  test("reserves capacity atomically and tracks pending physical deletes", () => {
    const source = readRepositoryFile("apps/api/src/resource-store.ts");
    const migration = readRepositoryFile("migrations/0016_kv_resource_storage.sql");

    expect(source).toContain("used_bytes + reserved_bytes + ? <= ?");
    expect(source).toContain("resource_gc_queue");
    expect(source).toContain('resources.get(objectKey, "stream")');
    expect(migration).toContain("CREATE TABLE resource_storage_usage");
    expect(migration).toContain("CREATE TABLE resource_gc_queue");
  });

  test("rolls back a reservation when a KV write fails", async () => {
    let reservedBytes = 0;
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          sql,
          values: [] as unknown[],
          bind(...values: unknown[]) {
            statement.values = values;
            statements.push(statement);
            return statement;
          },
          async first() {
            reservedBytes += Number(statement.values[0]);
            return { id: 1 };
          },
          async run() {
            reservedBytes = Math.max(0, reservedBytes - Number(statement.values[0]));
            return { success: true };
          },
        };
        return statement;
      },
    } as D1Database;
    const resources = {
      async put() {
        throw new Error("simulated KV write failure");
      },
    } as KVNamespace;

    await expect(
      writeResourceObjectWithQuota(db, resources, "resource-key", new Uint8Array(16), 1024),
    ).rejects.toBeInstanceOf(ResourceObjectWriteError);
    expect(reservedBytes).toBe(0);
    expect(statements.some((statement) => statement.sql.includes("reserved_bytes = MAX(0"))).toBe(true);
  });

  test("queues an orphan after a D1 metadata failure", async () => {
    let batch: unknown[] = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          sql,
          values: [] as unknown[],
          bind(...values: unknown[]) {
            statement.values = values;
            return statement;
          },
        };
        return statement;
      },
      async batch(statements: unknown[]) {
        batch = statements;
        return [];
      },
    } as D1Database;

    await trackOrphanedResourceObject(db, "orphan-key", 512);

    expect(batch).toHaveLength(2);
    expect(JSON.stringify(batch)).toContain("resource_gc_queue");
    expect(JSON.stringify(batch)).toContain("used_bytes = used_bytes +");
  });

  test("keeps failed cleanup entries queued for retry", async () => {
    let failureUpdates = 0;
    let batchCalls = 0;
    const db = {
      prepare(sql: string) {
        const statement = {
          sql,
          bind() {
            return statement;
          },
          async all() {
            return { results: [{ object_key: "pending-key", byte_size: 256 }] };
          },
          async run() {
            if (sql.includes("attempts = attempts + 1")) failureUpdates += 1;
            return { success: true };
          },
        };
        return statement;
      },
      async batch() {
        batchCalls += 1;
        return [];
      },
    } as D1Database;
    const resources = {
      async delete() {
        throw new Error("simulated KV delete failure");
      },
    } as KVNamespace;

    const result = await drainResourceGarbageCollection(db, resources);

    expect(result).toEqual({ deleted: 0, attempted: 1 });
    expect(failureUpdates).toBe(1);
    expect(batchCalls).toBe(0);
  });

  test("releases physical capacity only after KV deletion succeeds", async () => {
    let deletedKey = "";
    let batch: unknown[] = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          sql,
          values: [] as unknown[],
          bind(...values: unknown[]) {
            statement.values = values;
            return statement;
          },
          async all() {
            return { results: [{ object_key: "cleanup-key", byte_size: 1024 }] };
          },
        };
        return statement;
      },
      async batch(statements: unknown[]) {
        batch = statements;
        return [];
      },
    } as D1Database;
    const resources = {
      async delete(key: string) {
        deletedKey = key;
      },
    } as KVNamespace;

    const result = await drainResourceGarbageCollection(db, resources);

    expect(result).toEqual({ deleted: 1, attempted: 1 });
    expect(deletedKey).toBe("cleanup-key");
    expect(batch).toHaveLength(2);
    expect(JSON.stringify(batch)).toContain("DELETE FROM resource_gc_queue");
    expect(JSON.stringify(batch)).toContain("used_bytes = MAX(0, used_bytes - ?)");
  });

  test("cannot silently regain an R2 runtime dependency", () => {
    const workerSource = readRepositoryFile("apps/api/src/index.ts");
    const wranglerConfig = readRepositoryFile("wrangler.toml");
    const deploymentScript = readRepositoryFile("scripts/cloudflare-deploy.mjs");
    const wranglerRunner = readRepositoryFile("scripts/run-wrangler.mjs");

    expect(workerSource).not.toContain("R2Bucket");
    expect(wranglerConfig).toContain("[[kv_namespaces]]");
    expect(wranglerConfig).not.toContain("[[r2_buckets]]");
    expect(deploymentScript).not.toContain('["r2", "bucket"');
    expect(deploymentScript).toContain('["kv", "namespace", "create"');
    expect(wranglerRunner).toContain("isDeployCommand && !isDryRun");
  });

  test("documents KV quota and propagation responses", () => {
    const openApi = JSON.parse(readRepositoryFile("docs/openapi.json"));
    const upload = openApi.paths["/api/v1/memos/{id}/resources"].post;
    const summary = openApi.components.schemas.ResourceStorageSummary;

    expect(upload.description).toContain("25 MiB");
    expect(upload.responses["507"]).toBeDefined();
    expect(upload.requestBody["507"]).toBeUndefined();
    expect(summary.required).toContain("storedBytes");
    expect(summary.required).toContain("storageLimitBytes");
    expect(summary.required).toContain("pendingDeletionBytes");
  });

  test("keeps resource export SQL aliases valid", () => {
    const workerSource = readRepositoryFile("apps/api/src/index.ts");

    expect(workerSource).toContain("FROM resources r\n       WHERE is_deleted = 0");
  });
});
