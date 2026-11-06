/** Inicializa planes, ajustes globales y términos bloqueados; no crea usuarios ni anuncios ficticios. */
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import type { PlanCode } from '../src/generated/prisma/enums.js';
import { mysqlPoolConfig } from '../src/shared/infra/mysql-config.js';

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(mysqlPoolConfig(process.env.DATABASE_URL ?? '', 2)) });

/**
 * Catálogo inicial de membresías (el administrador edita precios, comisión y cupo).
 * Personas naturales: Gratis (1 anuncio) y Premium (5 + destacado mensual). Concesionarios: Básico (20 + RIF visible) y Pro (ilimitado + prioridad).
 */
const PLANS: Array<Omit<Prisma.PlanCreateInput, 'users'> & { code: PlanCode }> = [
  { code: 'FREE', name: 'Gratis', accountType: null, maxActiveListings: 1, listingDurationDays: 30, commissionRate: 0.05, featuredSlots: 0, monthlyFeaturedCredits: 0, searchBoost: 0, priceMonthly: 0, priceYearly: 0 },
  { code: 'PREMIUM', name: 'Premium', accountType: 'INDIVIDUAL', maxActiveListings: 5, listingDurationDays: 90, commissionRate: 0.025, featuredSlots: 1, monthlyFeaturedCredits: 1, searchBoost: 2, priceMonthly: 9.99, priceYearly: 99 },
  { code: 'DEALER_BASIC', name: 'Concesionario Básico', accountType: 'DEALER', maxActiveListings: 20, listingDurationDays: 90, commissionRate: 0.02, featuredSlots: 1, monthlyFeaturedCredits: 1, searchBoost: 2, priceMonthly: 24.99, priceYearly: 249 },
  { code: 'DEALER_PRO', name: 'Concesionario Pro', accountType: 'DEALER', maxActiveListings: null, listingDurationDays: null, commissionRate: 0, featuredSlots: 3, monthlyFeaturedCredits: 0, searchBoost: 3, priceMonthly: 59.99, priceYearly: 599 },
];

/** Términos de la lista negra inicial (el administrador la amplía desde el panel). */
const BLOCKED_TERMS = ['idiota', 'imbecil', 'estupido', 'pendejo', 'gilipollas', 'cabron', 'mierda', 'puta', 'hijo de puta', 'malparido'];

async function seedCatalog() {
  for (const { code, ...plan } of PLANS) {
    await prisma.plan.upsert({ where: { code }, update: {}, create: { code, ...plan } });
  }
  await prisma.platformSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  for (const term of BLOCKED_TERMS) {
    await prisma.blockedTerm.upsert({ where: { term }, update: {}, create: { term } });
  }
}

try {
  await seedCatalog();
  console.log(`✔ ${PLANS.length} planes, ajustes globales y ${BLOCKED_TERMS.length} términos bloqueados.`);
} finally {
  await prisma.$disconnect();
}
