-- Existing organizations retain real-tenant behavior. No existing data is rewritten.
ALTER TABLE `Organization` ADD COLUMN `isDemo` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `TenantProvisioning` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `requestHash` VARCHAR(64) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(50) NOT NULL,
    `templateVersion` INTEGER NOT NULL,
    `mode` VARCHAR(10) NOT NULL,
    `includeDemoData` BOOLEAN NOT NULL,
    `generateWebsite` BOOLEAN NOT NULL,
    `invitationStatus` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `invitationAttemptId` VARCHAR(64) NULL,
    `invitationAttemptedAt` DATETIME(3) NULL,
    `invitationError` VARCHAR(300) NULL,
    `demoManifest` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `TenantProvisioning_organizationId_key`(`organizationId`),
    INDEX `TenantProvisioning_actorId_createdAt_idx`(`actorId`, `createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `TenantProvisioning_organizationId_fkey`
      FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`)
      ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
