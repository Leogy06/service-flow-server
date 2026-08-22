-- AlterTable
ALTER TABLE `refreshtoken` ADD COLUMN `organizationId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
