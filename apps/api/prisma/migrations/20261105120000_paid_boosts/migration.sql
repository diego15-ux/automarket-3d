-- «Destacar»: impulsos pagados con Binance (zona 3/7 días, Portada y pantalla de entrada).
ALTER TABLE `payments` MODIFY `purpose` ENUM('MEMBERSHIP', 'RESERVATION', 'COMMISSION', 'BOOST') NOT NULL;
ALTER TABLE `ledger_entries` MODIFY `type` ENUM('MEMBERSHIP_REVENUE', 'SALE_COMMISSION', 'BOOST_REVENUE') NOT NULL;

ALTER TABLE `platform_settings`
    ADD COLUMN `boostPriceCity3` DECIMAL(10, 2) NOT NULL DEFAULT 3,
    ADD COLUMN `boostPriceCity7` DECIMAL(10, 2) NOT NULL DEFAULT 6,
    ADD COLUMN `boostPriceHome` DECIMAL(10, 2) NOT NULL DEFAULT 15,
    ADD COLUMN `loginPrice1` DECIMAL(10, 2) NOT NULL DEFAULT 3,
    ADD COLUMN `loginPrice2` DECIMAL(10, 2) NOT NULL DEFAULT 6,
    ADD COLUMN `loginPrice3` DECIMAL(10, 2) NOT NULL DEFAULT 8,
    ADD COLUMN `cityBoostSlots` SMALLINT NOT NULL DEFAULT 3,
    ADD COLUMN `homeBoostSlots` SMALLINT NOT NULL DEFAULT 10,
    ADD COLUMN `loginSlots` SMALLINT NOT NULL DEFAULT 6;

CREATE TABLE `boosts` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `kind` ENUM('CITY_3D', 'CITY_7D', 'HOME', 'LOGIN') NOT NULL,
    `days` SMALLINT NOT NULL,
    `zoneKey` VARCHAR(120) NULL,
    `status` ENUM('PENDING_PAYMENT', 'WAITLISTED', 'SCHEDULED', 'ACTIVE', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_PAYMENT',
    `amount` DECIMAL(10, 2) NOT NULL,
    `paymentId` CHAR(36) NULL,
    `paidAt` DATETIME(3) NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `wantDate` DATE NULL,
    `startDate` DATE NULL,
    `endDate` DATE NULL,
    `turn` INTEGER NULL,
    `moved` BOOLEAN NOT NULL DEFAULT false,
    `notifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `boosts_paymentId_key`(`paymentId`),
    INDEX `boosts_kind_status_endsAt_idx`(`kind`, `status`, `endsAt`),
    INDEX `boosts_kind_status_startDate_endDate_idx`(`kind`, `status`, `startDate`, `endDate`),
    INDEX `boosts_zoneKey_status_idx`(`zoneKey`, `status`),
    INDEX `boosts_vehicleId_status_idx`(`vehicleId`, `status`),
    INDEX `boosts_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`),
    CONSTRAINT `boosts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `boosts_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `boosts_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
