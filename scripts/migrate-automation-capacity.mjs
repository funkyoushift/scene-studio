// Run with a D1 binding. A single transactional batch preserves rows and keeps
// an in-database rollback copy; no channel configuration is rewritten.
export const CAPACITY_BACKUP = "automation_configs_capacity_backup_20261026";
export async function migrateAutomationCapacity(db) {
  const schema = await db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL").all();
  const entries = schema.results;
  const table = entries.find(row => row.type === "table" && row.name === "automation_configs");
  if (!table) throw Error("Missing automation_configs table.");
  if (/<=\s*65536/.test(table.sql)) return { migrated: false, limit: 65536 };
  if (!/<=\s*16384/.test(table.sql)) throw Error("Unrecognized capacity constraint; migration stopped.");
  const dependencies = entries.filter(row => row.name !== table.name && /\bautomation_configs\b/i.test(row.sql));
  if (dependencies.some(row => !["automation_next_tick", "automation_admitted"].includes(row.name))) throw Error("Unexpected table dependency; migration stopped.");
  if (!dependencies.some(row => row.name === "automation_admitted")) throw Error("Missing admission trigger; migration stopped.");
  const replacement = table.sql.replace(/\bautomation_configs\b/, "automation_configs_capacity_new").replace(/<=\s*16384/, "<=65536");
  const statements = [
    `CREATE TABLE ${CAPACITY_BACKUP} AS SELECT * FROM automation_configs`,
    "DROP TRIGGER automation_admitted",
    replacement,
    "INSERT INTO automation_configs_capacity_new SELECT * FROM automation_configs",
    "DROP TABLE automation_configs",
    "ALTER TABLE automation_configs_capacity_new RENAME TO automation_configs",
    ...dependencies.map(row => row.sql),
  ];
  await db.batch(statements.map(sql => db.prepare(sql)));
  return { migrated: true, limit: 65536, backup: CAPACITY_BACKUP };
}
