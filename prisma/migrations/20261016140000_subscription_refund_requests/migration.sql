CREATE TABLE `SubscriptionRefundRequest` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `activePaymentId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(100) NOT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED') NOT NULL DEFAULT 'REQUESTED',
    `reason` VARCHAR(1000) NOT NULL,
    `evidence` VARCHAR(1000) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `reviewReason` VARCHAR(1000) NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `SubscriptionRefundRequest_activePaymentId_key`(`activePaymentId`),
    UNIQUE INDEX `SubscriptionRefundRequest_idempotencyKey_key`(`idempotencyKey`),
    INDEX `SubscriptionRefundRequest_paymentId_createdAt_idx`(`paymentId`, `createdAt`),
    INDEX `SubscriptionRefundRequest_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SubscriptionRefundRequest` ADD CONSTRAINT `SubscriptionRefundRequest_paymentId_fkey`
    FOREIGN KEY (`paymentId`) REFERENCES `SubscriptionPayment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SubscriptionRefund` ADD COLUMN `requestId` VARCHAR(191) NULL,
    ADD UNIQUE INDEX `SubscriptionRefund_requestId_key`(`requestId`);
ALTER TABLE `SubscriptionRefund` ADD CONSTRAINT `SubscriptionRefund_requestId_fkey`
    FOREIGN KEY (`requestId`) REFERENCES `SubscriptionRefundRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
