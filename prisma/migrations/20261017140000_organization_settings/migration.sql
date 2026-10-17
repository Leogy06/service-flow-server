-- Tenant branding is optional; existing organizations use application defaults.
CREATE TABLE `OrganizationSettings` (
    `organizationId` VARCHAR(191) NOT NULL,
    `primaryColor` VARCHAR(7) NOT NULL DEFAULT '#b91c1c',
    `displayName` VARCHAR(100) NULL,
    `logoUrl` VARCHAR(191) NULL,
    `faviconUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`organizationId`),
    INDEX `OrganizationSettings_logoUrl_idx`(`logoUrl`),
    INDEX `OrganizationSettings_faviconUrl_idx`(`faviconUrl`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OrganizationSettings` ADD CONSTRAINT `OrganizationSettings_organizationId_fkey`
FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
