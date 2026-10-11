-- Run before deploying tri-state override resolution, with old permission writers stopped.
-- Previously false rows represented removed grants and had no authorization effect.
-- Restore those rows to inheritance so they do not become unintended explicit denials.
-- After this migration, true means Grant, false means Deny, and no row means Inherit.
DELETE FROM `UserPermission` WHERE `isActive` = false;
