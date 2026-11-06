-- Ajustes del panel: cuenta de cobro de Binance (solo ADMIN_ONE) y redes sociales públicas.
ALTER TABLE `platform_settings`
    ADD COLUMN `binancePayId` VARCHAR(20) NULL,
    ADD COLUMN `binancePayName` VARCHAR(80) NULL,
    ADD COLUMN `binanceQrUrl` VARCHAR(1024) NULL,
    ADD COLUMN `binanceQrKey` VARCHAR(512) NULL,
    ADD COLUMN `binanceUpdatedAt` DATETIME(3) NULL,
    ADD COLUMN `binanceUpdatedById` CHAR(36) NULL,
    ADD COLUMN `socialLinks` JSON NULL;

ALTER TABLE `platform_settings`
    ADD CONSTRAINT `platform_settings_binance_pay_id_digits` CHECK (`binancePayId` IS NULL OR `binancePayId` REGEXP '^[0-9]{4,20}$');

-- Instantánea de la cuenta de cobro en cada pago manual.
ALTER TABLE `payments`
    ADD COLUMN `payeePayId` VARCHAR(20) NULL,
    ADD COLUMN `payeeName` VARCHAR(80) NULL;

-- Catálogo de marcas y modelos.
CREATE TABLE `vehicle_brands` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `vehicle_brands_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `vehicle_brand_models` (
    `id` CHAR(36) NOT NULL,
    `brandId` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `vehicle_brand_models_brandId_name_key`(`brandId`, `name`),
    PRIMARY KEY (`id`),
    CONSTRAINT `vehicle_brand_models_brandId_fkey` FOREIGN KEY (`brandId`) REFERENCES `vehicle_brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- El catálogo arranca con las marcas y modelos que ya tienen los anuncios reales de la base
-- (sin inventar nada). La colación _ci hace que «toyota» y «Toyota» cuenten como la misma marca.
INSERT IGNORE INTO `vehicle_brands` (`id`, `name`, `isActive`, `createdAt`, `updatedAt`)
SELECT UUID(), t.`name`, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM (
    SELECT MIN(TRIM(`make`)) AS `name`
    FROM `vehicles`
    WHERE `deletedAt` IS NULL AND TRIM(`make`) <> ''
    GROUP BY LOWER(TRIM(`make`))
) AS t;

INSERT IGNORE INTO `vehicle_brand_models` (`id`, `brandId`, `name`, `isActive`, `createdAt`)
SELECT UUID(), b.`id`, t.`name`, true, CURRENT_TIMESTAMP(3)
FROM (
    SELECT LOWER(TRIM(`make`)) AS `make`, MIN(TRIM(`model`)) AS `name`
    FROM `vehicles`
    WHERE `deletedAt` IS NULL AND TRIM(`model`) <> ''
    GROUP BY LOWER(TRIM(`make`)), LOWER(TRIM(`model`))
) AS t
INNER JOIN `vehicle_brands` AS b ON b.`name` = t.`make`;
