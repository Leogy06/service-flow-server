-- Preserve all existing billing records as yearly subscriptions.
ALTER TABLE `Plan` ADD COLUMN `billingInterval` ENUM('MONTHLY', 'YEARLY') NOT NULL DEFAULT 'YEARLY';
ALTER TABLE `Subscription` ADD COLUMN `billingInterval` ENUM('MONTHLY', 'YEARLY') NOT NULL DEFAULT 'YEARLY';
ALTER TABLE `SubscriptionPayment` ADD COLUMN `billingInterval` ENUM('MONTHLY', 'YEARLY') NOT NULL DEFAULT 'YEARLY';
