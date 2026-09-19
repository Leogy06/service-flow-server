/*
  Warnings:

  - You are about to drop the column `customerType` on the `customer` table. All the data in the column will be lost.
  - You are about to drop the column `firstName` on the `customer` table. All the data in the column will be lost.
  - You are about to drop the column `lastName` on the `customer` table. All the data in the column will be lost.
  - You are about to drop the column `middleName` on the `customer` table. All the data in the column will be lost.
  - You are about to drop the column `organizationName` on the `customer` table. All the data in the column will be lost.
  - You are about to drop the column `suffix` on the `customer` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `name` to the `Customer` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX `Customer_lastName_firstName_idx` ON `customer`;

-- AlterTable
ALTER TABLE `customer` DROP COLUMN `customerType`,
    DROP COLUMN `firstName`,
    DROP COLUMN `lastName`,
    DROP COLUMN `middleName`,
    DROP COLUMN `organizationName`,
    DROP COLUMN `suffix`,
    ADD COLUMN `name` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Customer_name_key` ON `Customer`(`name`);
