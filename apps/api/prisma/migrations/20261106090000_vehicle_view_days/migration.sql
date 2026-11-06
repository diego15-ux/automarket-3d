-- Vistas reales de cada anuncio por día (calendario de Venezuela). Una por persona y día:
-- alimenta el panel del concesionario (indicadores, gráfica de 14 días e inventario).
CREATE TABLE `vehicle_view_days` (
    `vehicleId` CHAR(36) NOT NULL,
    `day` DATE NOT NULL,
    `views` INTEGER UNSIGNED NOT NULL DEFAULT 0,

    INDEX `vehicle_view_days_day_idx`(`day`),
    PRIMARY KEY (`vehicleId`, `day`),
    CONSTRAINT `vehicle_view_days_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
