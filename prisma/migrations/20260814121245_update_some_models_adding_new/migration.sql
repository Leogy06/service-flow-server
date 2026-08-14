/*
  Warnings:

  - You are about to alter the column `status` on the `job` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(1))` to `Enum(EnumId(5))`.
  - You are about to drop the column `notes` on the `servicerequest` table. All the data in the column will be lost.
  - You are about to drop the column `requestedAt` on the `servicerequest` table. All the data in the column will be lost.
  - You are about to drop the column `duration` on the `servicetype` table. All the data in the column will be lost.
  - You are about to drop the column `price` on the `servicetype` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[referenceNumber]` on the table `Job` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[serviceRequestId]` on the table `Job` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[referenceNumber]` on the table `ServiceRequest` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[trackingToken]` on the table `ServiceRequest` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name]` on the table `ServiceType` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[phone]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `Customer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `customerId` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `referenceNumber` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `serviceTypeId` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `referenceNumber` to the `ServiceRequest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `ServiceRequest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `basePrice` to the `ServiceType` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `ServiceType` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `job` DROP FOREIGN KEY `Job_assignedStaffId_fkey`;

-- AlterTable
ALTER TABLE `customer` ADD COLUMN `address` VARCHAR(191) NULL,
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `notes` VARCHAR(191) NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL;

-- AlterTable
ALTER TABLE `job` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `customerId` VARCHAR(191) NOT NULL,
    ADD COLUMN `description` VARCHAR(191) NULL,
    ADD COLUMN `internalNotes` VARCHAR(191) NULL,
    ADD COLUMN `location` VARCHAR(191) NULL,
    ADD COLUMN `referenceNumber` VARCHAR(191) NOT NULL,
    ADD COLUMN `scheduledEnd` DATETIME(3) NULL,
    ADD COLUMN `scheduledStart` DATETIME(3) NULL,
    ADD COLUMN `serviceTypeId` VARCHAR(191) NOT NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL,
    MODIFY `serviceRequestId` VARCHAR(191) NULL,
    MODIFY `assignedStaffId` VARCHAR(191) NULL,
    MODIFY `status` ENUM('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'ASSIGNED';

-- AlterTable
ALTER TABLE `servicerequest` DROP COLUMN `notes`,
    DROP COLUMN `requestedAt`,
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `description` VARCHAR(191) NULL,
    ADD COLUMN `location` VARCHAR(191) NULL,
    ADD COLUMN `preferredDate` DATETIME(3) NULL,
    ADD COLUMN `referenceNumber` VARCHAR(191) NOT NULL,
    ADD COLUMN `trackingToken` VARCHAR(191) NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL;

-- AlterTable
ALTER TABLE `servicetype` DROP COLUMN `duration`,
    DROP COLUMN `price`,
    ADD COLUMN `basePrice` DECIMAL(10, 2) NOT NULL,
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `phone` VARCHAR(191) NULL,
    ADD COLUMN `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL;

-- CreateTable
CREATE TABLE `JobStatusHistory` (
    `id` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `fromStatus` ENUM('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NULL,
    `toStatus` ENUM('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL,
    `note` VARCHAR(191) NULL,
    `changedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `JobStatusHistory_jobId_idx`(`jobId`),
    INDEX `JobStatusHistory_changedById_idx`(`changedById`),
    INDEX `JobStatusHistory_toStatus_idx`(`toStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoice` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceNumber` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NULL,
    `status` ENUM('UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOID') NOT NULL DEFAULT 'UNPAID',
    `subtotal` DECIMAL(10, 2) NOT NULL,
    `total` DECIMAL(10, 2) NOT NULL,
    `amountPaid` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueAt` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Invoice_invoiceNumber_key`(`invoiceNumber`),
    UNIQUE INDEX `Invoice_jobId_key`(`jobId`),
    INDEX `Invoice_customerId_idx`(`customerId`),
    INDEX `Invoice_status_idx`(`status`),
    INDEX `Invoice_issuedAt_idx`(`issuedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InvoiceItem` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(10, 2) NOT NULL,
    `unitPrice` DECIMAL(10, 2) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InvoiceItem_invoiceId_idx`(`invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `method` ENUM('CASH', 'BANK_TRANSFER', 'GCASH', 'CARD', 'OTHER') NOT NULL,
    `referenceNumber` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Payment_invoiceId_idx`(`invoiceId`),
    INDEX `Payment_receivedAt_idx`(`receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `action` ENUM('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'ASSIGN', 'STATUS_CHANGE', 'PAYMENT') NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_actorId_idx`(`actorId`),
    INDEX `AuditLog_entity_entityId_idx`(`entity`, `entityId`),
    INDEX `AuditLog_action_idx`(`action`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Customer_email_idx` ON `Customer`(`email`);

-- CreateIndex
CREATE INDEX `Customer_phoneNumber_idx` ON `Customer`(`phoneNumber`);

-- CreateIndex
CREATE INDEX `Customer_lastName_firstName_idx` ON `Customer`(`lastName`, `firstName`);

-- CreateIndex
CREATE UNIQUE INDEX `Job_referenceNumber_key` ON `Job`(`referenceNumber`);

-- CreateIndex
CREATE UNIQUE INDEX `Job_serviceRequestId_key` ON `Job`(`serviceRequestId`);

-- CreateIndex
CREATE INDEX `Job_customerId_idx` ON `Job`(`customerId`);

-- CreateIndex
CREATE INDEX `Job_serviceTypeId_idx` ON `Job`(`serviceTypeId`);

-- CreateIndex
CREATE INDEX `Job_serviceRequestId_idx` ON `Job`(`serviceRequestId`);

-- CreateIndex
CREATE INDEX `Job_status_idx` ON `Job`(`status`);

-- CreateIndex
CREATE UNIQUE INDEX `ServiceRequest_referenceNumber_key` ON `ServiceRequest`(`referenceNumber`);

-- CreateIndex
CREATE UNIQUE INDEX `ServiceRequest_trackingToken_key` ON `ServiceRequest`(`trackingToken`);

-- CreateIndex
CREATE INDEX `ServiceRequest_status_idx` ON `ServiceRequest`(`status`);

-- CreateIndex
CREATE INDEX `ServiceRequest_referenceNumber_idx` ON `ServiceRequest`(`referenceNumber`);

-- CreateIndex
CREATE INDEX `ServiceType_isActive_idx` ON `ServiceType`(`isActive`);

-- CreateIndex
CREATE UNIQUE INDEX `ServiceType_name_key` ON `ServiceType`(`name`);

-- CreateIndex
CREATE UNIQUE INDEX `User_phone_key` ON `User`(`phone`);

-- CreateIndex
CREATE INDEX `User_role_idx` ON `User`(`role`);

-- CreateIndex
CREATE INDEX `User_status_idx` ON `User`(`status`);

-- AddForeignKey
ALTER TABLE `Job` ADD CONSTRAINT `Job_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Job` ADD CONSTRAINT `Job_serviceTypeId_fkey` FOREIGN KEY (`serviceTypeId`) REFERENCES `ServiceType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Job` ADD CONSTRAINT `Job_serviceRequestId_fkey` FOREIGN KEY (`serviceRequestId`) REFERENCES `ServiceRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Job` ADD CONSTRAINT `Job_assignedStaffId_fkey` FOREIGN KEY (`assignedStaffId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobStatusHistory` ADD CONSTRAINT `JobStatusHistory_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `Job`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobStatusHistory` ADD CONSTRAINT `JobStatusHistory_changedById_fkey` FOREIGN KEY (`changedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `Job`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvoiceItem` ADD CONSTRAINT `InvoiceItem_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `job` RENAME INDEX `Job_assignedStaffId_fkey` TO `Job_assignedStaffId_idx`;

-- RenameIndex
ALTER TABLE `servicerequest` RENAME INDEX `ServiceRequest_customerId_fkey` TO `ServiceRequest_customerId_idx`;

-- RenameIndex
ALTER TABLE `servicerequest` RENAME INDEX `ServiceRequest_serviceTypeId_fkey` TO `ServiceRequest_serviceTypeId_idx`;
