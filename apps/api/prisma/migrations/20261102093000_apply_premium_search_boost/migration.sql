UPDATE `vehicles` AS v
INNER JOIN `users` AS u ON u.`id` = v.`sellerId`
SET v.`searchBoost` = 2
WHERE u.`planCode` = 'PREMIUM'
  AND u.`planExpiresAt` > UTC_TIMESTAMP(3)
  AND v.`deletedAt` IS NULL;
