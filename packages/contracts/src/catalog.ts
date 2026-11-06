import { z } from 'zod';

// ─────────────────────────────────────────── Catálogo de marcas y modelos ──

const NAME_CHARS = /^[\p{L}\p{N}][\p{L}\p{N} .&'+\-/]*$/u;

export const BrandNameSchema = z
  .string()
  .trim()
  .min(2, 'La marca necesita al menos 2 caracteres.')
  .max(60)
  .regex(NAME_CHARS, 'Solo letras, números, espacios y . & \' + - /');

export const ModelNameSchema = z
  .string()
  .trim()
  .min(1, 'Escribe el modelo.')
  .max(80)
  .regex(NAME_CHARS, 'Solo letras, números, espacios y . & \' + - /');

/** Alta de una marca (con sus modelos, opcional). */
export const BrandCreateSchema = z.object({
  name: BrandNameSchema,
  models: z.array(ModelNameSchema).max(200).default([]),
});
export type BrandCreateInput = z.infer<typeof BrandCreateSchema>;

/** Renombrar o activar / desactivar una marca. */
export const BrandUpdateSchema = z
  .object({ name: BrandNameSchema.optional(), isActive: z.boolean().optional() })
  .refine(value => value.name !== undefined || value.isActive !== undefined, 'No hay cambios que guardar.');
export type BrandUpdateInput = z.infer<typeof BrandUpdateSchema>;

/** Agregar modelos a una marca (varios a la vez). */
export const BrandModelsAddSchema = z.object({ names: z.array(ModelNameSchema).min(1, 'Escribe al menos un modelo.').max(200) });
export const BrandModelUpdateSchema = z.object({ isActive: z.boolean() });

/** Lo que ve el formulario de publicar: solo marcas y modelos activos. */
export interface CatalogBrandDTO {
  id: string;
  name: string;
  models: string[];
}

/** Vista del panel: todas las marcas, con cuántos anuncios las usan. */
export interface AdminBrandDTO {
  id: string;
  name: string;
  isActive: boolean;
  vehicles: number;
  createdAt: string;
  models: Array<{ id: string; name: string; isActive: boolean }>;
}

/** Marca que usan anuncios reales y todavía no está en el catálogo. */
export interface MissingBrandDTO {
  name: string;
  vehicles: number;
  models: string[];
}
