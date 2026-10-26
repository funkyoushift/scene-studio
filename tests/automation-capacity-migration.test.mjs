import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { migrateAutomationCapacity, CAPACITY_BACKUP } from "../scripts/migrate-automation-capacity.mjs";

function fixture(t, failAt = -1) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL("../server/automation-schema.sql", import.meta.url), "utf8").replace("<=65536", "<=16384"));
  sqlite.prepare("INSERT INTO automation_configs VALUES (?,?,?,?,?,?,?,?,?,?)").run("123", '{"version":1}', 7, 1, 12, '{}', 3, 9, 1, 300);
  const db = {
    prepare(sql) { return { sql, all: async () => ({ results: sqlite.prepare(sql).all() }) }; },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { statements.forEach((s, i) => { if (i === failAt) throw Error("Injected migration failure"); sqlite.exec(s.sql); }); sqlite.exec("COMMIT"); }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { sqlite, db };
}
test("capacity migration preserves all configuration fields and admission trigger, with a rollback copy", async t => {
  const { sqlite, db } = fixture(t);
  const before = sqlite.prepare("SELECT * FROM automation_configs").all();
  assert.equal((await migrateAutomationCapacity(db)).migrated, true);
  assert.deepEqual(sqlite.prepare("SELECT * FROM automation_configs").all(), before);
  assert.deepEqual(sqlite.prepare(`SELECT * FROM ${CAPACITY_BACKUP}`).all(), before);
  const update = sqlite.prepare("UPDATE automation_configs SET design=? WHERE channel='123'");
  update.run("x".repeat(65536));
  assert.throws(() => update.run("x".repeat(65537)), /CHECK/);
  sqlite.prepare("INSERT INTO automation_receipts VALUES (?,?,?,?,?,?,?,?,?,?)").run("123", "input", "hash", "event", 7, '{"fired":true}', '{}', 50, 70, "admitted");
  assert.equal(sqlite.prepare("SELECT engine_revision FROM automation_configs").get().engine_revision, 4);
  assert.equal((await migrateAutomationCapacity(db)).migrated, false);
});
test("a failed migration rolls back the whole batch, including table removal", async t => {
  const { sqlite, db } = fixture(t, 5);
  const before = sqlite.prepare("SELECT * FROM automation_configs").all();
  await assert.rejects(migrateAutomationCapacity(db), /Injected/);
  assert.deepEqual(sqlite.prepare("SELECT * FROM automation_configs").all(), before);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name=?").get(CAPACITY_BACKUP).n, 0);
  assert.ok(sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='automation_admitted'").get());
});
