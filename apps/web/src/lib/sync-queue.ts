import type { MemoDetail, TiptapDoc } from "@edgeever/shared";
import { liveQuery } from "dexie";
import { ApiRequestError, api } from "@/lib/api";
import { localDb, type MemoUpdateSyncPayload, type SyncQueueItem } from "@/lib/local-db";

export type SyncQueueSummary = {
  total: number;
  pending: number;
  syncing: number;
  conflict: number;
  error: number;
};

export type SyncRunResult = {
  attempted: number;
  synced: number;
  failed: number;
  conflicted: number;
};

export const emptySyncQueueSummary = (): SyncQueueSummary => ({
  total: 0,
  pending: 0,
  syncing: 0,
  conflict: 0,
  error: 0,
});

export const getMemoUpdateQueueId = (memoId: string) => `memo.update:${memoId}`;

export const queueMemoUpdate = async (payload: MemoUpdateSyncPayload) => {
  const id = getMemoUpdateQueueId(payload.memoId);
  const now = new Date().toISOString();
  const existing = await localDb.syncQueue.get(id);

  await localDb.syncQueue.put({
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
  });
};

export const observeSyncQueue = (onChange: (summary: SyncQueueSummary) => void) => {
  const subscription = liveQuery(async () => summarizeSyncQueue(await localDb.syncQueue.toArray())).subscribe({
    next: onChange,
    error: () => onChange(emptySyncQueueSummary()),
  });

  return () => subscription.unsubscribe();
};

export const syncQueuedChanges = async (options: {
  onSynced?: (memo: MemoDetail) => void | Promise<void>;
} = {}): Promise<SyncRunResult> => {
  const result: SyncRunResult = {
    attempted: 0,
    synced: 0,
    failed: 0,
    conflicted: 0,
  };

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return result;
  }

  const now = new Date();
  const items = (await localDb.syncQueue.where("status").anyOf("pending", "error").toArray())
    .filter((item) => !item.nextAttemptAt || new Date(item.nextAttemptAt) <= now)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  for (const item of items) {
    result.attempted += 1;
    await localDb.syncQueue.update(item.id, {
      status: "syncing",
      updatedAt: new Date().toISOString(),
    });

    try {
      const memo = await syncQueueItem(item);
      await localDb.syncQueue.delete(item.id);
      await localDb.drafts.delete(item.memoId);
      await options.onSynced?.(memo);
      result.synced += 1;
    } catch (error) {
      const status = isRevisionConflict(error) ? "conflict" : "error";
      const attemptCount = item.attemptCount + 1;

      await localDb.syncQueue.update(item.id, {
        status,
        attemptCount,
        lastError: getErrorMessage(error),
        nextAttemptAt: status === "error" ? nextRetryAt(attemptCount) : null,
        updatedAt: new Date().toISOString(),
      });

      if (status === "conflict") {
        result.conflicted += 1;
      } else {
        result.failed += 1;
      }
    }
  }

  return result;
};

export const shouldQueueMemoSaveError = (error: unknown) => {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return true;
  }

  if (error instanceof ApiRequestError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }

  return error instanceof TypeError;
};

const syncQueueItem = async (item: SyncQueueItem): Promise<MemoDetail> => {
  if (item.kind !== "memo.update") {
    throw new Error(`Unsupported sync item kind: ${item.kind}`);
  }

  const { editSession } = await api.createMemoEditSession(item.memoId);
  if (
    editSession.baseRevision !== item.payload.expectedRevision ||
    editSession.baseContentHash !== item.payload.expectedContentHash
  ) {
    throw new ApiRequestError("Note changed before the offline draft could sync.", 409, "revision_conflict");
  }

  const data = await api.updateMemo(item.memoId, {
    expectedRevision: item.payload.expectedRevision,
    expectedContentHash: item.payload.expectedContentHash,
    editSessionId: editSession.id,
    title: item.payload.title,
    contentJson: item.payload.contentJson as TiptapDoc,
    contentMarkdown: item.payload.contentMarkdown,
    tags: item.payload.tags,
  });

  return data.memo;
};

const summarizeSyncQueue = (items: SyncQueueItem[]): SyncQueueSummary =>
  items.reduce(
    (summary, item) => {
      summary.total += 1;
      summary[item.status] += 1;
      return summary;
    },
    emptySyncQueueSummary()
  );

const isRevisionConflict = (error: unknown) =>
  error instanceof ApiRequestError && error.code === "revision_conflict";

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return "Sync failed";
};

const nextRetryAt = (attemptCount: number) => {
  const delayMs = Math.min(5 * 60_000, 2 ** Math.min(attemptCount, 6) * 1000);
  return new Date(Date.now() + delayMs).toISOString();
};
