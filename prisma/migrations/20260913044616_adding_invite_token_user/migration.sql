/*
  Warnings:

  - You are about to alter the column `status` on the `user` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(7))` to `Enum(EnumId(1))`.
  - A unique constraint covering the columns `[inviteToken]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `user` ADD COLUMN `inviteToken` VARCHAR(191) NULL,
    ADD COLUMN `inviteTokenExpiry` DATETIME(3) NULL,
    MODIFY `password` VARCHAR(191) NULL,
    MODIFY `status` ENUM('ACTIVE', 'PENDING') NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE UNIQUE INDEX `User_inviteToken_key` ON `User`(`inviteToken`);
