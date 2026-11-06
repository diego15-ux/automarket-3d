import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { mysqlPoolConfig } from './mysql-config.js';

// Prisma 7 usa driver adapters: el cliente habla con MySQL 8 vía el driver `mariadb`.
const createClient = () =>
  new PrismaClient({
    adapter: new PrismaMariaDb(mysqlPoolConfig(env.DATABASE_URL, env.DATABASE_POOL_SIZE)),
    // Los errores ya llegan al error handler (y los UNIQUE esperados se gestionan): sin duplicar logs.
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['warn'],
  });

// En desarrollo, `tsx watch` recarga módulos: reutilizamos la instancia para no agotar conexiones.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** Cliente aceptado por los repositorios: el global o el de una transacción en curso. */
export type Db = Prisma.TransactionClient;

/** Unidad de trabajo: los servicios abren la transacción y la pasan a los repositorios. */
export const runInTransaction = <T>(work: (tx: Db) => Promise<T>, options?: { timeout?: number }) =>
  prisma.$transaction(work, { maxWait: 5_000, timeout: options?.timeout ?? 10_000 });

/** Violación de una restricción UNIQUE; `field` acota a un índice concreto (p. ej. 'openKey'). */
export function isUniqueViolation(err: unknown, field?: string) {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  return field === undefined || JSON.stringify(err.meta ?? {}).includes(field);
}

/**
 * Exclusión mutua entre instancias con GET_LOCK de MySQL: el bloqueo pertenece a una
 * conexión, así que se fija una dentro de una transacción mientras dura el trabajo.
 * Devuelve `undefined` si otra instancia ya lo tiene (no espera).
 */
export async function withNamedLock<T>(name: string, work: () => Promise<T>, timeoutMs = 5 * 60_000): Promise<T | undefined> {
  return prisma.$transaction(
    async tx => {
      const [row] = await tx.$queryRaw<Array<{ acquired: bigint | number | null }>>`SELECT GET_LOCK(${name}, 0) AS acquired`;
      if (Number(row?.acquired ?? 0) !== 1) return undefined;
      try {
        return await work();
      } finally {
        await tx.$queryRaw`SELECT RELEASE_LOCK(${name})`;
      }
    },
    { maxWait: 5_000, timeout: timeoutMs },
  );
}
