-- =============================================================================
-- Reservas P2P, cuentas de concesionario, planes por tipo de cuenta, comisión
-- post-venta con Binance, fondo del login y Términos editables.
-- Compatible con MySQL 8.0.19+ y MariaDB 10.4+ (XAMPP). Conserva los datos.
-- =============================================================================

-- ─── Planes: BASIC → PREMIUM · MEDIUM → DEALER_BASIC · PRO → DEALER_PRO ─────
-- Se amplía el ENUM, se traducen los datos y se estrecha (sin perder asignaciones).
ALTER TABLE `users` DROP FOREIGN KEY `users_planCode_fkey`;

ALTER TABLE `plans` MODIFY `code` ENUM('FREE', 'BASIC', 'MEDIUM', 'PRO', 'PREMIUM', 'DEALER_BASIC', 'DEALER_PRO') NOT NULL;
ALTER TABLE `users` MODIFY `planCode` ENUM('FREE', 'BASIC', 'MEDIUM', 'PRO', 'PREMIUM', 'DEALER_BASIC', 'DEALER_PRO') NOT NULL DEFAULT 'FREE';
ALTER TABLE `membership_periods` MODIFY `planCode` ENUM('FREE', 'BASIC', 'MEDIUM', 'PRO', 'PREMIUM', 'DEALER_BASIC', 'DEALER_PRO') NOT NULL;
ALTER TABLE `payments` MODIFY `planCode` ENUM('FREE', 'BASIC', 'MEDIUM', 'PRO', 'PREMIUM', 'DEALER_BASIC', 'DEALER_PRO') NULL;

UPDATE `plans` SET `code` = CASE `code` WHEN 'BASIC' THEN 'PREMIUM' WHEN 'MEDIUM' THEN 'DEALER_BASIC' WHEN 'PRO' THEN 'DEALER_PRO' ELSE `code` END;
UPDATE `users` SET `planCode` = CASE `planCode` WHEN 'BASIC' THEN 'PREMIUM' WHEN 'MEDIUM' THEN 'DEALER_BASIC' WHEN 'PRO' THEN 'DEALER_PRO' ELSE `planCode` END;
UPDATE `membership_periods` SET `planCode` = CASE `planCode` WHEN 'BASIC' THEN 'PREMIUM' WHEN 'MEDIUM' THEN 'DEALER_BASIC' WHEN 'PRO' THEN 'DEALER_PRO' ELSE `planCode` END;
UPDATE `payments` SET `planCode` = CASE `planCode` WHEN 'BASIC' THEN 'PREMIUM' WHEN 'MEDIUM' THEN 'DEALER_BASIC' WHEN 'PRO' THEN 'DEALER_PRO' ELSE `planCode` END
WHERE `planCode` IS NOT NULL;

ALTER TABLE `plans` MODIFY `code` ENUM('FREE', 'PREMIUM', 'DEALER_BASIC', 'DEALER_PRO') NOT NULL;
ALTER TABLE `users` MODIFY `planCode` ENUM('FREE', 'PREMIUM', 'DEALER_BASIC', 'DEALER_PRO') NOT NULL DEFAULT 'FREE';
ALTER TABLE `membership_periods` MODIFY `planCode` ENUM('FREE', 'PREMIUM', 'DEALER_BASIC', 'DEALER_PRO') NOT NULL;
ALTER TABLE `payments` MODIFY `planCode` ENUM('FREE', 'PREMIUM', 'DEALER_BASIC', 'DEALER_PRO') NULL;

ALTER TABLE `users` ADD CONSTRAINT `users_planCode_fkey` FOREIGN KEY (`planCode`) REFERENCES `plans`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cada plan indica qué tipo de cuenta puede contratarlo (NULL = cualquiera).
ALTER TABLE `plans` ADD COLUMN `accountType` ENUM('INDIVIDUAL', 'DEALER') NULL;
UPDATE `plans` SET `name` = 'Gratis', `accountType` = NULL WHERE `code` = 'FREE';
UPDATE `plans` SET `name` = 'Premium', `accountType` = 'INDIVIDUAL' WHERE `code` = 'PREMIUM';
UPDATE `plans` SET `name` = 'Concesionario Básico', `accountType` = 'DEALER', `maxActiveListings` = 20 WHERE `code` = 'DEALER_BASIC';
UPDATE `plans` SET `name` = 'Concesionario Pro', `accountType` = 'DEALER', `maxActiveListings` = NULL WHERE `code` = 'DEALER_PRO';

-- ─── Cuentas: persona natural o concesionario con datos fiscales ────────────
ALTER TABLE `users` ADD COLUMN `accountType` ENUM('INDIVIDUAL', 'DEALER') NOT NULL DEFAULT 'INDIVIDUAL',
    ADD COLUMN `businessName` VARCHAR(160) NULL,
    ADD COLUMN `taxId` VARCHAR(20) NULL,
    ADD COLUMN `fiscalAddress` VARCHAR(300) NULL,
    ADD COLUMN `businessPhone` VARCHAR(32) NULL;
CREATE UNIQUE INDEX `users_taxId_key` ON `users`(`taxId`);
ALTER TABLE `users` ADD CONSTRAINT `users_dealer_fiscal_data` CHECK (
  `accountType` <> 'DEALER'
  OR (`businessName` IS NOT NULL AND `taxId` IS NOT NULL AND `fiscalAddress` IS NOT NULL AND `businessPhone` IS NOT NULL)
);

-- ─── Vehículos: abono de reserva que fija el vendedor ───────────────────────
ALTER TABLE `vehicles` ADD COLUMN `reservationAmount` DECIMAL(12, 2) NULL;
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_reservation_amount_bounded` CHECK (
  `reservationAmount` IS NULL OR (`reservationAmount` > 0 AND `reservationAmount` <= `price`)
);

-- ─── Reservas P2P: el abono va al vendedor; la plataforma cobra la comisión ──
ALTER TABLE `cart_reserves` DROP COLUMN `depositRate`,
    DROP COLUMN `cancellationFeeAmount`,
    DROP COLUMN `refundAmount`,
    ADD COLUMN `salePrice` DECIMAL(12, 2) NULL,
    ADD COLUMN `commissionDueAt` DATETIME(3) NULL,
    ADD COLUMN `commissionPaidAt` DATETIME(3) NULL,
    ADD COLUMN `legalAcceptedAt` DATETIME(3) NULL,
    MODIFY `status` ENUM('ACTIVE', 'AWAITING_SELLER', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'COMPLETED') NOT NULL DEFAULT 'ACTIVE';
CREATE INDEX `cart_reserves_commissionPaidAt_commissionDueAt_idx` ON `cart_reserves`(`commissionPaidAt`, `commissionDueAt`);

ALTER TABLE `payments` MODIFY `purpose` ENUM('MEMBERSHIP', 'RESERVATION', 'COMMISSION') NOT NULL;
ALTER TABLE `ledger_entries` MODIFY `type` ENUM('MEMBERSHIP_REVENUE', 'SALE_COMMISSION') NOT NULL;

-- ─── Ajustes: plazos de la reserva y la comisión, fondo del login, Términos ──
ALTER TABLE `platform_settings` DROP CONSTRAINT `platform_settings_rates`;
ALTER TABLE `platform_settings` DROP COLUMN `depositRate`,
    DROP COLUMN `cancellationFeeRate`,
    DROP COLUMN `requireSellerKycForReservations`,
    ADD COLUMN `reservationHoldDays` SMALLINT NOT NULL DEFAULT 7,
    ADD COLUMN `commissionDueDays` SMALLINT NOT NULL DEFAULT 7,
    ADD COLUMN `loginBackgroundUrl` VARCHAR(1024) NULL,
    ADD COLUMN `loginBackgroundKey` VARCHAR(512) NULL,
    ADD COLUMN `termsContent` MEDIUMTEXT NULL,
    ADD COLUMN `termsUpdatedAt` DATETIME(3) NULL;
ALTER TABLE `platform_settings` ADD CONSTRAINT `platform_settings_ranges` CHECK (
  `sellerResponseHours` BETWEEN 1 AND 72
  AND `reservationHoldDays` BETWEEN 1 AND 30
  AND `commissionDueDays` BETWEEN 1 AND 60
);
