-- «En negociación»: el vendedor marca que está cerrando la venta de una reserva confirmada.
ALTER TABLE `cart_reserves` ADD COLUMN `negotiatingAt` DATETIME(3) NULL;
-- Copia en el vehículo para mostrarlo en el catálogo sin otra consulta.
ALTER TABLE `vehicles` ADD COLUMN `negotiatingAt` DATETIME(3) NULL;

-- Denuncias desde el chat: además de anuncios, una conversación (a la otra persona).
ALTER TABLE `reports`
    ADD COLUMN `kind` ENUM('VEHICLE', 'CHAT') NOT NULL DEFAULT 'VEHICLE',
    ADD COLUMN `conversationId` CHAR(36) NULL,
    ADD COLUMN `reportedUserId` CHAR(36) NULL,
    ADD COLUMN `dedupeKey` VARCHAR(90) NULL;

-- Las denuncias que ya existen son de anuncios: una por autor y anuncio.
UPDATE `reports` SET `dedupeKey` = CONCAT('V:', `vehicleId`, ':', `reporterId`);
ALTER TABLE `reports` MODIFY `dedupeKey` VARCHAR(90) NOT NULL;
CREATE UNIQUE INDEX `reports_dedupeKey_key` ON `reports`(`dedupeKey`);

-- El índice nuevo sostiene la clave foránea del anuncio antes de quitar el único viejo.
CREATE INDEX `reports_vehicleId_idx` ON `reports`(`vehicleId`);
DROP INDEX `reports_vehicleId_reporterId_key` ON `reports`;
CREATE INDEX `reports_conversationId_idx` ON `reports`(`conversationId`);
CREATE INDEX `reports_reportedUserId_idx` ON `reports`(`reportedUserId`);

ALTER TABLE `reports` ADD CONSTRAINT `reports_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `reports` ADD CONSTRAINT `reports_reportedUserId_fkey` FOREIGN KEY (`reportedUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
