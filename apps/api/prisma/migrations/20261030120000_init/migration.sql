-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `passwordHash` VARCHAR(255) NULL,
    `name` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `avatarUrl` VARCHAR(1024) NULL,
    `role` ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',
    `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `country` CHAR(2) NULL,
    `city` VARCHAR(80) NULL,
    `isVerified` BOOLEAN NOT NULL DEFAULT false,
    `verifiedAt` DATETIME(3) NULL,
    `emailVerifiedAt` DATETIME(3) NULL,
    `termsAcceptedAt` DATETIME(3) NULL,
    `tokenVersion` INTEGER NOT NULL DEFAULT 0,
    `lastLoginAt` DATETIME(3) NULL,
    `planCode` ENUM('FREE', 'BASIC', 'MEDIUM', 'PRO') NOT NULL DEFAULT 'FREE',
    `planCycle` ENUM('MONTHLY', 'YEARLY') NULL,
    `planExpiresAt` DATETIME(3) NULL,
    `featureCreditMonth` CHAR(7) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_country_city_idx`(`country`, `city`),
    INDEX `users_planCode_planExpiresAt_idx`(`planCode`, `planExpiresAt`),
    INDEX `users_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_accounts` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `provider` ENUM('GOOGLE', 'APPLE') NOT NULL,
    `providerAccountId` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `oauth_accounts_userId_idx`(`userId`),
    UNIQUE INDEX `oauth_accounts_provider_providerAccountId_key`(`provider`, `providerAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `familyId` CHAR(36) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `userAgent` VARCHAR(512) NULL,
    `ip` VARCHAR(45) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_tokenHash_key`(`tokenHash`),
    INDEX `refresh_tokens_userId_idx`(`userId`),
    INDEX `refresh_tokens_familyId_idx`(`familyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `ip` VARCHAR(45) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `password_reset_tokens_tokenHash_key`(`tokenHash`),
    INDEX `password_reset_tokens_userId_createdAt_idx`(`userId`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plans` (
    `code` ENUM('FREE', 'BASIC', 'MEDIUM', 'PRO') NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `maxActiveListings` INTEGER NULL,
    `listingDurationDays` SMALLINT NULL,
    `commissionRate` DECIMAL(5, 4) NOT NULL,
    `featuredSlots` SMALLINT NOT NULL DEFAULT 0,
    `monthlyFeaturedCredits` SMALLINT NOT NULL DEFAULT 0,
    `searchBoost` SMALLINT NOT NULL DEFAULT 0,
    `priceMonthly` DECIMAL(10, 2) NOT NULL,
    `priceYearly` DECIMAL(10, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `membership_periods` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `planCode` ENUM('FREE', 'BASIC', 'MEDIUM', 'PRO') NOT NULL,
    `cycle` ENUM('MONTHLY', 'YEARLY') NULL,
    `source` ENUM('BINANCE', 'ADMIN', 'SYSTEM') NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NULL,
    `amount` DECIMAL(10, 2) NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `paymentId` CHAR(36) NULL,
    `grantedById` CHAR(36) NULL,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `membership_periods_paymentId_key`(`paymentId`),
    INDEX `membership_periods_userId_createdAt_idx`(`userId`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_settings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `depositRate` DECIMAL(5, 4) NOT NULL DEFAULT 0.0200,
    `cancellationFeeRate` DECIMAL(5, 4) NOT NULL DEFAULT 0.1000,
    `sellerResponseHours` SMALLINT NOT NULL DEFAULT 48,
    `requireSellerKycForReservations` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vehicles` (
    `id` CHAR(36) NOT NULL,
    `sellerId` CHAR(36) NOT NULL,
    `slug` VARCHAR(160) NOT NULL,
    `make` VARCHAR(60) NOT NULL,
    `model` VARCHAR(80) NOT NULL,
    `version` VARCHAR(120) NULL,
    `year` SMALLINT NOT NULL,
    `condition` ENUM('NEW', 'USED') NOT NULL DEFAULT 'USED',
    `ownersCount` TINYINT NOT NULL DEFAULT 1,
    `mileageKm` INTEGER NOT NULL,
    `price` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `category` ENUM('SPORTS', 'SUV', 'SEDAN', 'ELECTRIC', 'PICKUP', 'CONVERTIBLE', 'HATCHBACK') NOT NULL,
    `fuelType` ENUM('GASOLINE', 'DIESEL', 'HYBRID', 'PLUG_IN_HYBRID', 'ELECTRIC') NOT NULL,
    `transmission` ENUM('MANUAL', 'AUTOMATIC', 'DUAL_CLUTCH', 'CVT') NOT NULL,
    `drivetrain` ENUM('FWD', 'RWD', 'AWD', 'FOUR_WD') NULL,
    `horsepower` SMALLINT NULL,
    `torqueNm` SMALLINT NULL,
    `engineCc` INTEGER NULL,
    `batteryKwh` DECIMAL(5, 1) NULL,
    `rangeKm` SMALLINT NULL,
    `exteriorColor` VARCHAR(40) NULL,
    `interiorColor` VARCHAR(40) NULL,
    `doors` TINYINT NULL,
    `seats` TINYINT NULL,
    `vin` VARCHAR(17) NULL,
    `description` TEXT NULL,
    `specs` JSON NULL,
    `city` VARCHAR(80) NOT NULL,
    `country` CHAR(2) NOT NULL,
    `latitude` DECIMAL(9, 6) NULL,
    `longitude` DECIMAL(9, 6) NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'PAUSED', 'RESERVED', 'SOLD', 'EXPIRED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `searchBoost` SMALLINT NOT NULL DEFAULT 0,
    `featuredAt` DATETIME(3) NULL,
    `featuredUntil` DATETIME(3) NULL,
    `lockedReservationId` CHAR(36) NULL,
    `model3dUrl` VARCHAR(1024) NULL,
    `model3dPosterUrl` VARCHAR(1024) NULL,
    `model3dSizeBytes` INTEGER NULL,
    `publishedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `vehicles_slug_key`(`slug`),
    UNIQUE INDEX `vehicles_vin_key`(`vin`),
    UNIQUE INDEX `vehicles_lockedReservationId_key`(`lockedReservationId`),
    INDEX `vehicles_status_country_city_idx`(`status`, `country`, `city`),
    INDEX `vehicles_status_category_publishedAt_idx`(`status`, `category`, `publishedAt` DESC),
    INDEX `vehicles_status_price_idx`(`status`, `price`),
    INDEX `vehicles_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `vehicles_make_model_year_idx`(`make`, `model`, `year`),
    INDEX `vehicles_sellerId_status_idx`(`sellerId`, `status`),
    INDEX `vehicles_featuredUntil_idx`(`featuredUntil`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vehicle_media` (
    `id` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `kind` ENUM('IMAGE', 'VIDEO') NOT NULL DEFAULT 'IMAGE',
    `storageKey` VARCHAR(512) NOT NULL,
    `url` VARCHAR(1024) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL DEFAULT 0,
    `alt` VARCHAR(160) NULL,
    `position` SMALLINT NOT NULL DEFAULT 0,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `durationMs` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `vehicle_media_storageKey_key`(`storageKey`),
    INDEX `vehicle_media_vehicleId_position_idx`(`vehicleId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carousel_items` (
    `id` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `position` SMALLINT NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `carousel_items_vehicleId_key`(`vehicleId`),
    INDEX `carousel_items_isActive_position_idx`(`isActive`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kyc_documents` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `type` ENUM('NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE', 'SELFIE', 'PROOF_OF_ADDRESS', 'BUSINESS_REGISTRATION') NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `s3Bucket` VARCHAR(63) NOT NULL,
    `s3Key` VARCHAR(512) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `rejectionReason` VARCHAR(500) NULL,
    `reviewedById` CHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `kyc_documents_s3Key_key`(`s3Key`),
    INDEX `kyc_documents_userId_status_idx`(`userId`, `status`),
    INDEX `kyc_documents_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `kyc_documents_sha256_idx`(`sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversations` (
    `id` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `buyerId` CHAR(36) NOT NULL,
    `sellerId` CHAR(36) NOT NULL,
    `lastMessageAt` DATETIME(3) NULL,
    `buyerLastReadAt` DATETIME(3) NULL,
    `sellerLastReadAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `conversations_buyerId_lastMessageAt_idx`(`buyerId`, `lastMessageAt` DESC),
    INDEX `conversations_sellerId_lastMessageAt_idx`(`sellerId`, `lastMessageAt` DESC),
    UNIQUE INDEX `conversations_vehicleId_buyerId_key`(`vehicleId`, `buyerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_messages` (
    `id` CHAR(36) NOT NULL,
    `conversationId` CHAR(36) NOT NULL,
    `senderId` CHAR(36) NOT NULL,
    `clientId` VARCHAR(64) NOT NULL,
    `type` ENUM('TEXT', 'IMAGE', 'VIDEO', 'AUDIO') NOT NULL DEFAULT 'TEXT',
    `body` TEXT NULL,
    `mediaKey` VARCHAR(512) NULL,
    `mediaMimeType` VARCHAR(100) NULL,
    `mediaSizeBytes` INTEGER NULL,
    `durationMs` INTEGER NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `moderationFlags` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `editedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `chat_messages_conversationId_createdAt_idx`(`conversationId`, `createdAt` DESC),
    UNIQUE INDEX `chat_messages_senderId_clientId_key`(`senderId`, `clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cart_reserves` (
    `id` CHAR(36) NOT NULL,
    `buyerId` CHAR(36) NOT NULL,
    `sellerId` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `type` ENUM('CART', 'RESERVATION') NOT NULL DEFAULT 'CART',
    `status` ENUM('ACTIVE', 'PENDING_PAYMENT', 'AWAITING_SELLER', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'ACTIVE',
    `cartKey` VARCHAR(80) NULL,
    `openKey` VARCHAR(80) NULL,
    `depositAmount` DECIMAL(12, 2) NULL,
    `depositRate` DECIMAL(5, 4) NULL,
    `commissionRate` DECIMAL(5, 4) NULL,
    `commissionAmount` DECIMAL(12, 2) NULL,
    `cancellationFeeAmount` DECIMAL(12, 2) NULL,
    `refundAmount` DECIMAL(12, 2) NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `paymentId` CHAR(36) NULL,
    `expiresAt` DATETIME(3) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `decidedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `cancelledById` CHAR(36) NULL,
    `decisionNote` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cart_reserves_cartKey_key`(`cartKey`),
    UNIQUE INDEX `cart_reserves_openKey_key`(`openKey`),
    UNIQUE INDEX `cart_reserves_paymentId_key`(`paymentId`),
    INDEX `cart_reserves_buyerId_type_status_idx`(`buyerId`, `type`, `status`),
    INDEX `cart_reserves_sellerId_type_status_idx`(`sellerId`, `type`, `status`),
    INDEX `cart_reserves_vehicleId_status_idx`(`vehicleId`, `status`),
    INDEX `cart_reserves_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `purpose` ENUM('MEMBERSHIP', 'RESERVATION') NOT NULL,
    `provider` VARCHAR(20) NOT NULL DEFAULT 'BINANCE',
    `mode` ENUM('MERCHANT', 'MANUAL') NOT NULL,
    `status` ENUM('PENDING', 'SUBMITTED', 'PAID', 'REJECTED', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `reference` VARCHAR(32) NOT NULL,
    `prepayId` VARCHAR(64) NULL,
    `checkoutUrl` VARCHAR(1024) NULL,
    `qrcodeLink` VARCHAR(1024) NULL,
    `qrContent` VARCHAR(1024) NULL,
    `deeplink` VARCHAR(1024) NULL,
    `txId` VARCHAR(100) NULL,
    `payerBinanceId` VARCHAR(64) NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'USDT',
    `refundDue` DECIMAL(12, 2) NULL,
    `refundedAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `refundTxId` VARCHAR(100) NULL,
    `planCode` ENUM('FREE', 'BASIC', 'MEDIUM', 'PRO') NULL,
    `cycle` ENUM('MONTHLY', 'YEARLY') NULL,
    `expiresAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `refundedAt` DATETIME(3) NULL,
    `reviewedById` CHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` VARCHAR(500) NULL,
    `failureReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payments_reference_key`(`reference`),
    UNIQUE INDEX `payments_prepayId_key`(`prepayId`),
    UNIQUE INDEX `payments_txId_key`(`txId`),
    INDEX `payments_userId_createdAt_idx`(`userId`, `createdAt` DESC),
    INDEX `payments_purpose_status_createdAt_idx`(`purpose`, `status`, `createdAt`),
    INDEX `payments_mode_status_createdAt_idx`(`mode`, `status`, `createdAt`),
    INDEX `payments_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_webhook_events` (
    `id` VARCHAR(64) NOT NULL,
    `eventType` VARCHAR(80) NOT NULL,
    `resourceId` VARCHAR(64) NULL,
    `status` ENUM('PROCESSED', 'IGNORED', 'FAILED') NOT NULL,
    `payload` JSON NOT NULL,
    `error` VARCHAR(500) NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payment_webhook_events_eventType_receivedAt_idx`(`eventType`, `receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger_entries` (
    `id` CHAR(36) NOT NULL,
    `type` ENUM('MEMBERSHIP_REVENUE', 'RESERVATION_COMMISSION', 'CANCELLATION_FEE', 'SELLER_PAYABLE', 'DEPOSIT_REFUND') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `userId` CHAR(36) NULL,
    `reservationId` CHAR(36) NULL,
    `paymentId` CHAR(36) NULL,
    `description` VARCHAR(200) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ledger_entries_type_occurredAt_idx`(`type`, `occurredAt`),
    INDEX `ledger_entries_occurredAt_idx`(`occurredAt`),
    UNIQUE INDEX `ledger_entries_type_reservationId_key`(`type`, `reservationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `blocked_terms` (
    `id` CHAR(36) NOT NULL,
    `term` VARCHAR(80) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `blocked_terms_term_key`(`term`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reports` (
    `id` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `reporterId` CHAR(36) NOT NULL,
    `reason` ENUM('FRAUD', 'WRONG_INFO', 'OFFENSIVE', 'SPAM', 'OTHER') NOT NULL,
    `details` VARCHAR(2000) NULL,
    `status` ENUM('OPEN', 'RESOLVED', 'DISMISSED') NOT NULL DEFAULT 'OPEN',
    `resolutionNote` VARCHAR(500) NULL,
    `resolvedById` CHAR(36) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `reports_status_createdAt_idx`(`status`, `createdAt`),
    UNIQUE INDEX `reports_vehicleId_reporterId_key`(`vehicleId`, `reporterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reviews` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `rating` TINYINT NOT NULL,
    `comment` VARCHAR(1000) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `moderatedById` CHAR(36) NULL,
    `moderatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `reviews_userId_key`(`userId`),
    INDEX `reviews_status_createdAt_idx`(`status`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_messages` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `subject` VARCHAR(160) NULL,
    `message` TEXT NOT NULL,
    `status` ENUM('NEW', 'HANDLED') NOT NULL DEFAULT 'NEW',
    `ip` VARCHAR(45) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `contact_messages_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `body` VARCHAR(500) NOT NULL,
    `link` VARCHAR(300) NULL,
    `dedupeKey` VARCHAR(160) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `notifications_dedupeKey_key`(`dedupeKey`),
    INDEX `notifications_userId_createdAt_idx`(`userId`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_outbox` (
    `id` CHAR(36) NOT NULL,
    `toEmail` VARCHAR(254) NOT NULL,
    `subject` VARCHAR(200) NOT NULL,
    `html` MEDIUMTEXT NOT NULL,
    `text` TEXT NOT NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` SMALLINT NOT NULL DEFAULT 0,
    `lastError` VARCHAR(500) NULL,
    `sendAfter` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `email_outbox_status_sendAfter_idx`(`status`, `sendAfter`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `actorId` CHAR(36) NULL,
    `action` VARCHAR(64) NOT NULL,
    `entityType` VARCHAR(40) NOT NULL,
    `entityId` VARCHAR(64) NOT NULL,
    `metadata` JSON NULL,
    `ip` VARCHAR(45) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entityType_entityId_createdAt_idx`(`entityType`, `entityId`, `createdAt` DESC),
    INDEX `audit_logs_actorId_createdAt_idx`(`actorId`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_planCode_fkey` FOREIGN KEY (`planCode`) REFERENCES `plans`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_accounts` ADD CONSTRAINT `oauth_accounts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `membership_periods` ADD CONSTRAINT `membership_periods_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `membership_periods` ADD CONSTRAINT `membership_periods_grantedById_fkey` FOREIGN KEY (`grantedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `membership_periods` ADD CONSTRAINT `membership_periods_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicle_media` ADD CONSTRAINT `vehicle_media_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carousel_items` ADD CONSTRAINT `carousel_items_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kyc_documents` ADD CONSTRAINT `kyc_documents_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kyc_documents` ADD CONSTRAINT `kyc_documents_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_buyerId_fkey` FOREIGN KEY (`buyerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart_reserves` ADD CONSTRAINT `cart_reserves_buyerId_fkey` FOREIGN KEY (`buyerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart_reserves` ADD CONSTRAINT `cart_reserves_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart_reserves` ADD CONSTRAINT `cart_reserves_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart_reserves` ADD CONSTRAINT `cart_reserves_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `cart_reserves`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_reporterId_fkey` FOREIGN KEY (`reporterId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_moderatedById_fkey` FOREIGN KEY (`moderatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contact_messages` ADD CONSTRAINT `contact_messages_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- =============================================================================
-- Restricciones CHECK que Prisma no declara en schema.prisma (MySQL ≥ 8.0.16 · MariaDB ≥ 10.2,
-- p. ej. la MariaDB 10.4 de XAMPP).
-- Forman parte de la migración inicial; en migraciones nuevas:
--   npx prisma migrate dev --create-only --name <cambio>
--   → añade aquí y en la migration.sql generada → npx prisma migrate dev
-- La unicidad condicional (un apartado activo, una reserva abierta por
-- comprador, un bloqueo por vehículo) se resuelve con columnas UNIQUE que
-- mantiene la aplicación: cart_reserves.cartKey / openKey y
-- vehicles.lockedReservationId.
-- =============================================================================

-- Datos de vehículo plausibles y coherentes con su condición.
ALTER TABLE `vehicles`
  ADD CONSTRAINT `vehicles_price_positive` CHECK (`price` > 0),
  ADD CONSTRAINT `vehicles_mileage_non_negative` CHECK (`mileageKm` >= 0),
  ADD CONSTRAINT `vehicles_owners_range` CHECK (`ownersCount` BETWEEN 0 AND 3),
  ADD CONSTRAINT `vehicles_condition_owners` CHECK (
    (`condition` = 'NEW' AND `ownersCount` = 0) OR (`condition` = 'USED' AND `ownersCount` >= 1)
  );

-- Una reserva siempre lleva depósito; un apartado nunca.
ALTER TABLE `cart_reserves`
  ADD CONSTRAINT `cart_reserves_deposit_matches_type` CHECK (
    (`type` = 'RESERVATION' AND `depositAmount` IS NOT NULL AND `depositAmount` > 0)
    OR (`type` = 'CART' AND `depositAmount` IS NULL)
  );

-- Coherencia del mensaje: TEXT lleva cuerpo y no adjunto; multimedia lleva adjunto.
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
  ADD CONSTRAINT `platform_settings_rates` CHECK (
    `depositRate` > 0 AND `depositRate` <= 0.2 AND `cancellationFeeRate` BETWEEN 0 AND 0.5
    AND `sellerResponseHours` BETWEEN 1 AND 72
  );

ALTER TABLE `payments`
  ADD CONSTRAINT `payments_amount_positive` CHECK (`amount` > 0),
  ADD CONSTRAINT `payments_refund_bounded` CHECK (`refundedAmount` >= 0 AND `refundedAmount` <= `amount`),
  ADD CONSTRAINT `payments_refund_due_bounded` CHECK (`refundDue` IS NULL OR (`refundDue` > 0 AND `refundDue` <= `amount`));

ALTER TABLE `reviews`
  ADD CONSTRAINT `reviews_rating_range` CHECK (`rating` BETWEEN 1 AND 5);
