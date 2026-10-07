import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

// One SQLite file on the mounted volume: /data survives a restart or a
// redeploy, nothing else does (see fly.toml). DATA_DIR overrides it for a
// local run, where there's no volume.
const dataDir = process.env.DATA_DIR ?? "/data";
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(`${dataDir}/marks.sqlite`);

db.exec(`
  create table if not exists marks (
    id integer primary key autoincrement,
    visitor_id text not null,
    name text not null,
    body text not null,
    created_at text not null
  )
`);

// The live volume already has a `marks` table from before `website` existed,
// so the column is added in place rather than in the create statement above.
// Checking first keeps this safe to run on every boot.
const columns = db.prepare("pragma table_info(marks)").all() as { name: string }[];
if (!columns.some((c) => c.name === "website")) {
  db.exec("alter table marks add column website text");
}

export interface Mark {
  id: number;
  visitor_id: string;
  name: string;
  body: string;
  website: string | null;
  created_at: string;
}

const insertStmt = db.prepare(
  "insert into marks (visitor_id, name, body, website, created_at) values (?, ?, ?, ?, ?) returning *",
);
const listStmt = db.prepare("select * from marks order by id desc");
const afterStmt = db.prepare("select * from marks where id > ? order by id asc");

export function insertMark(
  visitorId: string,
  name: string,
  body: string,
  website: string | null,
): Mark {
  return insertStmt.get(visitorId, name, body, website, new Date().toISOString()) as unknown as Mark;
}

export function listMarks(): Mark[] {
  return listStmt.all() as unknown as Mark[];
}

// Oldest first, so a reconnecting client can replay what it missed in order.
export function marksAfter(id: number): Mark[] {
  return afterStmt.all(id) as unknown as Mark[];
}
