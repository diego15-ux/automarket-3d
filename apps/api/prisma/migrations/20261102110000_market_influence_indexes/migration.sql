CREATE INDEX `conversations_createdAt_vehicleId_buyerId_idx`
  ON `conversations` (`createdAt`, `vehicleId`, `buyerId`);

CREATE INDEX `cart_reserves_createdAt_vehicleId_type_status_buyerId_idx`
  ON `cart_reserves` (`createdAt`, `vehicleId`, `type`, `status`, `buyerId`);
