import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { mysqlPoolConfig } from '../src/shared/infra/mysql-config.js';

const email = process.env.ADMIN_ONE_EMAIL?.trim().toLowerCase();
const databaseUrl = process.env.DATABASE_URL;
if (!email) throw new Error('Configura ADMIN_ONE_EMAIL en apps/api/.env antes de continuar.');
if (!databaseUrl) throw new Error('DATABASE_URL es obligatoria.');

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(mysqlPoolConfig(databaseUrl, 2)) });

try {
  const owners = await prisma.user.findMany({ where: { role: 'ADMIN_ONE' }, select: { email: true } });
  if (owners.length > 0) {
    if (owners.length === 1 && owners[0]?.email.toLowerCase() === email) {
      console.log('La cuenta configurada ya es ADMIN_ONE.');
    } else {
      throw new Error('Ya existe una cuenta ADMIN_ONE distinta; no se modificó ningún rol.');
    }
  } else {
    const account = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true, status: true, deletedAt: true } });
    if (!account || account.deletedAt || account.status !== 'ACTIVE') {
      throw new Error('La cuenta indicada no existe o no está activa. No se modificó ningún rol.');
    }
    if (account.role !== 'ADMIN') throw new Error('La cuenta indicada debe tener actualmente rol ADMIN. No se modificó ningún rol.');
    await prisma.$transaction(async tx => {
      const ownerCount = await tx.user.count({ where: { role: 'ADMIN_ONE' } });
      if (ownerCount !== 0) throw new Error('Ya existe una cuenta ADMIN_ONE; no se modificó ningún rol.');
      await tx.user.update({ where: { id: account.id }, data: { role: 'ADMIN_ONE' } });
    });
    console.log(`Se asignó ADMIN_ONE a ${account.email}.`);
  }
} finally {
  await prisma.$disconnect();
}
