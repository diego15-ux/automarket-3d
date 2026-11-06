-- «Avísame si vuelve»: compradores que esperan un auto en negociación (reservado).
CREATE TABLE `vehicle_watches` (
    `userId` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `vehicle_watches_vehicleId_idx`(`vehicleId`),
    PRIMARY KEY (`userId`, `vehicleId`),
    CONSTRAINT `vehicle_watches_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `vehicle_watches_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
