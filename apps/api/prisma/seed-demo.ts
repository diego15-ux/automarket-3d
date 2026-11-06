import { hash } from '@node-rs/argon2';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import type { PlanCode } from '../src/generated/prisma/enums.js';
import { mysqlPoolConfig } from '../src/shared/infra/mysql-config.js';

const DATABASE_NAME = 'automarket3d_limpio';
const DEMO_PASSWORD = 'PruebaAuto2026!';
const DAY = 86_400_000;
const photo = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1600&q=80`;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL es obligatoria.');
const parsedUrl = new URL(databaseUrl);
if (
  process.env.NODE_ENV === 'production' ||
  !['localhost', '127.0.0.1'].includes(parsedUrl.hostname) ||
  (parsedUrl.port || '3306') !== '3306' ||
  parsedUrl.pathname.slice(1) !== DATABASE_NAME
) {
  throw new Error(`Seed de prueba bloqueado: requiere MySQL local 3306/${DATABASE_NAME} fuera de producción.`);
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(mysqlPoolConfig(databaseUrl, 2)) });

const accounts = [
  {
    email: 'concesionario.basico@automarket.test',
    name: 'Concesionario de prueba Caracas',
    phone: '+58 412 555 0101',
    country: 'VE',
    city: 'Caracas',
    accountType: 'DEALER',
    businessName: 'Concesionario de Prueba Caracas',
    taxId: 'DEMO-J-000001',
    fiscalAddress: 'Dirección ficticia para pruebas, Caracas',
    businessPhone: '+58 212 555 0101',
    planCode: 'DEALER_BASIC',
  },
  {
    email: 'concesionario.pro@automarket.test',
    name: 'Concesionario de prueba Valencia',
    phone: '+58 412 555 0102',
    country: 'VE',
    city: 'Valencia',
    accountType: 'DEALER',
    businessName: 'Concesionario de Prueba Valencia',
    taxId: 'DEMO-J-000002',
    fiscalAddress: 'Dirección ficticia para pruebas, Valencia',
    businessPhone: '+58 241 555 0102',
    planCode: 'DEALER_PRO',
  },
  {
    email: 'vendedor.particular@automarket.test',
    name: 'Vendedor de prueba particular',
    phone: '+58 412 555 0103',
    country: 'VE',
    city: 'Maracay',
    accountType: 'INDIVIDUAL',
    businessName: null,
    taxId: null,
    fiscalAddress: null,
    businessPhone: null,
    planCode: 'FREE',
  },
  {
    email: 'comprador@automarket.test',
    name: 'Comprador de prueba',
    phone: '+58 412 555 0104',
    country: 'VE',
    city: 'Caracas',
    accountType: 'INDIVIDUAL',
    businessName: null,
    taxId: null,
    fiscalAddress: null,
    businessPhone: null,
    planCode: 'FREE',
  },
  {
    email: 'comprador.madrid@automarket.test',
    name: 'Comprador de prueba Madrid',
    phone: '+34 600 555 0105',
    country: 'ES',
    city: 'Madrid',
    accountType: 'INDIVIDUAL',
    businessName: null,
    taxId: null,
    fiscalAddress: null,
    businessPhone: null,
    planCode: 'FREE',
  },
  {
    email: 'vendedor.madrid@automarket.test',
    name: 'Vendedor de prueba Madrid',
    phone: '+34 600 555 0106',
    country: 'ES',
    city: 'Madrid',
    accountType: 'INDIVIDUAL',
    businessName: null,
    taxId: null,
    fiscalAddress: null,
    businessPhone: null,
    planCode: 'FREE',
  },
] as const;

type DemoVehicle = Omit<Prisma.VehicleUncheckedCreateInput, 'sellerId'> & { sellerEmail: string; photoId: string; featured?: boolean };
const vehicles: DemoVehicle[] = [
  {
    sellerEmail: 'concesionario.basico@automarket.test',
    slug: 'prueba-toyota-corolla-2022-caracas',
    make: 'Toyota',
    model: 'Corolla',
    version: 'SE',
    year: 2022,
    condition: 'USED',
    ownersCount: 1,
    mileageKm: 38500,
    price: 21900,
    category: 'SEDAN',
    fuelType: 'GASOLINE',
    transmission: 'CVT',
    drivetrain: 'FWD',
    horsepower: 169,
    exteriorColor: 'Blanco',
    interiorColor: 'Negro',
    doors: 4,
    seats: 5,
    description: 'ANUNCIO DE PRUEBA: vehículo, precio, kilometraje y disponibilidad son ilustrativos y no están verificados. Foto referencial.',
    city: 'Caracas',
    country: 'VE',
    latitude: 10.4806,
    longitude: -66.9036,
    status: 'PUBLISHED',
    featured: true,
    photoId: '1590362891991-f776e747a588',
  },
  {
    sellerEmail: 'concesionario.basico@automarket.test',
    slug: 'prueba-toyota-hilux-2021-caracas',
    make: 'Toyota',
    model: 'Hilux',
    version: 'SRV 4x4',
    year: 2021,
    condition: 'USED',
    ownersCount: 1,
    mileageKm: 52100,
    price: 35500,
    category: 'PICKUP',
    fuelType: 'DIESEL',
    transmission: 'AUTOMATIC',
    drivetrain: 'FOUR_WD',
    horsepower: 201,
    exteriorColor: 'Gris',
    doors: 4,
    seats: 5,
    description: 'ANUNCIO DE PRUEBA: vehículo, precio, kilometraje y disponibilidad son ilustrativos y no están verificados. Foto referencial.',
    city: 'Caracas',
    country: 'VE',
    latitude: 10.4806,
    longitude: -66.9036,
    status: 'PUBLISHED',
    featured: true,
    photoId: '1519641471654-76ce0107ad1b',
  },
  {
    sellerEmail: 'concesionario.pro@automarket.test',
    slug: 'prueba-hyundai-tucson-hybrid-2023-valencia',
    make: 'Hyundai',
    model: 'Tucson Hybrid',
    version: 'Limited AWD',
    year: 2023,
    condition: 'USED',
    ownersCount: 1,
    mileageKm: 22800,
    price: 32800,
    category: 'SUV',
    fuelType: 'HYBRID',
    transmission: 'AUTOMATIC',
    drivetrain: 'AWD',
    horsepower: 226,
    exteriorColor: 'Azul',
    doors: 5,
    seats: 5,
    description: 'ANUNCIO DE PRUEBA: vehículo, precio, kilometraje y disponibilidad son ilustrativos y no están verificados. Foto referencial.',
    city: 'Valencia',
    country: 'VE',
    latitude: 10.1620,
    longitude: -68.0077,
    status: 'PUBLISHED',
    featured: true,
    photoId: '1519641471654-76ce0107ad1b',
  },
  {
    sellerEmail: 'concesionario.pro@automarket.test',
    slug: 'prueba-nissan-leaf-2022-valencia',
    make: 'Nissan',
    model: 'Leaf',
    version: 'SV Plus',
    year: 2022,
    condition: 'USED',
    ownersCount: 1,
    mileageKm: 19400,
    price: 22400,
    category: 'ELECTRIC',
    fuelType: 'ELECTRIC',
    transmission: 'AUTOMATIC',
    drivetrain: 'FWD',
    horsepower: 214,
    batteryKwh: 62,
    rangeKm: 363,
    exteriorColor: 'Rojo',
    doors: 5,
    seats: 5,
    description: 'ANUNCIO DE PRUEBA: vehículo, precio, kilometraje y disponibilidad son ilustrativos y no están verificados. Foto referencial.',
    city: 'Valencia',
    country: 'VE',
    latitude: 10.1620,
    longitude: -68.0077,
    status: 'PUBLISHED',
    photoId: '1593941707882-a5bba14938c7',
  },
  {
    sellerEmail: 'vendedor.particular@automarket.test',
    slug: 'prueba-ford-mustang-gt-2021-maracay',
    make: 'Ford',
    model: 'Mustang GT',
    version: 'Fastback',
    year: 2021,
    condition: 'USED',
    ownersCount: 2,
    mileageKm: 28700,
    price: 44900,
    category: 'SPORTS',
    fuelType: 'GASOLINE',
    transmission: 'MANUAL',
    drivetrain: 'RWD',
    horsepower: 450,
    engineCc: 5000,
    exteriorColor: 'Negro',
    doors: 2,
    seats: 4,
    description: 'ANUNCIO DE PRUEBA: vehículo, precio, kilometraje y disponibilidad son ilustrativos y no están verificados. Foto referencial.',
    city: 'Maracay',
    country: 'VE',
    latitude: 10.2469,
    longitude: -67.5958,
    status: 'PUBLISHED',
    photoId: '1494976388531-d1058494cdd8',
  },
  {
    sellerEmail: 'concesionario.pro@automarket.test',
    slug: 'prueba-porsche-macan-2022-valencia',
    make: 'Porsche',
    model: 'Macan',
    version: 'Base AWD',
    year: 2022,
    condition: 'USED',
    ownersCount: 1,
    mileageKm: 26100,
    price: 61900,
    category: 'SUV',
    fuelType: 'GASOLINE',
    transmission: 'AUTOMATIC',
    drivetrain: 'AWD',
    horsepower: 261,
    exteriorColor: 'Gris',
    doors: 5,
    seats: 5,
    description: 'ANUNCIO DE PRUEBA: vehículo, precio, kilometraje y disponibilidad son ilustrativos y no están verificados. Foto referencial.',
    city: 'Valencia',
    country: 'VE',
    latitude: 10.1620,
    longitude: -68.0077,
    status: 'PUBLISHED',
    photoId: '1503376780353-7e6692767b70',
  },
  {
    sellerEmail: 'concesionario.basico@automarket.test',
    slug: 'prueba-tesla-model-3-2024-caracas',
    make: 'Tesla',
    model: 'Model 3',
    version: 'Long Range AWD',
    year: 2024,
    condition: 'NEW',
    ownersCount: 0,
    mileageKm: 0,
    price: 39900,
    category: 'ELECTRIC',
    fuelType: 'ELECTRIC',
    transmission: 'AUTOMATIC',
    drivetrain: 'AWD',
    horsepower: 394,
    batteryKwh: 75,
    rangeKm: 549,
    exteriorColor: 'Blanco',
    doors: 4,
    seats: 5,
    description: 'ANUNCIO DE PRUEBA: vehículo, precio y disponibilidad son ilustrativos y no están verificados. Foto referencial.',
    city: 'Caracas',
    country: 'VE',
    latitude: 10.4806,
    longitude: -66.9036,
    status: 'PUBLISHED',
    photoId: '1560958089-b8a1929cea89',
  },
  {
    sellerEmail: 'concesionario.pro@automarket.test',
    slug: 'prueba-bmw-320i-2020-borrador',
    make: 'BMW',
    model: '320i',
    version: 'Sport Line',
    year: 2020,
    condition: 'USED',
    ownersCount: 2,
    mileageKm: 61200,
    price: 27900,
    category: 'SEDAN',
    fuelType: 'GASOLINE',
    transmission: 'AUTOMATIC',
    drivetrain: 'RWD',
    horsepower: 184,
    exteriorColor: 'Azul',
    doors: 4,
    seats: 5,
    description: 'BORRADOR DE PRUEBA: vehículo, precio, kilometraje y disponibilidad son ilustrativos y no están verificados.',
    city: 'Valencia',
    country: 'VE',
    status: 'DRAFT',
    photoId: '1555215695-3004980ad54e',
  },
  {
    sellerEmail: 'vendedor.madrid@automarket.test',
    slug: 'prueba-seat-leon-2022-madrid',
    make: 'SEAT',
    model: 'León',
    version: 'FR 1.5 TSI',
    year: 2022,
    condition: 'USED',
    ownersCount: 1,
    mileageKm: 28500,
    price: 23900,
    category: 'HATCHBACK',
    fuelType: 'GASOLINE',
    transmission: 'MANUAL',
    drivetrain: 'FWD',
    horsepower: 150,
    exteriorColor: 'Gris',
    doors: 5,
    seats: 5,
    description: 'ANUNCIO DE PRUEBA: vehículo, precio, kilometraje y disponibilidad son ilustrativos y no están verificados. Foto referencial.',
    city: 'Madrid',
    country: 'ES',
    latitude: 40.4168,
    longitude: -3.7038,
    status: 'PUBLISHED',
    photoId: '1590362891991-f776e747a588',
  },
];

async function seedDemo() {
  const [database] = await prisma.$queryRaw<Array<{ dbName: string }>>`SELECT DATABASE() AS dbName`;
  if (database?.dbName !== DATABASE_NAME) throw new Error(`Base inesperada: ${database?.dbName ?? 'desconocida'}. No se insertaron datos.`);

  const planRows = await prisma.plan.findMany({ select: { code: true, searchBoost: true } });
  const plans = new Map<PlanCode, number>(planRows.map(plan => [plan.code, plan.searchBoost]));
  for (const account of accounts) {
    if (!plans.has(account.planCode)) throw new Error(`Falta el plan ${account.planCode}; ejecuta primero npm run db:seed -w @automarket/api.`);
  }

  const now = new Date();
  const passwordHash = await hash(DEMO_PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const users = new Map<string, string>();

  await prisma.$transaction(async tx => {
    for (const account of accounts) {
      const paid = account.planCode !== 'FREE';
      const expiresAt = account.planCode === 'DEALER_BASIC' ? new Date(now.getTime() + 90 * DAY) : null;
      const user = await tx.user.upsert({
        where: { email: account.email },
        update: {
          ...account,
          passwordHash,
          isVerified: false,
          verifiedAt: null,
          emailVerifiedAt: now,
          termsAcceptedAt: now,
          planCycle: paid ? 'MONTHLY' : null,
          planExpiresAt: expiresAt,
        },
        create: {
          ...account,
          passwordHash,
          isVerified: false,
          emailVerifiedAt: now,
          termsAcceptedAt: now,
          planCycle: paid ? 'MONTHLY' : null,
          planExpiresAt: expiresAt,
        },
        select: { id: true },
      });
      users.set(account.email, user.id);

      if (paid && (await tx.membershipPeriod.count({ where: { userId: user.id, note: 'Cuenta de prueba; membresía ilustrativa, no pagada.' } })) === 0) {
        await tx.membershipPeriod.create({
          data: {
            userId: user.id,
            planCode: account.planCode,
            cycle: 'MONTHLY',
            source: 'SYSTEM',
            startsAt: now,
            endsAt: expiresAt,
            note: 'Cuenta de prueba; membresía ilustrativa, no pagada.',
          },
        });
      }
    }

    for (const [index, { sellerEmail, photoId, featured = false, ...vehicle }] of vehicles.entries()) {
      const sellerId = users.get(sellerEmail);
      if (!sellerId) throw new Error(`Falta la cuenta de prueba ${sellerEmail}.`);
      const sellerPlanCode = accounts.find(account => account.email === sellerEmail)?.planCode;
      if (!sellerPlanCode) throw new Error(`Falta el plan de prueba para ${sellerEmail}.`);
      const publishedAt = vehicle.status === 'DRAFT' ? null : new Date(now.getTime() - index * 3_600_000);
      const searchBoost = plans.get(sellerPlanCode) ?? 0;
      const saved = await tx.vehicle.upsert({
        where: { slug: vehicle.slug },
        update: {
          ...vehicle,
          sellerId,
          searchBoost,
          publishedAt,
          featuredAt: featured ? publishedAt : null,
          featuredUntil: featured ? new Date(now.getTime() + 30 * DAY) : null,
          expiresAt: null,
        },
        create: {
          ...vehicle,
          sellerId,
          searchBoost,
          publishedAt,
          featuredAt: featured ? publishedAt : null,
          featuredUntil: featured ? new Date(now.getTime() + 30 * DAY) : null,
        },
        select: { id: true },
      });

      const storageKey = `demo-catalog/${vehicle.slug}.jpg`;
      await tx.vehicleMedia.upsert({
        where: { storageKey },
        update: {
          vehicleId: saved.id,
          kind: 'IMAGE',
          url: photo(photoId),
          mimeType: 'image/jpeg',
          alt: `${vehicle.make} ${vehicle.model} ${vehicle.year} (foto referencial de prueba)`,
          position: 0,
        },
        create: {
          vehicleId: saved.id,
          kind: 'IMAGE',
          storageKey,
          url: photo(photoId),
          mimeType: 'image/jpeg',
          alt: `${vehicle.make} ${vehicle.model} ${vehicle.year} (foto referencial de prueba)`,
          position: 0,
        },
      });

      if (vehicle.status === 'PUBLISHED' && index < 6) {
        await tx.carouselItem.upsert({
          where: { vehicleId: saved.id },
          update: { position: index, isActive: true },
          create: { vehicleId: saved.id, position: index, isActive: true },
        });
      }
    }
  });

  console.log(`✔ ${accounts.length} cuentas y ${vehicles.length} anuncios ilustrativos listos en ${DATABASE_NAME}.`);
  console.log(`Contraseña común de prueba: ${DEMO_PASSWORD}`);
  console.table(accounts.map(({ email, planCode, accountType }) => ({ email, accountType, planCode, verified: false })));
  console.log('Todos los anuncios y las fotos son de prueba; no representan ventas ni vendedores verificados.');
}

try {
  await seedDemo();
} finally {
  await prisma.$disconnect();
}
