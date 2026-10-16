-- Preserve legacy applications without manufacturing evidence of agreement.
ALTER TABLE `SignupRequest`
    ADD COLUMN `termsAcceptedAt` DATETIME(3) NULL,
    ADD COLUMN `termsVersion` VARCHAR(32) NULL,
    ADD COLUMN `privacyVersion` VARCHAR(32) NULL;
