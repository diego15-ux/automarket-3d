-- Página pública del concesionario: horario de atención que escribe la agencia y comentario
-- opcional en la reseña de quien compró con reserva.
ALTER TABLE `users` ADD COLUMN `businessHours` VARCHAR(120) NULL;

ALTER TABLE `seller_reviews` ADD COLUMN `comment` VARCHAR(400) NULL;
