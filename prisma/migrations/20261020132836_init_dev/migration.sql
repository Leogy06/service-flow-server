-- DropForeignKey
ALTER TABLE `SubscriptionRefund` DROP FOREIGN KEY `SubscriptionRefund_requestId_fkey`;

-- AddForeignKey
ALTER TABLE `SubscriptionRefund` ADD CONSTRAINT `SubscriptionRefund_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `SubscriptionRefundRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
