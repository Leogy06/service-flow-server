-- Add a distinct trial lifecycle without changing existing access or billing records.
ALTER TABLE `Subscription`
    MODIFY `status` ENUM('PENDING', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELED') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `trialStartedAt` DATETIME(3) NULL,
    ADD COLUMN `trialExpiresAt` DATETIME(3) NULL;
