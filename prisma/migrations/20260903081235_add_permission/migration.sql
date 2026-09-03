/*
  Warnings:

  - You are about to drop the column `role` on the `user` table. All the data in the column will be lost.
  - Added the required column `roleId` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX `User_role_idx` ON `user`;

-- AlterTable
ALTER TABLE `user` DROP COLUMN `role`,
    ADD COLUMN `roleId` VARCHAR(191) NOT NULL;

-- CreateTable
CREATE TABLE `Role` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NULL,

    UNIQUE INDEX `Role_name_key`(`name`),
    UNIQUE INDEX `Role_name_organizationId_key`(`name`, `organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Permission` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `organizationId` VARCHAR(191) NULL,

    UNIQUE INDEX `Permission_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `roleId` VARCHAR(191) NOT NULL,
    `permissionId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `User_roleId_idx` ON `User`(`roleId`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Role` ADD CONSTRAINT `Role_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Permission` ADD CONSTRAINT `Permission_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
