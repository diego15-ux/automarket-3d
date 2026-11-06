import type { AdminBrandDTO, BrandCreateInput, BrandUpdateInput, CatalogBrandDTO, MissingBrandDTO } from '@automarket/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/errors/app-error.js';
import { recordAudit } from '../../shared/infra/audit.js';
import { isUniqueViolation, prisma, runInTransaction, type Db } from '../../shared/infra/prisma.js';

/**
 * Catálogo de marcas y modelos que mantiene el administrador. El formulario de publicar
 * ofrece las marcas activas; si el catálogo tiene alguna, la marca de un anuncio nuevo
 * debe estar en él (así no aparecen «Toyta» o «TOYOTA» como marcas distintas).
 */

/** Quita duplicados sin distinguir mayúsculas (la base tampoco las distingue). */
const uniqueNames = (names: string[]) => {
  const seen = new Set<string>();
  return names.filter(name => {
    const key = name.toLocaleLowerCase('es');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const catalogService = {
  /** Marcas y modelos activos, para el formulario de publicar y los filtros. */
  async publicBrands(): Promise<CatalogBrandDTO[]> {
    const brands = await prisma.vehicleBrand.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      include: { models: { where: { isActive: true }, orderBy: { name: 'asc' }, select: { name: true } } },
    });
    return brands.map(brand => ({ id: brand.id, name: brand.name, models: brand.models.map(model => model.name) }));
  },

  async adminBrands(): Promise<AdminBrandDTO[]> {
    const [brands, usage] = await Promise.all([
      prisma.vehicleBrand.findMany({ orderBy: { name: 'asc' }, include: { models: { orderBy: { name: 'asc' } } } }),
      prisma.$queryRaw<Array<{ make: string; total: bigint }>>`SELECT LOWER(TRIM(make)) AS make, COUNT(*) AS total FROM vehicles WHERE deletedAt IS NULL GROUP BY LOWER(TRIM(make))`,
    ]);
    const count = new Map(usage.map(row => [row.make, Number(row.total)]));
    return brands.map(brand => ({
      id: brand.id,
      name: brand.name,
      isActive: brand.isActive,
      vehicles: count.get(brand.name.trim().toLocaleLowerCase('es')) ?? 0,
      createdAt: brand.createdAt.toISOString(),
      models: brand.models.map(model => ({ id: model.id, name: model.name, isActive: model.isActive })),
    }));
  },

  async createBrand(adminId: string, input: BrandCreateInput, ip: string | null) {
    const models = uniqueNames(input.models);
    try {
      await runInTransaction(async tx => {
        const brand = await tx.vehicleBrand.create({ data: { name: input.name } });
        if (models.length) await tx.vehicleBrandModel.createMany({ data: models.map(name => ({ brandId: brand.id, name })), skipDuplicates: true });
        await recordAudit({ action: 'BRAND_CREATED', entityType: 'VehicleBrand', entityId: brand.id, actorId: adminId, ip, metadata: { name: input.name, models } }, tx);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'name')) throw AppError.conflict('BRAND_EXISTS', `La marca «${input.name}» ya está en el catálogo.`);
      throw err;
    }
    return catalogService.adminBrands();
  },

  async updateBrand(adminId: string, brandId: string, input: BrandUpdateInput, ip: string | null) {
    try {
      await runInTransaction(async tx => {
        const before = await tx.vehicleBrand.findUnique({ where: { id: brandId } });
        if (!before) throw AppError.notFound('BRAND_NOT_FOUND', 'Esa marca no existe.');
        await tx.vehicleBrand.update({ where: { id: brandId }, data: { name: input.name, isActive: input.isActive } });
        // Renombrar corrige también los anuncios que la escribían igual (sin distinguir mayúsculas).
        if (input.name && input.name !== before.name) {
          await tx.$executeRaw`UPDATE vehicles SET make = ${input.name} WHERE LOWER(TRIM(make)) = LOWER(${before.name})`;
        }
        await recordAudit({ action: 'BRAND_UPDATED', entityType: 'VehicleBrand', entityId: brandId, actorId: adminId, ip, metadata: { before: before.name, name: input.name ?? null, isActive: input.isActive ?? null } }, tx);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'name')) throw AppError.conflict('BRAND_EXISTS', `Ya existe una marca llamada «${input.name}».`);
      throw err;
    }
    return catalogService.adminBrands();
  },

  async addModels(adminId: string, brandId: string, names: string[], ip: string | null) {
    const list = uniqueNames(names);
    await runInTransaction(async tx => {
      const brand = await tx.vehicleBrand.findUnique({ where: { id: brandId }, select: { name: true } });
      if (!brand) throw AppError.notFound('BRAND_NOT_FOUND', 'Esa marca no existe.');
      await tx.vehicleBrandModel.createMany({ data: list.map(name => ({ brandId, name })), skipDuplicates: true });
      await recordAudit({ action: 'BRAND_MODELS_ADDED', entityType: 'VehicleBrand', entityId: brandId, actorId: adminId, ip, metadata: { brand: brand.name, names: list } }, tx);
    });
    return catalogService.adminBrands();
  },

  async setModelActive(adminId: string, modelId: string, isActive: boolean, ip: string | null) {
    await runInTransaction(async tx => {
      const model = await tx.vehicleBrandModel.findUnique({ where: { id: modelId }, include: { brand: { select: { name: true } } } });
      if (!model) throw AppError.notFound('MODEL_NOT_FOUND', 'Ese modelo no existe.');
      await tx.vehicleBrandModel.update({ where: { id: modelId }, data: { isActive } });
      await recordAudit({ action: 'BRAND_MODEL_UPDATED', entityType: 'VehicleBrand', entityId: model.brandId, actorId: adminId, ip, metadata: { brand: model.brand.name, name: model.name, isActive } }, tx);
    });
    return catalogService.adminBrands();
  },

  /** Marcas que usan los anuncios y aún no están en el catálogo (con cuántos anuncios y sus modelos). */
  async missingFromListings(): Promise<MissingBrandDTO[]> {
    const rows = await prisma.$queryRaw<Array<{ name: string; total: bigint; models: string | null }>>`
      SELECT MIN(TRIM(v.make)) AS name, COUNT(*) AS total, GROUP_CONCAT(DISTINCT TRIM(v.model) ORDER BY TRIM(v.model) SEPARATOR '\n') AS models
      FROM vehicles AS v
      LEFT JOIN vehicle_brands AS b ON b.name = TRIM(v.make)
      WHERE v.deletedAt IS NULL AND TRIM(v.make) <> '' AND b.id IS NULL
      GROUP BY LOWER(TRIM(v.make))
      ORDER BY total DESC, name ASC`;
    return rows.map(row => ({ name: row.name, vehicles: Number(row.total), models: uniqueNames((row.models ?? '').split('\n').filter(Boolean)) }));
  },

  /** Agrega al catálogo las marcas (y sus modelos) que ya usan los anuncios reales. */
  async importFromListings(adminId: string, ip: string | null) {
    const missing = await catalogService.missingFromListings();
    if (missing.length === 0) return catalogService.adminBrands();
    await runInTransaction(async tx => {
      for (const brand of missing) {
        try {
          const created = await tx.vehicleBrand.create({ data: { name: brand.name.slice(0, 60) } });
          const models = brand.models.map(name => name.slice(0, 80));
          if (models.length) await tx.vehicleBrandModel.createMany({ data: models.map(name => ({ brandId: created.id, name })), skipDuplicates: true });
        } catch (err) {
          if (!isUniqueViolation(err, 'name')) throw err; // otra pestaña la agregó a la vez
        }
      }
      await recordAudit(
        { action: 'BRANDS_IMPORTED', entityType: 'VehicleBrand', entityId: 'listings', actorId: adminId, ip, metadata: { names: missing.map(brand => brand.name) as Prisma.InputJsonValue } },
        tx,
      );
    });
    return catalogService.adminBrands();
  },

  /**
   * Marca de un anuncio: con catálogo, debe ser una marca activa y se guarda con su
   * ortografía oficial; sin catálogo (instalación nueva) se acepta lo que escriba el vendedor.
   */
  async resolveMake(make: string, db: Db = prisma): Promise<string> {
    const active = await db.vehicleBrand.count({ where: { isActive: true } });
    if (active === 0) return make;
    // La colación utf8mb4_unicode_ci compara sin distinguir mayúsculas ni acentos.
    const brand = await db.vehicleBrand.findFirst({ where: { name: make.trim(), isActive: true }, select: { name: true } });
    if (!brand) throw AppError.badRequest('BRAND_NOT_IN_CATALOG', `«${make.trim()}» no está en el catálogo de marcas. Elige una de la lista o pide al equipo que la agregue.`);
    return brand.name;
  },
};
