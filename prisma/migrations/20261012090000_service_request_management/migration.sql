-- Preserve existing requests and job links while allowing multiple jobs per request.
ALTER TABLE `ServiceRequest`
  MODIFY COLUMN `description` TEXT NULL,
  ADD COLUMN `title` VARCHAR(200) NOT NULL DEFAULT '',
  ADD COLUMN `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL';
UPDATE `ServiceRequest` SET `title` = `referenceNumber` WHERE `title` = '';
ALTER TABLE `ServiceType` MODIFY COLUMN `description` TEXT NULL;
CREATE UNIQUE INDEX `ServiceType_organizationId_name_key` ON `ServiceType`(`organizationId`, `name`);
DROP INDEX `ServiceType_name_key` ON `ServiceType`;
-- Job_serviceRequestId_idx already supports the foreign key.
DROP INDEX `Job_serviceRequestId_key` ON `Job`;
CREATE INDEX `ServiceRequest_organizationId_createdAt_id_idx` ON `ServiceRequest`(`organizationId`, `createdAt`, `id`);
CREATE INDEX `ServiceRequest_organizationId_status_createdAt_idx` ON `ServiceRequest`(`organizationId`, `status`, `createdAt`);
CREATE INDEX `ServiceRequest_organizationId_serviceTypeId_createdAt_idx` ON `ServiceRequest`(`organizationId`, `serviceTypeId`, `createdAt`);
