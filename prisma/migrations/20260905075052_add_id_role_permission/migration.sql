-- Step 1: indexes for FK support
CREATE INDEX `RolePermission_roleId_idx` ON `RolePermission`(`roleId`);
CREATE INDEX `RolePermission_permissionId_idx` ON `RolePermission`(`permissionId`);

-- Step 2: add id as nullable first
ALTER TABLE `rolepermission` ADD COLUMN `id` VARCHAR(191) NULL;

-- Step 3: backfill (need UUID/cuid func or app-level script — MySQL has no cuid())
UPDATE `rolepermission` SET `id` = UUID() WHERE `id` IS NULL;

-- Step 4: make required, swap PK
ALTER TABLE `rolepermission`
  MODIFY `id` VARCHAR(191) NOT NULL,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`id`);

-- Step 5: uniqueness on old composite
CREATE UNIQUE INDEX `RolePermission_roleId_permissionId_key` ON `RolePermission`(`roleId`, `permissionId`);