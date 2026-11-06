-- =============================================================================
-- Restricciones CHECK que Prisma no declara en schema.prisma (MySQL ≥ 8.0.16 · MariaDB ≥ 10.2,
-- p. ej. la MariaDB 10.4 de XAMPP). Estado ACTUAL (18 restricciones); las migraciones las
-- aplican en orden:
--   · 20261030120000_init: las originales.
--   · 20261030180000_p2p_concesionarios: users_dealer_fiscal_data,
--     vehicles_reservation_amount_bounded y platform_settings_ranges (sustituye a
--     platform_settings_rates, que validaba el depósito y la cuota de cancelación).
-- En migraciones nuevas:
--   npx prisma migrate dev --create-only --name <cambio>
--   → añade aquí y en la migration.sql generada → npx prisma migrate dev
-- La unicidad condicional (un apartado activo, una reserva abierta por
-- comprador, un bloqueo por vehículo) se resuelve con columnas UNIQUE que
-- mantiene la aplicación: cart_reserves.cartKey / openKey y
-- vehicles.lockedReservationId.
-- =============================================================================

-- Un concesionario siempre tiene sus datos fiscales (razón social, RIF, dirección y teléfono corporativo).
ALTER TABLE `users`
  ADD CONSTRAINT `users_dealer_fiscal_data` CHECK (
    `accountType` <> 'DEALER'
    OR (`businessName` IS NOT NULL AND `taxId` IS NOT NULL AND `fiscalAddress` IS NOT NULL AND `businessPhone` IS NOT NULL)
  );

-- Datos de vehículo plausibles y coherentes con su condición; el abono de reserva no supera el precio.
ALTER TABLE `vehicles`
  ADD CONSTRAINT `vehicles_price_positive` CHECK (`price` > 0),
  ADD CONSTRAINT `vehicles_mileage_non_negative` CHECK (`mileageKm` >= 0),
  ADD CONSTRAINT `vehicles_owners_range` CHECK (`ownersCount` BETWEEN 0 AND 3),
  ADD CONSTRAINT `vehicles_condition_owners` CHECK (
    (`condition` = 'NEW' AND `ownersCount` = 0) OR (`condition` = 'USED' AND `ownersCount` >= 1)
  ),
  ADD CONSTRAINT `vehicles_reservation_amount_bounded` CHECK (
    `reservationAmount` IS NULL OR (`reservationAmount` > 0 AND `reservationAmount` <= `price`)
  );

-- Una reserva siempre lleva el abono (pagado al vendedor, P2P); un apartado nunca.
ALTER TABLE `cart_reserves`
  ADD CONSTRAINT `cart_reserves_deposit_matches_type` CHECK (
    (`type` = 'RESERVATION' AND `depositAmount` IS NOT NULL AND `depositAmount` > 0)
    OR (`type` = 'CART' AND `depositAmount` IS NULL)
  );

-- Coherencia del mensaje: TEXT lleva cuerpo y no adjunto; multimedia (fotos, vídeos, notas de voz) lleva adjunto.
ALTER TABLE `chat_messages`
  ADD CONSTRAINT `chat_messages_payload_matches_type` CHECK (
    (`type` = 'TEXT' AND `body` IS NOT NULL AND `mediaKey` IS NULL)
    OR (`type` <> 'TEXT' AND `mediaKey` IS NOT NULL AND `mediaMimeType` IS NOT NULL)
  ),
  ADD CONSTRAINT `chat_messages_flags_is_array` CHECK (JSON_TYPE(`moderationFlags`) = 'ARRAY');

-- Un rechazo de KYC siempre explica el motivo al usuario.
ALTER TABLE `kyc_documents`
  ADD CONSTRAINT `kyc_documents_rejection_has_reason` CHECK (
    `status` <> 'REJECTED' OR `rejectionReason` IS NOT NULL
  );

-- Precios y tasas válidos.
ALTER TABLE `plans`
  ADD CONSTRAINT `plans_commission_range` CHECK (`commissionRate` BETWEEN 0 AND 1),
  ADD CONSTRAINT `plans_prices_non_negative` CHECK (`priceMonthly` >= 0 AND `priceYearly` >= 0);

ALTER TABLE `platform_settings`
  ADD CONSTRAINT `platform_settings_singleton` CHECK (`id` = 1),
  ADD CONSTRAINT `platform_settings_ranges` CHECK (
    `sellerResponseHours` BETWEEN 1 AND 72
    AND `reservationHoldDays` BETWEEN 1 AND 30
    AND `commissionDueDays` BETWEEN 1 AND 60
  );

ALTER TABLE `payments`
  ADD CONSTRAINT `payments_amount_positive` CHECK (`amount` > 0),
  ADD CONSTRAINT `payments_refund_bounded` CHECK (`refundedAmount` >= 0 AND `refundedAmount` <= `amount`),
  ADD CONSTRAINT `payments_refund_due_bounded` CHECK (`refundDue` IS NULL OR (`refundDue` > 0 AND `refundDue` <= `amount`));

ALTER TABLE `reviews`
  ADD CONSTRAINT `reviews_rating_range` CHECK (`rating` BETWEEN 1 AND 5);
