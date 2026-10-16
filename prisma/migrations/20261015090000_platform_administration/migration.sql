-- AlterTable
ALTER TABLE `Organization` ADD COLUMN `billingEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `statusChangedAt` DATETIME(3) NULL,
    ADD COLUMN `statusChangedBy` VARCHAR(191) NULL,
    ADD COLUMN `statusReason` VARCHAR(1000) NULL,
    MODIFY `status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE `User` ADD COLUMN `platformRole` ENUM('NONE', 'SYSTEM_ADMIN') NOT NULL DEFAULT 'NONE',
    ADD COLUMN `securityChangedAt` DATETIME(3) NULL,
    ADD COLUMN `securityChangedBy` VARCHAR(191) NULL,
    ADD COLUMN `securityReason` VARCHAR(1000) NULL,
    ADD COLUMN `securityStatus` ENUM('ACTIVE', 'BLOCKED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `sessionVersion` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `AuditLog` ADD COLUMN `actorType` VARCHAR(191) NOT NULL DEFAULT 'USER',
    ADD COLUMN `scope` ENUM('TENANT', 'PLATFORM') NOT NULL DEFAULT 'TENANT';

-- CreateTable
CREATE TABLE `Plan` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `annualPrice` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'PHP',
    `maxActiveUsers` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Plan_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Subscription` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELED') NOT NULL DEFAULT 'PENDING',
    `startsAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `renewalType` VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    `annualPrice` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `currentPeriodPaymentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Subscription_organizationId_key`(`organizationId`),
    INDEX `Subscription_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `Subscription_planId_idx`(`planId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubscriptionHistory` (
    `id` VARCHAR(191) NOT NULL,
    `subscriptionId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(80) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `paymentId` VARCHAR(191) NULL,
    `actorId` VARCHAR(191) NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SubscriptionHistory_paymentId_key`(`paymentId`),
    INDEX `SubscriptionHistory_subscriptionId_createdAt_idx`(`subscriptionId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubscriptionPayment` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `subscriptionId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `paymentMethod` ENUM('CASH', 'BANK_TRANSFER', 'GCASH', 'CARD', 'OTHER') NOT NULL,
    `referenceNumber` VARCHAR(150) NOT NULL,
    `idempotencyKey` VARCHAR(100) NOT NULL,
    `status` ENUM('PENDING', 'UNDER_REVIEW', 'PAID', 'REJECTED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `paidAt` DATETIME(3) NOT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verifiedBy` VARCHAR(191) NULL,
    `verificationReason` VARCHAR(1000) NULL,
    `evidence` VARCHAR(1000) NULL,
    `periodStartsAt` DATETIME(3) NULL,
    `periodExpiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SubscriptionPayment_referenceNumber_key`(`referenceNumber`),
    UNIQUE INDEX `SubscriptionPayment_idempotencyKey_key`(`idempotencyKey`),
    INDEX `SubscriptionPayment_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `SubscriptionPayment_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    INDEX `SubscriptionPayment_subscriptionId_idx`(`subscriptionId`),
    INDEX `SubscriptionPayment_verifiedAt_idx`(`verifiedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubscriptionRefund` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `idempotencyKey` VARCHAR(100) NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `evidence` VARCHAR(1000) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SubscriptionRefund_paymentId_key`(`paymentId`),
    UNIQUE INDEX `SubscriptionRefund_idempotencyKey_key`(`idempotencyKey`),
    INDEX `SubscriptionRefund_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformAlert` (
    `id` VARCHAR(191) NOT NULL,
    `deduplicationKey` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NULL,
    `kind` VARCHAR(80) NOT NULL,
    `severity` VARCHAR(20) NOT NULL,
    `message` VARCHAR(1000) NOT NULL,
    `targetType` VARCHAR(80) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PlatformAlert_deduplicationKey_key`(`deduplicationKey`),
    INDEX `PlatformAlert_resolvedAt_createdAt_idx`(`resolvedAt`, `createdAt`),
    INDEX `PlatformAlert_organizationId_idx`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformSettings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `reminderIntervals` JSON NOT NULL,
    `gracePeriodDays` INTEGER NOT NULL DEFAULT 0,
    `paymentInstructions` TEXT NOT NULL,
    `supportEmail` VARCHAR(254) NULL,
    `supportPhone` VARCHAR(50) NULL,
    `maintenanceMessage` TEXT NOT NULL,
    `defaultPlanId` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Organization_status_createdAt_idx` ON `Organization`(`status`, `createdAt`);

-- CreateIndex
CREATE INDEX `User_organizationId_status_deletedAt_idx` ON `User`(`organizationId`, `status`, `deletedAt`);

-- CreateIndex
CREATE INDEX `User_platformRole_securityStatus_idx` ON `User`(`platformRole`, `securityStatus`);

-- CreateIndex
CREATE INDEX `AuditLog_scope_createdAt_id_idx` ON `AuditLog`(`scope`, `createdAt`, `id`);

-- CreateIndex
CREATE INDEX `AuditLog_scope_organizationId_createdAt_idx` ON `AuditLog`(`scope`, `organizationId`, `createdAt`);

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubscriptionHistory` ADD CONSTRAINT `SubscriptionHistory_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubscriptionHistory` ADD CONSTRAINT `SubscriptionHistory_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `SubscriptionPayment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubscriptionPayment` ADD CONSTRAINT `SubscriptionPayment_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubscriptionPayment` ADD CONSTRAINT `SubscriptionPayment_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubscriptionRefund` ADD CONSTRAINT `SubscriptionRefund_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `SubscriptionPayment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlatformAlert` ADD CONSTRAINT `PlatformAlert_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlatformSettings` ADD CONSTRAINT `PlatformSettings_defaultPlanId_fkey` FOREIGN KEY (`defaultPlanId`) REFERENCES `Plan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Keep privileged audit history append-only even for accidental ORM writes.
-- No existing user is promoted; new platformRole columns default to NONE.
CREATE TRIGGER `AuditLog_platform_no_update` BEFORE UPDATE ON `AuditLog`
FOR EACH ROW
BEGIN
  IF OLD.scope = 'PLATFORM' OR NEW.scope = 'PLATFORM' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Platform audit records are immutable';
  END IF;
END;

CREATE TRIGGER `AuditLog_platform_no_delete` BEFORE DELETE ON `AuditLog`
FOR EACH ROW
BEGIN
  IF OLD.scope = 'PLATFORM' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Platform audit records are immutable';
  END IF;
END;
