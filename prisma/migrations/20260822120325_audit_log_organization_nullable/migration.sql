-- DropForeignKey
ALTER TABLE `auditlog` DROP FOREIGN KEY `AuditLog_organizationId_fkey`;

-- DropIndex
DROP INDEX `AuditLog_organizationId_fkey` ON `auditlog`;

-- AlterTable
ALTER TABLE `auditlog` MODIFY `organizationId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
