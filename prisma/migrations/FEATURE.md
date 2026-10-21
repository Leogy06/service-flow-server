# Migration compatibility and recovery

These MySQL migrations build the application schema in timestamp order. Physical
table names use the exact casing of their original `CREATE TABLE` statements,
including `User`, `Job`, `RolePermission` and `UserPermission`. Prisma models have
no table-name mappings that make those names lowercase. Preserve column names,
index names, foreign-key names and existing business/data transformations.

`prisma/schema.prisma` is the application contract: preserve its model/enum names,
relation fields, `@default(cuid())` and `@updatedAt` attributes. Database
introspection can replace these with lowercase names and omit Prisma-managed
defaults. Compare an introspection using `db pull --print`; do not overwrite the
application schema to diagnose a production table problem. Regenerate the client
and build after schema edits. The regression suite also compares schema table
names with the migration history's exact casing.

`tests/prisma/migrations.test.ts` checks quoted table operands against preceding
table declarations. Run `npm test -- --runInBand tests/prisma/migrations.test.ts`.
The standalone `npm run test:predeploy` additionally replays the history into a
fresh isolated Linux MySQL 8.4 container with `lower_case_table_names=0`.
Static checks do not validate MySQL syntax or data-dependent constraints.

Primary-key replacements must drop and add the key in one `ALTER TABLE`, so the
history replays on hosts enforcing `sql_require_primary_key=ON`. The regression
suite also checks this requirement. For the explicitly authorized October 22
rebuild of disposable Aiven `defaultdb`, the UserPermission key swap was combined
and the final init_dev migration's SubscriptionRefund table casing was corrected.
Those historical edits change checksums: use them for the fresh rebuild, and
review migration-history reconciliation separately on any database where those
migrations already succeeded. This is not authorization to reset other databases.

## Recovering the reported failed deployment

Inspect the affected database before changing migration history:

```sql
SELECT migration_name, started_at, finished_at, rolled_back_at, logs
FROM _prisma_migrations
WHERE finished_at IS NULL AND rolled_back_at IS NULL
ORDER BY started_at;
```

If `20260818111948_add_user_deleted_at` failed because lowercase `user` did not
exist, its only statement failed without adding `deletedAt`. Deploy the corrected
files, then run from `backend` with the affected database's `DATABASE_URL`:

```sh
npx prisma migrate resolve --rolled-back 20260818111948_add_user_deleted_at
npx prisma migrate deploy
npx prisma migrate status
```

`resolve --rolled-back` only updates the failed migration record; it does not undo
SQL. For failures after successful statements, reconcile the partial DDL before
retrying. Do not mark an incomplete migration applied, delete migration records,
or reset the database to bypass errors.

This correction repairs the existing history for failed/pending Linux deployments.
It changes checksums: databases where these migrations already succeeded require
a separate history reconciliation plan. Do not blindly resolve successful
migrations, rewrite checksums, or change an initialized server's casing setting.
Future schema changes belong in new migrations.

Fresh replay does not prove upgrades on populated databases: historical required
columns, removed enum values, dropped columns and new unique keys retain their
existing data requirements. Review those requirements and back up data before an
upgrade. Hosting must also allow the platform audit triggers in this history.
