import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const directory = join(process.cwd(), "prisma/migrations");
const migrations = readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => [entry.name, readFileSync(join(directory, entry.name, "migration.sql"), "utf8")] as const)
  .sort(([left], [right]) => left.localeCompare(right));

// Check the quoted table operands used by this SQL history. Real MySQL replay
// remains necessary to validate SQL syntax, constraints and data migrations.
const knownTables = new Set<string>();
const results = migrations.map(([name, sql]) => {
  const errors: string[] = [];
  const statements = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\r\n]*/g, "");
  const operands = statements.matchAll(
    /\b(CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|REFERENCES|FROM|JOIN|UPDATE|INTO|ON)\s+`([^`]+)`/gi,
  );
  for (const [, operation, table] of operands) {
    if (/^CREATE\s+TABLE$/i.test(operation!)) {
      if (knownTables.has(table!)) errors.push(`Duplicate table creation: ${table}`);
      knownTables.add(table!);
    } else if (!knownTables.has(table!)) {
      errors.push(`${operation} references undeclared or incorrectly cased table ${table}`);
    }
  }
  return [name, errors] as const;
});

test.each(results)("%s uses previously declared table names with exact casing", (_name, errors) => {
  expect(errors).toEqual([]);
});

test.each(migrations)("%s preserves a primary key when replacing it", (_name, sql) => {
  const statements = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\r\n]*/g, "").split(";");
  for (const statement of statements) {
    if (/\bDROP\s+PRIMARY\s+KEY\b/i.test(statement)) {
      expect(statement).toMatch(/\bADD\s+PRIMARY\s+KEY\b/i);
    }
  }
});
