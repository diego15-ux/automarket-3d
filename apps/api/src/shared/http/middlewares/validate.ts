import type { RequestHandler } from 'express';
import type { z } from 'zod';

/** Valida y normaliza req.body con un esquema Zod (los errores → 422 en el error handler). */
export const validateBody =
  (schema: z.ZodType): RequestHandler =>
  (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
