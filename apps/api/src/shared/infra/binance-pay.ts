import { createHmac, createVerify, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../errors/app-error.js';

/**
 * Cliente de la API de comercio de Binance Pay (https://developers.binance.com/docs/binance-pay).
 * Cada petición va firmada con HMAC-SHA512 sobre «timestamp\nnonce\nbody\n» con la clave secreta;
 * las notificaciones (webhooks) de Binance se verifican con RSA-SHA256 y su certificado público.
 */

const Envelope = z.object({
  status: z.string(),
  code: z.string(),
  data: z.unknown().optional(),
  errorMessage: z.string().nullish(),
});

const OrderCreated = z.object({
  prepayId: z.string(),
  expireTime: z.number().optional(),
  qrcodeLink: z.string().optional(),
  qrContent: z.string().optional(),
  checkoutUrl: z.string().optional(),
  deeplink: z.string().optional(),
  universalUrl: z.string().optional(),
});

const OrderQuery = z.object({
  prepayId: z.string(),
  merchantTradeNo: z.string(),
  /** INITIAL · PENDING · PAID · CANCELED · ERROR · REFUNDING · REFUNDED · EXPIRED */
  status: z.string(),
  transactionId: z.string().nullish(),
  openUserId: z.string().nullish(),
});

const RefundResult = z.object({
  refundRequestId: z.string(),
  prepayId: z.string(),
  refundedAmount: z.union([z.string(), z.number()]).optional(),
  refundAmount: z.union([z.string(), z.number()]).optional(),
  duplicateRequest: z.string().optional(),
});

const Certificates = z.array(z.object({ certSerial: z.string(), certPublic: z.string() }));

/** Error de Binance Pay con su código (p. ej. 400201 = orden inexistente). */
export class BinancePayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'BinancePayError';
  }
}

export const binanceMerchantConfigured = () => Boolean(env.BINANCE_PAY_API_KEY && env.BINANCE_PAY_SECRET_KEY);

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const nonce = () => [...randomBytes(32)].map(byte => LETTERS[byte % LETTERS.length]).join('');

/** Firma de las peticiones: HMAC-SHA512(«timestamp\nnonce\nbody\n») en hexadecimal mayúsculas. */
export const signRequest = (timestamp: string, requestNonce: string, body: string, secret: string) =>
  createHmac('sha512', secret).update(`${timestamp}\n${requestNonce}\n${body}\n`).digest('hex').toUpperCase();

async function call<T extends z.ZodType>(path: string, payload: Record<string, unknown>, schema: T): Promise<z.infer<T>> {
  if (!binanceMerchantConfigured()) {
    throw new AppError(503, 'BINANCE_MERCHANT_NOT_CONFIGURED', 'El pago automático con Binance Pay no está configurado. Usa el pago al Pay ID.');
  }
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const requestNonce = nonce();
  const response = await fetch(`${env.BINANCE_PAY_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'BinancePay-Timestamp': timestamp,
      'BinancePay-Nonce': requestNonce,
      'BinancePay-Certificate-SN': env.BINANCE_PAY_API_KEY!,
      'BinancePay-Signature': signRequest(timestamp, requestNonce, body, env.BINANCE_PAY_SECRET_KEY!),
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const json = Envelope.safeParse(await response.json().catch(() => null));
  if (!json.success) throw new BinancePayError(String(response.status), `Respuesta inesperada de Binance Pay (HTTP ${response.status}).`, response.status);
  if (json.data.status !== 'SUCCESS') throw new BinancePayError(json.data.code, json.data.errorMessage || 'Binance Pay rechazó la operación.', response.status);
  return schema.parse(json.data.data);
}

let certificates: { list: z.infer<typeof Certificates>; expiresAt: number } | null = null;

async function publicKeyFor(serial: string): Promise<string | null> {
  if (!certificates || certificates.expiresAt < Date.now() || !certificates.list.some(cert => cert.certSerial === serial)) {
    certificates = { list: await call('/binancepay/openapi/certificates', {}, Certificates), expiresAt: Date.now() + 60 * 60_000 };
  }
  return certificates.list.find(cert => cert.certSerial === serial)?.certPublic ?? null;
}

export interface CreateOrderInput {
  /** Nuestra referencia: letras y números, ≤ 32 caracteres, única por orden. */
  merchantTradeNo: string;
  amount: string;
  currency: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  expiresAt: Date;
  webhookUrl?: string;
}

export const binancePay = {
  /** POST /binancepay/openapi/v2/order → prepayId + QR + enlaces de pago. */
  createOrder: (input: CreateOrderInput) =>
    call(
      '/binancepay/openapi/v2/order',
      {
        env: { terminalType: 'WEB' },
        merchantTradeNo: input.merchantTradeNo,
        orderAmount: Number(input.amount),
        currency: input.currency,
        goods: {
          goodsType: '02', // bienes virtuales
          goodsCategory: 'Z000', // otros
          referenceGoodsId: input.merchantTradeNo,
          goodsName: input.description.slice(0, 256),
        },
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
        orderExpireTime: input.expiresAt.getTime(),
        ...(input.webhookUrl && { webhookUrl: input.webhookUrl }),
      },
      OrderCreated,
    ),

  queryOrder: (merchantTradeNo: string) => call('/binancepay/openapi/v2/order/query', { merchantTradeNo }, OrderQuery),

  closeOrder: (merchantTradeNo: string) => call('/binancepay/openapi/order/close', { merchantTradeNo }, z.unknown()),

  /** Reembolso total o parcial. `refundRequestId` fijo por reembolso: repetirlo no devuelve dos veces. */
  refund: (input: { refundRequestId: string; prepayId: string; amount: string; reason: string }) =>
    call(
      '/binancepay/openapi/order/refund',
      { refundRequestId: input.refundRequestId, prepayId: input.prepayId, refundAmount: Number(input.amount), refundReason: input.reason.slice(0, 256) },
      RefundResult,
    ),

  /**
   * Verifica una notificación de Binance Pay: firma RSA-SHA256 (base64) sobre
   * «timestamp\nnonce\nbody\n» con el certificado indicado en BinancePay-Certificate-SN,
   * y rechaza notificaciones de más de 5 minutos (repeticiones).
   */
  async verifyWebhook(headers: Record<string, string | undefined>, rawBody: string): Promise<boolean> {
    const serial = headers['binancepay-certificate-sn'];
    const timestamp = headers['binancepay-timestamp'];
    const webhookNonce = headers['binancepay-nonce'];
    const signature = headers['binancepay-signature'];
    if (!serial || !timestamp || !webhookNonce || !signature) return false;
    if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) return false;
    const publicKey = await publicKeyFor(serial);
    if (!publicKey) return false;
    try {
      return createVerify('RSA-SHA256').update(`${timestamp}\n${webhookNonce}\n${rawBody}\n`).verify(publicKey, signature, 'base64');
    } catch {
      return false;
    }
  },
};
