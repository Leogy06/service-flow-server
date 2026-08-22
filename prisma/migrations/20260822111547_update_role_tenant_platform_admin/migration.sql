/*
  Warnings:

  - The values [ADMIN] on the enum `User_role` will be removed. If these variants are still used in the database, this will fail.
  - Made the column `organizationId` on table `servicetype` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE `servicetype` DROP FOREIGN KEY `ServiceType_organizationId_fkey`;

-- AlterTable
ALTER TABLE `servicetype` MODIFY `organizationId` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `user` MODIFY `role` ENUM('PLATFORM_ADMIN', 'TENANT_ADMIN', 'STAFF') NOT NULL DEFAULT 'STAFF';

-- AddForeignKey
ALTER TABLE `ServiceType` ADD CONSTRAINT `ServiceType_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `servicetype` RENAME INDEX `ServiceType_organizationId_fkey` TO `ServiceType_organizationId_idx`;

-- RenameIndex
ALTER TABLE `user` RENAME INDEX `User_organizationId_fkey` TO `User_organizationId_idx`;
