-- «Guardar» en la ficha: autos guardados de cada persona, con el precio que tenían al guardarlos.
-- Si el vendedor baja el precio, se avisa a quien lo guardó (se puede apagar en Mis alertas).
CREATE TABLE `vehicle_favorites` (
    `userId` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `savedPrice` DECIMAL(12, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `vehicle_favorites_vehicleId_idx`(`vehicleId`),
    INDEX `vehicle_favorites_userId_createdAt_idx`(`userId`, `createdAt` DESC),
    PRIMARY KEY (`userId`, `vehicleId`),
    CONSTRAINT `vehicle_favorites_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `vehicle_favorites_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `users` ADD COLUMN `priceDropAlerts` BOOLEAN NOT NULL DEFAULT true;
