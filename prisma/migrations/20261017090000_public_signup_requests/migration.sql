CREATE TABLE `SignupRequest` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NULL,
    `firstName` VARCHAR(100) NOT NULL,
    `lastName` VARCHAR(100) NOT NULL,
    `middleName` VARCHAR(100) NULL,
    `suffix` VARCHAR(20) NULL,
    `phone` VARCHAR(16) NULL,
    `organizationName` VARCHAR(100) NOT NULL,
    `slug` VARCHAR(50) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewReason` VARCHAR(1000) NULL,
    `organizationId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `SignupRequest_email_key`(`email`),
    UNIQUE INDEX `SignupRequest_organizationId_key`(`organizationId`),
    INDEX `SignupRequest_status_createdAt_id_idx`(`status`, `createdAt`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SignupRequest` ADD CONSTRAINT `SignupRequest_organizationId_fkey`
  FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
