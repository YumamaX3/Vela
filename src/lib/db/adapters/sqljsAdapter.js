import fs from "node:fs";
import initSqlJs from "sql.js";
import { PRAGMA_SQL } from "../schema.js";

let SQL = null;

async function loadSql() {
  if (SQL) return SQL;
  SQL = await initSqlJs();
  return SQL;
}

export async function createSqlJsAdapter(filePath) {
  const SQLLib = await loadSql();
  const buf = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  const db = new SQLLib.Database(buf);
  db.exec(PRAGMA_SQL);
  // Schema is created/synced by migrate.js after adapter init

  let dirty = false;
  let saveTimer = null;
  const SAVE_DEBOUNCE_MS = 100;

  function persist() {
    const data = db.export();
    // Atomic replace: write a sibling temp file, fsync it, then rename over the
    // target. A direct writeFileSync truncates data.sqlite to zero BEFORE the
    // new bytes land, so a crash / kill / full disk mid-write leaves a truncated
    // or half-written database — and the next open reports SQLITE_CORRUPT
    // ("database disk image is malformed") or silently starts from empty schema.
    // rename() is atomic within a filesystem, so the target is either the old
    // file or the new one, never a torn mixture.
    const tmp = `${filePath}.tmp-${process.pid}`;
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeSync(fd, Buffer.from(data));
      fs.fsyncSync(fd);          // bytes must be on disk before the rename
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
    dirty = false;
  }

  function scheduleSave() {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (dirty) {
        try { persist(); } catch (e) { console.error("[sqljs] save failed:", e); }
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function paramsObj(params) {
    if (!params || (Array.isArray(params) && params.length === 0)) return undefined;
    return params;
  }

  function run(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      stmt.step();
      const changes = db.getRowsModified();
      const lastInsertRowid = db.exec("SELECT last_insert_rowid() as id")[0]?.values?.[0]?.[0] ?? null;
      scheduleSave();
      return { changes, lastInsertRowid };
    } finally {
      stmt.free();
    }
  }

  function get(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally {
      stmt.free();
    }
  }

  function all(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function exec(sql) {
    db.exec(sql);
    scheduleSave();
  }

  function transaction(fn) {
    const sp = `sp_${Math.random().toString(36).slice(2)}`;
    db.exec(`SAVEPOINT ${sp}`);
    try {
      const result = fn();
      db.exec(`RELEASE ${sp}`);
      scheduleSave();
      return result;
    } catch (e) {
      try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {}
      throw e;
    }
  }

  function close() {
    clearTimeout(saveTimer);
    if (dirty) persist();
    // Detach the shutdown handlers. They were registered with `process.on`
    // (not `once`), so they survive their own firing and accumulate for the
    // life of the process — every adapter opened added three more, until Node
    // tripped MaxListenersExceededWarning (11 beforeExit/SIGINT/SIGTERM
    // observed on a process holding three adapters plus the single-instance
    // lock). A closed adapter must stop holding the process open.
    for (const sig of ["beforeExit", "SIGINT", "SIGTERM"]) {
      process.removeListener(sig, flush);
    }
    db.close();
  }

  // Flush on shutdown. Named (not inline) so close() can detach them.
  const flush = () => { if (dirty) try { persist(); } catch {} };
  process.on("beforeExit", flush);
  process.on("SIGINT", flush);
  process.on("SIGTERM", flush);

  return { driver: "sql.js", run, get, all, exec, transaction, close, raw: db };
}
