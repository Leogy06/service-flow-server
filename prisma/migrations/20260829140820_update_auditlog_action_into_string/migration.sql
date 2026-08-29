/*
  Warnings:

  - You are about to alter the column `action` on the `auditlog` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(0))` to `VarChar(191)`.

*/
-- AlterTable
ALTER TABLE `auditlog` MODIFY `action` VARCHAR(191) NOT NULL;
