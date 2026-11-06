/**
 * Borra los datos de PRUEBA: todas las cuentas con correo @automarket.test (las de seed-prueba y
 * cualquier otra que uses para probar con ese dominio) y todo lo suyo:
 *   autos, fotos, chats, reservas, ventas, pagos, movimientos del libro, destacados, reseñas,
 *   opiniones, denuncias, alertas, avisos, documentos de identidad y fotos de perfil.
 * Lo de las cuentas reales no se toca: si alguien real escribió o reservó un auto de prueba, se
 * borra esa conversación o reserva (el auto ya no existe), pero su cuenta y sus pagos se quedan.
 *
 * - Solo corre contra una base local (localhost / 127.0.0.1) y nunca en producción.
 * - Se puede correr las veces que quieras: si no hay nada de prueba, no hace nada.
 * - Las fotos se borran del almacén de imágenes si responde (AutoMarket abierto). Si no responde,
 *   los datos se borran igual y te avisa: las fotos sueltas no se ven en ningún lado.
 *
 *   npm run db:prueba:borrar -w @automarket/api      (o doble clic en borrar-datos-prueba.cmd)
 */
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { env } from '../src/config/env.js';
import { mysqlPoolConfig } from '../src/shared/infra/mysql-config.js';
import { deleteObject } from '../src/shared/infra/storage.js';

const TEST_DOMAIN = '@automarket.test';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL es obligatoria (apps/api/.env).');
const host = new URL(databaseUrl).hostname;
if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1'].includes(host)) {
  throw new Error('Bloqueado: los datos de prueba solo se borran en una base local y fuera de producción.');
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(mysqlPoolConfig(databaseUrl, 2)) });

async function main() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: TEST_DOMAIN } },
    select: { id: true, email: true, avatarKey: true },
  });
  if (users.length === 0) {
    console.log(`\n✔ No hay datos de prueba (ninguna cuenta ${TEST_DOMAIN}). No se borró nada.\n`);
    return;
  }
  const userIds = users.map(u => u.id);
  const vehicles = await prisma.vehicle.findMany({ where: { sellerId: { in: userIds } }, select: { id: true, slug: true } });
  const vehicleIds = vehicles.map(v => v.id);

  // Archivos que hay que quitar del almacén (se leen antes de borrar las filas).
  const [media, kyc, chatFiles] = await Promise.all([
    prisma.vehicleMedia.findMany({ where: { vehicleId: { in: vehicleIds } }, select: { storageKey: true } }),
    prisma.kycDocument.findMany({ where: { userId: { in: userIds } }, select: { s3Key: true } }),
    prisma.chatMessage.findMany({
      where: { mediaKey: { not: null }, conversation: { OR: [{ vehicleId: { in: vehicleIds } }, { buyerId: { in: userIds } }, { sellerId: { in: userIds } }] } },
      select: { mediaKey: true },
    }),
  ]);
  const mediaKeys = [
    ...media.map(m => m.storageKey),
    ...chatFiles.map(m => m.mediaKey!),
    ...users.flatMap(u => (u.avatarKey ? [u.avatarKey] : [])),
  ];
  const kycKeys = kyc.map(k => k.s3Key);

  const counts = await prisma.$transaction(async tx => {
    // Ventas marcadas y pagos: la base no deja borrar la cuenta o el auto mientras existan.
    const sales = await tx.vehicleSale.findMany({
      where: { OR: [{ sellerId: { in: userIds } }, { vehicleId: { in: vehicleIds } }] },
      select: { id: true },
    });
    const saleIds = sales.map(s => s.id);
    const payments = await tx.payment.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    const paymentIds = payments.map(p => p.id);
    const reserves = await tx.cartReserve.findMany({
      where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }, { vehicleId: { in: vehicleIds } }] },
      select: { id: true },
    });
    const reserveIds = reserves.map(r => r.id);

    // Movimientos del libro de esas operaciones: si quedaran, sumarían en los ingresos del panel.
    const ledger = await tx.ledgerEntry.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { paymentId: { in: paymentIds } },
          { reservationId: { in: reserveIds } },
          { vehicleSaleId: { in: saleIds } },
        ],
      },
    });
    const vehicleSales = await tx.vehicleSale.deleteMany({ where: { id: { in: saleIds } } });

    // Avisos de cuentas reales que llevan a un auto o a un vendedor de prueba.
    const links = [...vehicles.map(v => `/vehiculos/${v.slug}`), ...userIds.map(id => `/vendedores/${id}`)];
    const notifications = links.length
      ? await tx.notification.deleteMany({ where: { OR: links.map(link => ({ link: { startsWith: link } })) } })
      : { count: 0 };
    const contact = await tx.contactMessage.deleteMany({ where: { userId: { in: userIds } } });

    // El resto cuelga del auto o de la cuenta y se va con ellos (fotos, chats, reservas, destacados,
    // reseñas, opiniones, denuncias, alertas, avisos, documentos, sesiones y periodos de plan).
    const deletedVehicles = await tx.vehicle.deleteMany({ where: { id: { in: vehicleIds } } });
    const deletedPayments = await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });
    const deletedUsers = await tx.user.deleteMany({ where: { id: { in: userIds } } });

    return {
      cuentas: deletedUsers.count,
      autos: deletedVehicles.count,
      reservas: reserves.length,
      ventas: vehicleSales.count,
      pagos: deletedPayments.count,
      'movimientos del libro': ledger.count,
      'avisos de cuentas reales': notifications.count,
      'mensajes de contacto': contact.count,
    };
  }, { timeout: 60_000 });

  let removed = 0;
  let failed = 0;
  for (const [bucket, keys] of [[env.S3_BUCKET_MEDIA, mediaKeys], [env.S3_BUCKET_KYC, kycKeys]] as const) {
    for (const key of keys) {
      try {
        await deleteObject(bucket, key);
        removed += 1;
      } catch {
        failed += 1;
      }
    }
  }

  console.log(`\n✔ Datos de prueba borrados (cuentas ${TEST_DOMAIN}).`);
  console.table(counts);
  console.log(`  Archivos borrados del almacén: ${removed}.`);
  if (failed > 0) {
    console.warn(`! ${failed} archivos no se pudieron borrar del almacén de imágenes (¿está abierto AutoMarket?). Los datos ya no existen; esas fotos sueltas no se ven en ningún lado.`);
  }
  console.log('  Las cuentas reales y sus datos no se tocaron.\n');
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
