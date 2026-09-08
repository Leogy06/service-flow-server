/*
  Warnings:

  - The primary key for the `userpermission` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[userId,permissionId]` on the table `UserPermission` will be added. If there are existing duplicate values, this will fail.
  - The required column `id` was added to the `UserPermission` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/

-- add new columns first
ALTER TABLE `userpermission` ADD COLUMN `id` VARCHAR(191) NOT NULL,
    ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;

-- add unique index BEFORE drop old pk (keeps fk index alive)
CREATE UNIQUE INDEX `UserPermission_userId_permissionId_key` ON `userpermission`(`userId`, `permissionId`);

-- now safe: drop old pk
ALTER TABLE `userpermission` DROP PRIMARY KEY;

-- add new pk on id
ALTER TABLE `userpermission` ADD PRIMARY KEY (`id`);  