/** SQLite statements are fixed package-owned contracts; caller values are always bound. */
export const LogSql = {
  initialize: `PRAGMA journal_mode=DELETE; PRAGMA locking_mode=EXCLUSIVE; PRAGMA busy_timeout=0; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS meta(id INTEGER PRIMARY KEY CHECK(id=1),last_seq INTEGER NOT NULL,time REAL NOT NULL,floor INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS records(seq INTEGER PRIMARY KEY,time REAL NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL); INSERT OR IGNORE INTO meta VALUES(1,0,0,1); COMMIT;`,
  meta: 'SELECT last_seq,time,floor FROM meta WHERE id=1',
  records: 'SELECT seq,time,kind,payload,state FROM records ORDER BY seq',
  begin: 'BEGIN EXCLUSIVE',
  commit: 'COMMIT',
  rollback: 'ROLLBACK',
  append: 'INSERT INTO records(seq,time,kind,payload,state) VALUES(?,?,?,?,?)',
  appendMeta: 'UPDATE meta SET last_seq=?,time=? WHERE id=1',
  truncate: 'DELETE FROM records WHERE seq<?',
  floor: 'UPDATE meta SET floor=? WHERE id=1',
  state: 'UPDATE records SET state=? WHERE seq=?'
} as const
/** SQLite builtin module names stay lazy and out of browser-safe barrels. */
export const LogSqliteModule = { node: 'node:sqlite', bun: 'bun:sqlite' } as const
