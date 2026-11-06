-- Concesionarios aliados: seguir a una agencia para recibir un aviso cuando publique un auto.
CREATE TABLE `dealer_follows` (
    `userId` CHAR(36) NOT NULL,
    `dealerId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dealer_follows_dealerId_idx`(`dealerId`),
    PRIMARY KEY (`userId`, `dealerId`),
    CONSTRAINT `dealer_follows_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `dealer_follows_dealerId_fkey` FOREIGN KEY (`dealerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
