-- «Pantalla de entrada» deja de venderse (el login ya no muestra autos): el administrador puede
-- volver a ponerla a la venta desde Planes y ajustes → Destacar. Los turnos ya pagados se respetan.
ALTER TABLE `platform_settings` ADD COLUMN `loginOnSale` BOOLEAN NOT NULL DEFAULT false;
