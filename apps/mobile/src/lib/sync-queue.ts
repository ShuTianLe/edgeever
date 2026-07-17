import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiRequestError, type createEdgeEverClient } from "@edgeever/client";
import type { MemoDetail } from "@edgeever/shared";

const LEGACY_SYNC_QUEUE_KEY = "edgeever.mobile.syncQueue.v1";
const SYNC_QUEUE_KEY_PREFIX = "edgeever.mobile.syncQueue.v2";

export type MobileMemoUpdateSyncPayload = {
  memoId: string;
  expectedRevision: number;
  expectedContentHash: string;
  title: string;
  contentMarkdown: string;
  notebookId: string;
  tags: string[];
};

export type MobileMemoCreateSyncPayload = {
  memoId: string;
  title: string;
  contentMarkdown: string;
  notebookId: string;
  tags: string[];
  createdAt: string;
};

type MobileSyncQueueItemBase = {
  id: string;
  memoId: string;
  status: "pending" | "syncing" | "conflict" | "error";
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type MobileMemoUpdateSyncQueueItem = MobileSyncQueueItemBase & {
  kind: "memo.update";
  payload: MobileMemoUpdateSyncPayload;
};

export type MobileMemoCreateSyncQueueItem = MobileSyncQueueItemBase & {
  kind: "memo.create";
  payload: MobileMemoCreateSyncPayload;
};

export type MobileSyncQueueItem = MobileMemoUpdateSyncQueueItem | MobileMemoCreateSyncQueueItem;

let syncQueueWriteChain: Promise<void> = Promise.resolve();

export type MobileSyncQueueSummary = {
  total: number;
  pending: number;
  syncing: number;
  conflict: number;
  error: number;
};

export type MobileSyncRunResult = {
  attempted: number;
  synced: number;
  failed: number;
  conflicted: number;
};

export const emptyMobileSyncQueueSummary = (): MobileSyncQueueSummary => ({
  total: 0,
  pending: 0,
  syncing: 0,
  conflict: 0,
  error: 0,
});

export const getMobileMemoUpdateQueueId = (memoId: string) => `memo.update:${memoId}`;
export const getMobileMemoCreateQueueId = (memoId: string) => `memo.create:${memoId}`;

export const queueMobileMemoCreate = async (scope: string, payload: MobileMemoCreateSyncPayload) => {
  const now = new Date().toISOString();
  const id = getMobileMemoCreateQueueId(payload.memoId);
  await mutateMobileSyncQueue(scope, (items) => {
    const existing = items.find((item) => item.id === id);
    const nextItem: MobileMemoCreateSyncQueueItem = {
      id,
      kind: "memo.create",
      memoId: payload.memoId,
      status: "pending",
      payload,
      attemptCount: existing?.attemptCount ?? 0,
      lastError: null,
      nextAttemptAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
    };
    return [nextItem, ...items.filter((item) => item.id !== id)];
  });
  return summarizeMobileSyncQueue(await readMobileSyncQueue(scope));
};

export const queueMobileMemoUpdate = async (scope: string, payload: MobileMemoUpdateSyncPayload) => {
  const now = new Date().toISOString();
  const id = getMobileMemoUpdateQueueId(payload.memoId);
  await mutateMobileSyncQueue(scope, (items) => {
    const pendingCreate = items.find((item): item is MobileMemoCreateSyncQueueItem => item.kind === "memo.create" && item.memoId === payload.memoId);
    if (pendingCreate) {
      return items.map((item) => item.id === pendingCreate.id ? {
        ...pendingCreate,
        status: "pending",
        payload: {
          ...pendingCreate.payload,
          title: payload.title,
          contentMarkdown: payload.contentMarkdown,
          notebookId: payload.notebookId,
          tags: payload.tags,
        },
        lastError: null,
        nextAttemptAt: null,
        updatedAt: now,
        version: pendingCreate.version + 1,
      } : item);
    }
    const existing = items.find((item) => item.id === id);
    const nextItem: MobileMemoUpdateSyncQueueItem = {
      id,
      kind: "memo.update",
      memoId: payload.memoId,
      status: "pending",
      payload,
      attemptCount: existing?.attemptCount ?? 0,
      lastError: null,
      nextAttemptAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
    };

    return [nextItem, ...items.filter((item) => item.id !== id)];
  });
  return summarizeMobileSyncQueue(await readMobileSyncQueue(scope));
};

export const loadMobileSyncQueueSummary = async (scope: string) => summarizeMobileSyncQueue(await readMobileSyncQueue(scope));

export const getMobileSyncRetryDelay = async (scope: string) => {
  const now = Date.now();
  const retryTimes = (await readMobileSyncQueue(scope))
    .filter((item) => item.status === "pending" || item.status === "error" || item.status === "syncing")
    .map((item) => (item.nextAttemptAt ? Date.parse(item.nextAttemptAt) : now))
    .filter(Number.isFinite);

  if (retryTimes.length === 0) {
    return null;
  }

  return Math.max(250, Math.min(...retryTimes) - now);
};

export const listMobileSyncQueueItems = async (scope: string) =>
  (await readMobileSyncQueue(scope)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

export const deleteMobileSyncQueueItem = async (scope: string, id: string) => {
  await removeMobileSyncQueueItem(scope, id);
  return loadMobileSyncQueueSummary(scope);
};

export const syncMobileQueuedChanges = async (
  client: ReturnType<typeof createEdgeEverClient>,
  scope: string,
  options: {
    onSynced?: (memo: MemoDetail, item: MobileSyncQueueItem) => void | Promise<void>;
  } = {}
): Promise<MobileSyncRunResult> => {
  const result: MobileSyncRunResult = {
    attempted: 0,
    synced: 0,
    failed: 0,
    conflicted: 0,
  };
  const now = new Date();
  const items = (await readMobileSyncQueue(scope))
    .filter((item) => item.status === "pending" || item.status === "error" || item.status === "syncing")
    .filter((item) => !item.nextAttemptAt || new Date(item.nextAttemptAt) <= now)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  for (const item of items) {
    const itemVersion = item.version ?? 1;
    result.attempted += 1;
    await updateMobileSyncQueueItem(scope, item.id, {
      status: "syncing",
      updatedAt: new Date().toISOString(),
    }, itemVersion);

    try {
      const memo = await syncMobileQueueItem(client, item);
      const removed = await removeMobileSyncQueueItem(scope, item.id, itemVersion);

      if (removed) {
        await options.onSynced?.(memo, item);
      } else if (item.kind === "memo.create") {
        await promoteQueuedMemoCreate(scope, item.id, itemVersion, memo);
        await options.onSynced?.(memo, item);
      } else {
        await rebaseQueuedMemoUpdate(scope, item.id, itemVersion, memo);
      }
      result.synced += 1;
    } catch (error) {
      const status = isRevisionConflict(error) ? "conflict" : "error";
      const attemptCount = item.attemptCount + 1;

      await updateMobileSyncQueueItem(scope, item.id, {
        status,
        attemptCount,
        lastError: getErrorMessage(error),
        nextAttemptAt: status === "error" ? nextRetryAt(attemptCount) : null,
        updatedAt: new Date().toISOString(),
      }, itemVersion);

      if (status === "conflict") {
        result.conflicted += 1;
      } else {
        result.failed += 1;
      }
    }
  }

  return result;
};

export const shouldQueueMobileMemoSaveError = (error: unknown) => {
  if (error instanceof ApiRequestError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }

  return error instanceof TypeError || getErrorMessage(error).toLowerCase().includes("network");
};

const syncMobileQueueItem = async (client: ReturnType<typeof createEdgeEverClient>, item: MobileSyncQueueItem) => {
  if (item.kind === "memo.create") {
    const response = await client.createMemo({
      notebookId: item.payload.notebookId,
      title: item.payload.title,
      contentMarkdown: item.payload.contentMarkdown,
      tags: item.payload.tags,
      createdAt: item.payload.createdAt,
      updatedAt: item.updatedAt,
    });
    return response.memo;
  }

  const { editSession } = await client.createMemoEditSession(item.memoId);

  if (
    editSession.baseRevision !== item.payload.expectedRevision ||
    editSession.baseContentHash !== item.payload.expectedContentHash
  ) {
    throw new ApiRequestError("Note changed before the offline draft could sync.", 409, "revision_conflict");
  }

  const response = await client.updateMemo(item.memoId, {
    expectedRevision: item.payload.expectedRevision,
    expectedContentHash: item.payload.expectedContentHash,
    editSessionId: editSession.id,
    title: item.payload.title,
    contentMarkdown: item.payload.contentMarkdown,
    notebookId: item.payload.notebookId,
    tags: item.payload.tags,
  });

  return response.memo;
};

const readMobileSyncQueue = async (scope: string): Promise<MobileSyncQueueItem[]> => {
  const storageKey = getSyncQueueStorageKey(scope);
  let rawValue = await AsyncStorage.getItem(storageKey);

  if (!rawValue) {
    const legacyValue = await AsyncStorage.getItem(LEGACY_SYNC_QUEUE_KEY);
    if (legacyValue) {
      rawValue = legacyValue;
      await AsyncStorage.setItem(storageKey, legacyValue);
      await AsyncStorage.removeItem(LEGACY_SYNC_QUEUE_KEY);
    }
  }

  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed.filter(isMobileSyncQueueItem) : [];
  } catch {
    return [];
  }
};

const writeMobileSyncQueue = (scope: string, items: MobileSyncQueueItem[]) =>
  AsyncStorage.setItem(getSyncQueueStorageKey(scope), JSON.stringify(items));

const updateMobileSyncQueueItem = async (scope: string, id: string, patch: Partial<MobileSyncQueueItemBase>, expectedVersion?: number) => {
  let updated = false;
  await mutateMobileSyncQueue(scope, (items) =>
    items.map((item) => {
      if (item.id !== id || (expectedVersion !== undefined && (item.version ?? 1) !== expectedVersion)) {
        return item;
      }

      updated = true;
      return { ...item, ...patch };
    })
  );
  return updated;
};

const removeMobileSyncQueueItem = async (scope: string, id: string, expectedVersion?: number) => {
  let removed = false;
  await mutateMobileSyncQueue(scope, (items) =>
    items.filter((item) => {
      if (item.id !== id || (expectedVersion !== undefined && (item.version ?? 1) !== expectedVersion)) {
        return true;
      }

      removed = true;
      return false;
    })
  );
  return removed;
};

const rebaseQueuedMemoUpdate = async (scope: string, id: string, syncedVersion: number, memo: MemoDetail) => {
  await mutateMobileSyncQueue(scope, (items) =>
    items.map((item) => {
      if (item.id !== id || item.kind !== "memo.update" || (item.version ?? 1) <= syncedVersion) {
        return item;
      }

      return {
        ...item,
        payload: {
          ...item.payload,
          expectedRevision: memo.revision,
          expectedContentHash: memo.contentHash,
        },
        status: "pending",
        lastError: null,
        nextAttemptAt: null,
        updatedAt: new Date().toISOString(),
      };
    })
  );
};

const promoteQueuedMemoCreate = async (scope: string, id: string, syncedVersion: number, memo: MemoDetail) => {
  await mutateMobileSyncQueue(scope, (items) => {
    const current = items.find((item) => item.id === id);
    if (!current || current.kind !== "memo.create" || current.version <= syncedVersion) {
      return items;
    }
    const now = new Date().toISOString();
    const promoted: MobileMemoUpdateSyncQueueItem = {
      id: getMobileMemoUpdateQueueId(memo.id),
      kind: "memo.update",
      memoId: memo.id,
      status: "pending",
      payload: {
        memoId: memo.id,
        expectedRevision: memo.revision,
        expectedContentHash: memo.contentHash,
        title: current.payload.title,
        contentMarkdown: current.payload.contentMarkdown,
        notebookId: current.payload.notebookId,
        tags: current.payload.tags,
      },
      attemptCount: 0,
      lastError: null,
      nextAttemptAt: null,
      createdAt: current.createdAt,
      updatedAt: now,
      version: 1,
    };
    return [promoted, ...items.filter((item) => item.id !== id && item.id !== promoted.id)];
  });
};

const mutateMobileSyncQueue = async (scope: string, mutate: (items: MobileSyncQueueItem[]) => MobileSyncQueueItem[]) => {
  const operation = syncQueueWriteChain.then(async () => {
    const items = await readMobileSyncQueue(scope);
    await writeMobileSyncQueue(scope, mutate(items));
  });

  syncQueueWriteChain = operation.catch(() => undefined);
  await operation;
};

const getSyncQueueStorageKey = (scope: string) => `${SYNC_QUEUE_KEY_PREFIX}:${encodeURIComponent(scope.trim().toLowerCase())}`;

const summarizeMobileSyncQueue = (items: MobileSyncQueueItem[]) =>
  items.reduce((summary, item) => {
    summary.total += 1;
    summary[item.status] += 1;
    return summary;
  }, emptyMobileSyncQueueSummary());

const isMobileSyncQueueItem = (value: unknown): value is MobileSyncQueueItem => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<MobileSyncQueueItem>;
  return (item.kind === "memo.update" || item.kind === "memo.create") && typeof item.id === "string" && typeof item.memoId === "string" && Boolean(item.payload);
};

const isRevisionConflict = (error: unknown) => error instanceof ApiRequestError && error.code === "revision_conflict";

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : "Sync failed");

const nextRetryAt = (attemptCount: number) => {
  const delayMs = Math.min(5 * 60_000, 2 ** Math.min(attemptCount, 6) * 1000);
  return new Date(Date.now() + delayMs).toISOString();
};
