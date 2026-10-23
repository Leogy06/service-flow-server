CREATE TABLE `LoginChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NULL,
    `surface` VARCHAR(20) NOT NULL,
    `challengeHash` VARCHAR(64) NOT NULL,
    `codeHash` VARCHAR(64) NOT NULL,
    `codeLength` INTEGER NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `sessionVersion` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deliveryStatus` VARCHAR(10) NOT NULL DEFAULT 'pending',
    `consumedAt` DATETIME(3) NULL,
    UNIQUE INDEX `LoginChallenge_challengeHash_key` (`challengeHash`),
    INDEX `LoginChallenge_userId_createdAt_idx` (`userId`, `createdAt`),
    INDEX `LoginChallenge_userId_surface_consumedAt_idx` (`userId`, `surface`, `consumedAt`),
    INDEX `LoginChallenge_organizationId_idx` (`organizationId`),
    INDEX `LoginChallenge_expiresAt_idx` (`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TrustedDevice` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NULL,
    `surface` VARCHAR(20) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `userAgent` VARCHAR(500) NOT NULL,
    `ipAddress` VARCHAR(45) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    UNIQUE INDEX `TrustedDevice_tokenHash_key` (`tokenHash`),
    INDEX `TrustedDevice_userId_organizationId_revokedAt_idx` (`userId`, `organizationId`, `revokedAt`),
    INDEX `TrustedDevice_organizationId_idx` (`organizationId`),
    INDEX `TrustedDevice_expiresAt_idx` (`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `LoginChallenge` ADD CONSTRAINT `LoginChallenge_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LoginChallenge` ADD CONSTRAINT `LoginChallenge_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `TrustedDevice` ADD CONSTRAINT `TrustedDevice_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `TrustedDevice` ADD CONSTRAINT `TrustedDevice_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
