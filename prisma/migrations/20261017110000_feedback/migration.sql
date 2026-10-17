-- CreateTable
CREATE TABLE `ProductFeedback` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `submissionKey` VARCHAR(36) NOT NULL,
    `rating` INTEGER NOT NULL,
    `comment` VARCHAR(2000) NOT NULL,
    `displayName` VARCHAR(100) NULL,
    `consentGrantedAt` DATETIME(3) NULL,
    `consentVersion` VARCHAR(32) NULL,
    `consentWithdrawnAt` DATETIME(3) NULL,
    `testimonialApprovedAt` DATETIME(3) NULL,
    `status` ENUM('NEW', 'IN_REVIEW', 'RESOLVED') NOT NULL DEFAULT 'NEW',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProductFeedback_status_createdAt_id_idx`(`status`, `createdAt`, `id`),
    INDEX `ProductFeedback_organizationId_authorId_createdAt_idx`(`organizationId`, `authorId`, `createdAt`),
    UNIQUE INDEX `ProductFeedback_authorId_submissionKey_key`(`authorId`, `submissionKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedbackInvitation` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `serviceRequestId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FeedbackInvitation_serviceRequestId_key`(`serviceRequestId`),
    UNIQUE INDEX `FeedbackInvitation_tokenHash_key`(`tokenHash`),
    INDEX `FeedbackInvitation_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    UNIQUE INDEX `FeedbackInvitation_id_organizationId_key`(`id`, `organizationId`),
    UNIQUE INDEX `FeedbackInvitation_serviceRequestId_organizationId_key`(`serviceRequestId`, `organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerFeedback` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `invitationId` VARCHAR(191) NOT NULL,
    `rating` INTEGER NOT NULL,
    `comment` VARCHAR(2000) NOT NULL,
    `displayName` VARCHAR(100) NULL,
    `consentGrantedAt` DATETIME(3) NULL,
    `consentVersion` VARCHAR(32) NULL,
    `consentWithdrawnAt` DATETIME(3) NULL,
    `testimonialApprovedAt` DATETIME(3) NULL,
    `status` ENUM('NEW', 'IN_REVIEW', 'RESOLVED') NOT NULL DEFAULT 'NEW',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomerFeedback_invitationId_key`(`invitationId`),
    INDEX `CustomerFeedback_organizationId_status_createdAt_id_idx`(`organizationId`, `status`, `createdAt`, `id`),
    UNIQUE INDEX `CustomerFeedback_invitationId_organizationId_key`(`invitationId`, `organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `ServiceRequest_id_organizationId_key` ON `ServiceRequest`(`id`, `organizationId`);

-- AddForeignKey
ALTER TABLE `ProductFeedback` ADD CONSTRAINT `ProductFeedback_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductFeedback` ADD CONSTRAINT `ProductFeedback_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedbackInvitation` ADD CONSTRAINT `FeedbackInvitation_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedbackInvitation` ADD CONSTRAINT `FeedbackInvitation_serviceRequestId_organizationId_fkey` FOREIGN KEY (`serviceRequestId`, `organizationId`) REFERENCES `ServiceRequest`(`id`, `organizationId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerFeedback` ADD CONSTRAINT `CustomerFeedback_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerFeedback` ADD CONSTRAINT `CustomerFeedback_invitationId_organizationId_fkey` FOREIGN KEY (`invitationId`, `organizationId`) REFERENCES `FeedbackInvitation`(`id`, `organizationId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add definitions without rewriting any existing permission or inactive grant.
INSERT INTO `Permission` (`id`, `name`, `description`)
SELECT 'sf-feedback-create', 'feedback:create', 'Create customer feedback invitations'
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `name` = 'feedback:create');
INSERT INTO `Permission` (`id`, `name`, `description`)
SELECT 'sf-feedback-read', 'feedback:read', 'View customer feedback'
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `name` = 'feedback:read');
INSERT INTO `Permission` (`id`, `name`, `description`)
SELECT 'sf-feedback-update', 'feedback:update', 'Review customer feedback and testimonial eligibility'
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `name` = 'feedback:update');

-- Only current tenant Admin roles receive automatic access. Preserve staff/custom
-- assignments and any explicit inactive grants. New tenants use shared defaults.
INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`, `isActive`)
SELECT CONCAT('feedback-grant-', MD5(CONCAT(r.`id`, ':', p.`id`))), r.`id`, p.`id`, true
FROM `Role` r CROSS JOIN `Permission` p
WHERE r.`organizationId` IS NOT NULL AND r.`deletedAt` IS NULL
  AND LOWER(REPLACE(REPLACE(REPLACE(r.`name`, ' ', ''), '_', ''), '-', '')) IN ('admin', 'tenantadmin')
  AND p.`organizationId` IS NULL AND p.`name` IN ('feedback:create', 'feedback:read', 'feedback:update')
  AND NOT EXISTS (SELECT 1 FROM `RolePermission` rp WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`);

INSERT INTO `AuditLog` (`id`, `scope`, `actorType`, `organizationId`, `action`, `entity`, `entityId`, `metadata`)
SELECT CONCAT('feedback-audit-', MD5(r.`id`)), 'TENANT', 'SYSTEM', r.`organizationId`,
  'feedback.permissions.provisioned', 'Role', r.`id`,
  JSON_OBJECT('after', JSON_OBJECT('migration', '20261017110000_feedback'))
FROM `Role` r
WHERE EXISTS (SELECT 1 FROM `RolePermission` rp WHERE rp.`roleId` = r.`id` AND rp.`id` LIKE 'feedback-grant-%');

