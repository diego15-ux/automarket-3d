import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';

/** 404 para cualquier ruta no registrada. */
export const notFoundHandler: RequestHandler = () => {
  throw AppError.notFound('NOT_FOUND', 'Recurso no encontrado.');
};

/**
 * Formato de error único para todo el API:
 *   { "error": { "code": "KYC_REQUIRED", "message": "…", "details": { … } } }
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Los datos enviados no son válidos.',
        details: err.issues.map(issue => ({ path: issue.path.map(String).join('.'), message: issue.message })),
      },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'El recurso ya existe.' } });
    return;
  }

  // JSON mal formado (express.json)
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { code: 'MALFORMED_JSON', message: 'El cuerpo de la petición no es JSON válido.' } });
    return;
  }

  console.error('[api] Error no controlado:', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno del servidor.' } });
};
