-- Preserve existing rows and same-tenant archived identifier reservations.
-- Global uniqueness implies these scoped keys are valid for the existing data.
-- Add the scoped protections before removing the wider restrictions.
ALTER TABLE `Customer`
    ADD UNIQUE INDEX `Customer_organizationId_name_key` (`organizationId`, `name`),
    ADD UNIQUE INDEX `Customer_organizationId_email_key` (`organizationId`, `email`),
    ADD UNIQUE INDEX `Customer_organizationId_phoneNumber_key` (`organizationId`, `phoneNumber`),
    DROP INDEX `Customer_name_key`,
    DROP INDEX `Customer_email_key`,
    DROP INDEX `Customer_phoneNumber_key`;
