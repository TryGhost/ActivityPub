ALTER TABLE `key_value`
MODIFY COLUMN `created_at` TIMESTAMP(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
MODIFY COLUMN `updated_at` TIMESTAMP(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
