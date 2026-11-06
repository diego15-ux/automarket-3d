UPDATE `plans`
SET
    `maxActiveListings` = 5,
    `listingDurationDays` = 90,
    `commissionRate` = 0.0250,
    `featuredSlots` = 1,
    `monthlyFeaturedCredits` = 1,
    `searchBoost` = 2
WHERE `code` = 'PREMIUM';
