const { DatabaseSync } = require("node:sqlite");
const { applyBulkOperation } = require("./bulk-operations.cjs");

const db = new DatabaseSync(":memory:");
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE content_items (
  key TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  from_key TEXT NOT NULL REFERENCES content_items(key) ON DELETE CASCADE,
  to_key TEXT NOT NULL REFERENCES content_items(key) ON DELETE CASCADE
);
INSERT INTO content_items (key,id,kind,title,status) VALUES
  ('a','a','video','A','draft'),
  ('b','b','character','B','draft'),
  ('c','c','event','C','published');
INSERT INTO relations (id,from_key,to_key) VALUES
  ('ab','a','b'),
  ('bc','b','c');
`);

let result = applyBulkOperation(db, { action: "publish", keys: ["a", "b", "missing"] });
if (result.affected !== 2 || result.missing !== 1) throw new Error("publish affected/missing count mismatch");
if (db.prepare("SELECT COUNT(*) AS count FROM content_items WHERE key IN ('a','b') AND status='published'").get().count !== 2) {
  throw new Error("bulk publish failed");
}

result = applyBulkOperation(db, { action: "draft", keys: ["b"] });
if (result.affected !== 1 || db.prepare("SELECT status FROM content_items WHERE key='b'").get().status !== "draft") {
  throw new Error("bulk draft failed");
}

result = applyBulkOperation(db, { action: "delete", keys: ["b", "already-gone"] });
if (result.affected !== 1 || result.missing !== 1 || result.affectedRelations !== 2) throw new Error("bulk delete relation count mismatch");
if (db.prepare("SELECT COUNT(*) AS count FROM content_items WHERE key='b'").get().count !== 0) throw new Error("bulk delete failed");
if (db.prepare("SELECT COUNT(*) AS count FROM relations").get().count !== 0) throw new Error("cascade delete failed");

let rejected = false;
try { applyBulkOperation(db, { action: "publish", keys: [] }); } catch { rejected = true; }
if (!rejected) throw new Error("empty bulk selection should be rejected");

console.log("Studio bulk operations: OK");
