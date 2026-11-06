import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';

type DecimalValue = Prisma.Decimal | string | number;

/** Aritmética de dinero con decimales exactos (nunca float). Redondeo comercial a 2 decimales. */
export const money = (value: DecimalValue) => new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** amount × rate redondeado a céntimos (p. ej. depósito = precio × 2 %). */
export const percentOf = (amount: DecimalValue, rate: DecimalValue) => money(new Prisma.Decimal(amount).mul(rate));

/** Importe con 2 decimales para las APIs de pago: "1234.50". */
export const toAmountString = (value: DecimalValue) => new Prisma.Decimal(value).toFixed(2);

/**
 * UUID v7 (RFC 9562): 48 bits de tiempo + aleatorio. Mismo formato que @default(uuid(7));
 * se usa cuando el id debe existir antes de insertar (p. ej. va en la URL de retorno de Binance Pay).
 */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  let ts = BigInt(Date.now());
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(ts & 0xffn);
    ts >>= 8n;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
