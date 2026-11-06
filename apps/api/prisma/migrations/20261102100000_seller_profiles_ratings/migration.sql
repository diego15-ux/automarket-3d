ALTER TABLE `users`
  ADD COLUMN `avatarKey` VARCHAR(512) NULL,
  ADD COLUMN `bio` VARCHAR(500) NULL;

CREATE TABLE `seller_reviews` (
  `id` CHAR(36) NOT NULL,
  `reservationId` CHAR(36) NOT NULL,
  `buyerId` CHAR(36) NOT NULL,
  `sellerId` CHAR(36) NOT NULL,
  `rating` TINYINT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `seller_reviews_reservationId_key` (`reservationId`),
  INDEX `seller_reviews_sellerId_createdAt_idx` (`sellerId`, `createdAt`),
  CONSTRAINT `seller_reviews_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `cart_reserves` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `seller_reviews_buyerId_fkey` FOREIGN KEY (`buyerId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `seller_reviews_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `seller_reviews_rating_check` CHECK (`rating` BETWEEN 1 AND 5)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
