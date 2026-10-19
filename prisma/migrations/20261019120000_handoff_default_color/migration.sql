-- Change only future row defaults. Preserve every organization's saved color.
ALTER TABLE `OrganizationSettings` ALTER COLUMN `primaryColor` SET DEFAULT '#0d887d';
