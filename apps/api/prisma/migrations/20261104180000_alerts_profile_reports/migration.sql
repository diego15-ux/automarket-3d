-- «Mis alertas»: búsquedas guardadas que avisan de autos nuevos (al instante, a diario o a la semana).
CREATE TABLE `search_alerts` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `make` VARCHAR(60) NULL,
    `model` VARCHAR(80) NULL,
    `maxPrice` DECIMAL(12, 2) NULL,
    `country` CHAR(2) NULL,
    `city` VARCHAR(80) NULL,
    `yearFrom` SMALLINT NULL,
    `frequency` ENUM('INSTANT', 'DAILY', 'WEEKLY') NOT NULL DEFAULT 'INSTANT',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `lastCheckedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastNotifiedAt` DATETIME(3) NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `search_alerts_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `search_alerts_active_lastCheckedAt_idx`(`active`, `lastCheckedAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `search_alerts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Denuncias de un perfil (desde la página pública del vendedor): sin anuncio.
ALTER TABLE `reports`
    MODIFY `vehicleId` CHAR(36) NULL,
    MODIFY `kind` ENUM('VEHICLE', 'CHAT', 'USER') NOT NULL DEFAULT 'VEHICLE';
