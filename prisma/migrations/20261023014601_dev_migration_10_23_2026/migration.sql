-- CreateTable
CREATE TABLE `access_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ip` VARCHAR(45) NOT NULL,
    `method` VARCHAR(32) NOT NULL,
    `path` VARCHAR(500) NOT NULL,
    `status` INTEGER NOT NULL,
    `durationMs` INTEGER NOT NULL,
    `country` VARCHAR(2) NULL,
    `city` VARCHAR(255) NULL,
    `userAgent` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `access_logs_createdAt_idx`(`createdAt`),
    INDEX `access_logs_ip_idx`(`ip`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
