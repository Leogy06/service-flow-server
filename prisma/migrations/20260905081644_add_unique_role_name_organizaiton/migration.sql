/*
  Warnings:

  - A unique constraint covering the columns `[name,organizationId]` on the table `Role` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX `Role_name_organizationId_key` ON `Role`(`name`, `organizationId`);
