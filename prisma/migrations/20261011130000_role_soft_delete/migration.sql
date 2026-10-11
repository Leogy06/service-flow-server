-- Preserve role defaults and existing tenant-scoped name uniqueness when archiving.
ALTER TABLE `Role` ADD COLUMN `deletedAt` DATETIME(3) NULL;
CREATE INDEX `Role_organizationId_deletedAt_name_idx` ON `Role`(`organizationId`, `deletedAt`, `name`);
