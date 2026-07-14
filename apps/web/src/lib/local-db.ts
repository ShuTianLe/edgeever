import type { TiptapDoc } from "@edgeever/shared";
import Dexie, { type Table } from "dexie";

export type LocalDraft = {
  memoId: string;
  expectedRevision?: number;
  title: string;
  contentJson: TiptapDoc;
  tagsText: string;
  updatedAt: string;
};

export type MemoUpdateSyncPayload = {
  memoId: string;
  expectedRevision: number;
  expectedContentHash: string;
  editSessionId: string;
  title: string;
  contentJson: TiptapDoc;
  contentMarkdown?: string;
  tags: string[];
};

export type SyncQueueItem = {
  id: string;
  kind: "memo.update";
  memoId: string;
  status: "pending" | "syncing" | "conflict" | "error";
  payload: MemoUpdateSyncPayload;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
};

class EdgeEverLocalDb extends Dexie {
  drafts!: Table<LocalDraft, string>;
  syncQueue!: Table<SyncQueueItem, string>;

  constructor() {
    super("edgeever-local");
    this.version(1).stores({
      drafts: "memoId, updatedAt",
    });
    this.version(2).stores({
      drafts: "memoId, updatedAt",
      syncQueue: "id, memoId, status, updatedAt, nextAttemptAt",
    });
  }
}

export const localDb = new EdgeEverLocalDb();
