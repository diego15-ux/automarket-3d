/**
 * Cuentas y anuncios de PRUEBA para probar la plataforma en local: 13 concesionarios verificados de
 * 12 países, vendedores particulares, compradores y 51 autos publicados.
 *
 * - Solo corre contra una base local (localhost / 127.0.0.1) y nunca en producción.
 * - Se puede correr las veces que quieras: actualiza lo suyo y no toca nada más.
 * - Todas las cuentas usan correos @automarket.test (dominio reservado: ningún correo sale a nadie)
 *   y así se pueden encontrar y quitar antes de abrir la plataforma al público.
 * - Cada auto lleva una imagen de prueba (ilustración con el color y el tipo del auto, marcada
 *   «Imagen de prueba») que se sube al almacén de imágenes igual que una foto real. Solo se pone si
 *   el auto no tiene fotos: las que subas tú desde «Mis anuncios» se respetan.
 * - No crea reseñas, ventas ni pagos (eso solo vale si pasó de verdad).
 *
 *   npm run db:seed:prueba -w @automarket/api      (o doble clic en crear-datos-prueba.cmd)
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { hash } from '@node-rs/argon2';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { env } from '../src/config/env.js';
import { mysqlPoolConfig } from '../src/shared/infra/mysql-config.js';
import { publicMediaUrl, s3 } from '../src/shared/infra/storage.js';
import { ACCOUNTS, CARS, PLACES, describe, slugOf } from './seed-prueba-data.js';

const PHOTOS_DIR = fileURLToPath(new URL('./seed-prueba-fotos/', import.meta.url));

/** Contraseña común de las cuentas de prueba (cámbiala desde «Mi cuenta» si quieres). */
const TEST_PASSWORD = 'Prueba2026';
const DAY = 86_400_000;
const NOTE = 'Cuenta de prueba creada por seed-prueba (plan no cobrado).';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL es obligatoria (apps/api/.env).');
const host = new URL(databaseUrl).hostname;
if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1'].includes(host)) {
  throw new Error('Bloqueado: los datos de prueba solo se crean en una base local y fuera de producción.');
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(mysqlPoolConfig(databaseUrl, 2)) });

async function main() {
  const plans = new Map((await prisma.plan.findMany({ select: { code: true, searchBoost: true, listingDurationDays: true } })).map(plan => [plan.code, plan]));
  for (const account of ACCOUNTS) {
    if (!plans.has(account.planCode)) throw new Error(`Falta el plan ${account.planCode}: ejecuta primero npm run db:seed -w @automarket/api.`);
  }

  const now = new Date();
  const passwordHash = await hash(TEST_PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  let vehicles = 0;
  let photos = 0;
  let photosBlocked = false;

  for (const account of ACCOUNTS) {
    const paid = account.planCode !== 'FREE';
    const data = {
      name: account.name,
      phone: account.phone,
      country: account.country,
      city: account.city,
      bio: account.bio ?? null,
      accountType: account.dealer ? ('DEALER' as const) : ('INDIVIDUAL' as const),
      businessName: account.dealer?.businessName ?? null,
      taxId: account.dealer?.taxId ?? null,
      fiscalAddress: account.dealer?.fiscalAddress ?? null,
      businessPhone: account.dealer?.businessPhone ?? null,
      isVerified: true,
      verifiedAt: now,
      emailVerifiedAt: now,
      termsAcceptedAt: now,
      planCode: account.planCode,
      planCycle: paid ? ('YEARLY' as const) : null,
      planExpiresAt: paid ? new Date(now.getTime() + 365 * DAY) : null,
    };
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: { ...data, status: 'ACTIVE', deletedAt: null },
      create: { email: account.email, passwordHash, ...data },
      select: { id: true },
    });

    if (paid && (await prisma.membershipPeriod.count({ where: { userId: user.id, note: NOTE } })) === 0) {
      await prisma.membershipPeriod.create({
        data: { userId: user.id, planCode: account.planCode, cycle: 'YEARLY', source: 'SYSTEM', startsAt: now, endsAt: data.planExpiresAt, note: NOTE },
      });
    }

    const plan = plans.get(account.planCode)!;
    const place = PLACES[account.city];
    for (const [index, { featured = false, ...car }] of (CARS[account.email] ?? []).entries()) {
      const publishedAt = new Date(now.getTime() - (index * 3 + vehicles) * 3_600_000 - index * 2 * DAY);
      const details = {
        ...car,
        sellerId: user.id,
        city: account.city,
        country: account.country,
        latitude: place?.[0] ?? null,
        longitude: place?.[1] ?? null,
        description: describe(car, account.country, Boolean(account.dealer)),
        searchBoost: plan.searchBoost,
      };
      const slug = slugOf(car, account.city, index);
      // Al repetir el seed solo se refrescan los datos del auto: si en tus pruebas lo reservaste,
      // pausaste o vendiste, su estado se respeta.
      const saved = await prisma.vehicle.upsert({
        where: { slug },
        select: { id: true, _count: { select: { media: true } } },
        update: details,
        create: {
          slug,
          ...details,
          status: 'PUBLISHED',
          publishedAt,
          expiresAt: plan.listingDurationDays ? new Date(publishedAt.getTime() + plan.listingDurationDays * DAY) : null,
          featuredAt: featured ? publishedAt : null,
          featuredUntil: featured ? new Date(now.getTime() + 15 * DAY) : null,
        },
      });
      vehicles += 1;

      // Imagen de prueba: solo si el auto no tiene fotos y el almacén de imágenes responde.
      const photo = `${PHOTOS_DIR}${slug}.jpg`;
      if (!photosBlocked && saved._count.media === 0 && existsSync(photo)) {
        const key = `vehiculos/${saved.id}/prueba-${slug}.jpg`;
        const body = readFileSync(photo);
        try {
          await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET_MEDIA, Key: key, Body: body, ContentType: 'image/jpeg' }));
        } catch (err) {
          photosBlocked = true;
          console.warn(`! No pude subir las imágenes de prueba (${err instanceof Error ? err.message : String(err)}). Abre AutoMarket.exe (enciende el almacén de imágenes) y vuelve a correr esto.`);
          continue;
        }
        await prisma.vehicleMedia.create({
          data: {
            vehicleId: saved.id,
            kind: 'IMAGE',
            storageKey: key,
            url: publicMediaUrl(key),
            mimeType: 'image/jpeg',
            sizeBytes: body.length,
            alt: `Imagen de prueba: ${car.make} ${car.model} ${car.year}`,
            position: 0,
            width: 1200,
            height: 900,
          },
        });
        photos += 1;
      }
    }
  }

  console.log(`\n✔ ${ACCOUNTS.length} cuentas de prueba verificadas y ${vehicles} anuncios publicados (${photos} imágenes de prueba nuevas).`);
  console.log(`  Contraseña de todas las cuentas: ${TEST_PASSWORD}\n`);
  console.table(
    ACCOUNTS.map(account => ({
      correo: account.email,
      tipo: account.dealer ? `Concesionario · ${account.dealer.businessName}` : 'Particular',
      país: account.country,
      ciudad: account.city,
      plan: account.planCode,
      autos: CARS[account.email]?.length ?? 0,
    })),
  );
  console.log('  Son datos de prueba (correos @automarket.test). Quítalos antes de abrir la plataforma al público.');
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
