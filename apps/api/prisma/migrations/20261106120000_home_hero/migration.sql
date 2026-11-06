-- Foto grande de la portada, editable desde el panel (Portada, login y Términos).
ALTER TABLE `platform_settings` ADD COLUMN `homeHeroUrl` VARCHAR(1024) NULL, ADD COLUMN `homeHeroKey` VARCHAR(512) NULL;
