PRAGMA foreign_keys = ON;

CREATE TABLE mobile_sync_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('notebook', 'memo')),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_mobile_sync_changes_workspace_cursor
  ON mobile_sync_changes(workspace_id, id);

CREATE TRIGGER trg_mobile_sync_notebooks_insert
AFTER INSERT ON notebooks
BEGIN
  INSERT INTO mobile_sync_changes (workspace_id, entity_type, entity_id, operation)
  VALUES (NEW.workspace_id, 'notebook', NEW.id, 'upsert');
END;

CREATE TRIGGER trg_mobile_sync_notebooks_update
AFTER UPDATE ON notebooks
BEGIN
  INSERT INTO mobile_sync_changes (workspace_id, entity_type, entity_id, operation)
  VALUES (NEW.workspace_id, 'notebook', NEW.id, CASE WHEN NEW.is_deleted = 1 THEN 'delete' ELSE 'upsert' END);
END;

CREATE TRIGGER trg_mobile_sync_notebooks_delete
AFTER DELETE ON notebooks
BEGIN
  INSERT INTO mobile_sync_changes (workspace_id, entity_type, entity_id, operation)
  VALUES (OLD.workspace_id, 'notebook', OLD.id, 'delete');
END;

CREATE TRIGGER trg_mobile_sync_memos_insert
AFTER INSERT ON memos
BEGIN
  INSERT INTO mobile_sync_changes (workspace_id, entity_type, entity_id, operation)
  VALUES (NEW.workspace_id, 'memo', NEW.id, 'upsert');
END;

CREATE TRIGGER trg_mobile_sync_memos_update
AFTER UPDATE ON memos
BEGIN
  INSERT INTO mobile_sync_changes (workspace_id, entity_type, entity_id, operation)
  VALUES (NEW.workspace_id, 'memo', NEW.id, 'upsert');
END;

CREATE TRIGGER trg_mobile_sync_memos_delete
AFTER DELETE ON memos
BEGIN
  INSERT INTO mobile_sync_changes (workspace_id, entity_type, entity_id, operation)
  VALUES (OLD.workspace_id, 'memo', OLD.id, 'delete');
END;
