ALTER TABLE `vehicles`
    MODIFY `status` ENUM('DRAFT', 'PUBLISHED', 'PAUSED', 'RESERVED', 'PENDING_SALE', 'SOLD', 'EXPIRED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT';

CREATE TABLE `vehicle_sales` (
    `id` CHAR(36) NOT NULL,
    `sellerId` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `paymentId` CHAR(36) NULL,
    `status` ENUM('PENDING_PAYMENT', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_PAYMENT',
    `previousStatus` ENUM('DRAFT', 'PUBLISHED', 'PAUSED', 'RESERVED', 'PENDING_SALE', 'SOLD', 'EXPIRED', 'ARCHIVED') NOT NULL,
    `salePrice` DECIMAL(12, 2) NOT NULL,
    `commissionRate` DECIMAL(5, 4) NOT NULL,
    `commissionAmount` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `vehicle_sales_paymentId_key`(`paymentId`),
    INDEX `vehicle_sales_sellerId_status_createdAt_idx`(`sellerId`, `status`, `createdAt`),
    INDEX `vehicle_sales_vehicleId_status_idx`(`vehicleId`, `status`),
    PRIMARY KEY (`id`),
    CONSTRAINT `vehicle_sales_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `vehicle_sales_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `vehicle_sales_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ledger_entries`
    ADD COLUMN `vehicleSaleId` CHAR(36) NULL,
    ADD UNIQUE INDEX `ledger_entries_type_vehicleSaleId_key`(`type`, `vehicleSaleId`),
    ADD CONSTRAINT `ledger_entries_vehicleSaleId_fkey` FOREIGN KEY (`vehicleSaleId`) REFERENCES `vehicle_sales`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
