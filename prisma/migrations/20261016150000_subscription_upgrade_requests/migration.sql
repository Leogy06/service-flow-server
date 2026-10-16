CREATE TABLE `SubscriptionUpgradeRequest` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `subscriptionId` VARCHAR(191) NOT NULL,
    `activeSubscriptionId` VARCHAR(191) NULL,
    `planId` VARCHAR(191) NOT NULL,
    `sourcePlanId` VARCHAR(191) NOT NULL,
    `subscriptionVersion` INTEGER NOT NULL,
    `planName` VARCHAR(100) NOT NULL,
    `price` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `billingInterval` ENUM('MONTHLY', 'YEARLY') NOT NULL,
    `maxActiveUsers` INTEGER NOT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'REQUESTED',
    `reason` VARCHAR(1000) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(100) NOT NULL,
    `reviewReason` VARCHAR(1000) NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `SubscriptionUpgradeRequest_activeSubscriptionId_key`(`activeSubscriptionId`),
    UNIQUE INDEX `SubscriptionUpgradeRequest_organizationId_idempotencyKey_key`(`organizationId`, `idempotencyKey`),
    INDEX `SubscriptionUpgradeRequest_subscriptionId_createdAt_idx`(`subscriptionId`, `createdAt`),
    INDEX `SubscriptionUpgradeRequest_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SubscriptionUpgradeRequest` ADD CONSTRAINT `SubscriptionUpgradeRequest_organizationId_fkey`
    FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SubscriptionUpgradeRequest` ADD CONSTRAINT `SubscriptionUpgradeRequest_subscriptionId_fkey`
    FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SubscriptionUpgradeRequest` ADD CONSTRAINT `SubscriptionUpgradeRequest_planId_fkey`
    FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
