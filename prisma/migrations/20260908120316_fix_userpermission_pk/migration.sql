/*
  Warnings:

  - The primary key for the `UserPermission` table will be changed.
  - A unique constraint covering the columns `[userId,permissionId]` on the table `UserPermission` will be added. If there are existing duplicate values, this will fail.
  - The required column `id` was added to the `UserPermission` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/

-- add new columns first
ALTER TABLE `UserPermission` ADD COLUMN `id` VARCHAR(191) NOT NULL,
    ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;

-- add unique index BEFORE drop old pk (keeps fk index alive)
CREATE UNIQUE INDEX `UserPermission_userId_permissionId_key` ON `UserPermission`(`userId`, `permissionId`);

-- Keep a primary key throughout for hosts enforcing sql_require_primary_key.
ALTER TABLE `UserPermission`
    DROP PRIMARY KEY,
    ADD PRIMARY KEY (`id`);
