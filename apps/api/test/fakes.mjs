// Dobles locales de servicios externos para el e2e: Binance Pay (comercio), Cloudflare Turnstile,
// S3 y bandeja SMTP. Reproducen el contrato HTTP documentado de cada servicio (formas de
// respuesta, códigos de error, idempotencia) para probar la integración sin credenciales.
import { Buffer } from 'node:buffer';
import { createHmac, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import http from 'node:http';
import { SMTPServer } from 'smtp-server';

const readBody = req =>
  new Promise(resolve => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
const json = (res, status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(body === undefined ? '' : JSON.stringify(body));

/**
 * Binance Pay (API de comercio): crear / consultar / cerrar órdenes, reembolsos y certificados.
 * Comprueba la firma HMAC-SHA512 de cada petición igual que Binance y firma sus notificaciones
 * con RSA-SHA256 (clave privada propia; la pública se sirve en /certificates).
 */
export function createFakeBinancePay({ apiKey, secretKey }) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const certSerial = 'fake-cert-sn-0001';
  const state = { orders: new Map(), refunds: [], closed: [], badSignatures: 0, seq: 0 };
  const ok = (res, data) => json(res, 200, { status: 'SUCCESS', code: '000000', data, errorMessage: '' });
  const fail = (res, code, message) => json(res, 200, { status: 'FAIL', code, errorMessage: message });

  const server = http.createServer(async (req, res) => {
    const body = (await readBody(req)).toString('utf8');
    const ts = req.headers['binancepay-timestamp'];
    const nonce = req.headers['binancepay-nonce'];
    const expected = createHmac('sha512', secretKey).update(`${ts}
${nonce}
${body}
`).digest('hex').toUpperCase();
    if (req.headers['binancepay-certificate-sn'] !== apiKey || req.headers['binancepay-signature'] !== expected || String(nonce).length !== 32) {
      state.badSignatures += 1;
      return fail(res, '400002', 'Signature for this request is not valid.');
    }
    const input = JSON.parse(body || '{}');
    const path = new URL(req.url, 'http://binance').pathname;

    if (path === '/binancepay/openapi/certificates') return ok(res, [{ certSerial, certPublic: publicKey }]);

    if (path === '/binancepay/openapi/v2/order') {
      if ([...state.orders.values()].some(order => order.merchantTradeNo === input.merchantTradeNo)) return fail(res, '400201', 'merchantTradeNo is invalid or duplicated');
      const prepayId = String(298_000_000_000_000_000n + BigInt(++state.seq));
      state.orders.set(prepayId, { prepayId, merchantTradeNo: input.merchantTradeNo, amount: input.orderAmount, currency: input.currency, status: 'INITIAL', transactionId: null, returnUrl: input.returnUrl });
      return ok(res, {
        prepayId,
        terminalType: 'WEB',
        expireTime: input.orderExpireTime,
        qrcodeLink: `https://public.bnbstatic.com/static/payment/${prepayId}.jpg`,
        qrContent: `https://app.binance.com/qr/dplk${prepayId}`,
        checkoutUrl: `https://pay.binance.com/en/checkout/${prepayId}`,
        deeplink: `bnc://app.binance.com/payment/secpay?tempToken=${prepayId}`,
        universalUrl: `https://app.binance.com/payment/secpay?linkToken=${prepayId}`,
      });
    }

    const order = [...state.orders.values()].find(item => item.merchantTradeNo === input.merchantTradeNo || item.prepayId === input.prepayId);
    if (path === '/binancepay/openapi/v2/order/query') {
      if (!order) return fail(res, '400201', 'Order not found');
      return ok(res, { prepayId: order.prepayId, merchantTradeNo: order.merchantTradeNo, status: order.status, transactionId: order.transactionId, openUserId: order.transactionId ? 'open-user-1' : null });
    }
    if (path === '/binancepay/openapi/order/close') {
      if (!order) return fail(res, '400201', 'Order not found');
      if (order.status === 'PAID') return fail(res, '400203', 'Order status is not allowed to close');
      order.status = 'CANCELED';
      state.closed.push(order.merchantTradeNo);
      return ok(res, true);
    }
    if (path === '/binancepay/openapi/order/refund') {
      if (!order || order.status !== 'PAID') return fail(res, '400601', 'Order status is not allowed to refund');
      const previous = state.refunds.find(refund => refund.refundRequestId === input.refundRequestId);
      if (previous) return ok(res, { refundRequestId: previous.refundRequestId, prepayId: order.prepayId, refundAmount: previous.amount, duplicateRequest: 'Y' });
      state.refunds.push({ refundRequestId: input.refundRequestId, merchantTradeNo: order.merchantTradeNo, amount: Number(input.refundAmount).toFixed(2) });
      return ok(res, { refundRequestId: input.refundRequestId, prepayId: order.prepayId, orderAmount: order.amount, refundedAmount: input.refundAmount, refundAmount: input.refundAmount, duplicateRequest: 'N' });
    }
    return json(res, 404, { status: 'FAIL', code: '404', errorMessage: 'not found' });
  });

  /** Simula que el comprador paga la orden en la app de Binance. */
  const pay = merchantTradeNo => {
    const order = [...state.orders.values()].find(item => item.merchantTradeNo === merchantTradeNo);
    if (!order) throw new Error(`orden ${merchantTradeNo} inexistente`);
    order.status = 'PAID';
    order.transactionId = `M_P_${order.prepayId.slice(-8)}`;
    return order;
  };

  /** Notificación firmada como la envía Binance Pay (sobre «timestamp
nonce
body
»). */
  const signedWebhook = (bizType, bizStatus, order, extra = {}, { tamper = false } = {}) => {
    const body = JSON.stringify({
      bizType,
      bizId: Number(order.prepayId),
      bizIdStr: order.prepayId,
      bizStatus,
      data: JSON.stringify({ merchantTradeNo: order.merchantTradeNo, transactionId: order.transactionId, totalFee: order.amount, currency: order.currency, ...extra }),
    });
    const timestamp = String(Date.now());
    const nonce = randomBytes(16).toString('hex');
    const signature = createSign('RSA-SHA256').update(`${timestamp}
${nonce}
${tamper ? body + ' ' : body}
`).sign(privateKey, 'base64');
    return { body, headers: { 'Content-Type': 'application/json', 'BinancePay-Certificate-SN': certSerial, 'BinancePay-Nonce': nonce, 'BinancePay-Timestamp': timestamp, 'BinancePay-Signature': signature } };
  };

  return { server, state, pay, signedWebhook };
}

/** Cloudflare Turnstile siteverify. Tokens de prueba: "ok:<acción>" (válido para esa acción) o cualquier otro (inválido). */
export function createFakeTurnstile({ secret }) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const params = new URLSearchParams((await readBody(req)).toString('utf8'));
    const token = params.get('response') ?? '';
    calls.push({ token, ip: params.get('remoteip') });
    const ok = params.get('secret') === secret && token.startsWith('ok:');
    json(res, 200, { success: ok, 'error-codes': ok ? [] : ['invalid-input-response'], action: ok ? token.slice(3) : undefined, hostname: 'localhost' });
  });
  return { server, calls };
}

/** S3 path-style mínimo: PUT, HEAD, GET y DELETE de objetos. */
export function createFakeS3() {
  const objects = new Map();
  const server = http.createServer(async (req, res) => {
    const key = decodeURIComponent(new URL(req.url, 'http://s3').pathname);
    if (req.method === 'PUT') {
      const body = await readBody(req);
      objects.set(key, { body, type: req.headers['content-type'] ?? 'application/octet-stream' });
      return res.writeHead(200, { ETag: '"fake"' }).end();
    }
    const object = objects.get(key);
    if (req.method === 'DELETE') {
      objects.delete(key);
      return res.writeHead(204).end();
    }
    if (!object) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Length': object.body.length, 'Content-Type': object.type, ETag: '"fake"', 'Last-Modified': new Date().toUTCString() });
    return req.method === 'HEAD' ? res.end() : res.end(object.body);
  });
  return { server, objects };
}

/** Bandeja SMTP real (smtp-server) que guarda los correos recibidos. */
export function createSmtpSink() {
  const mails = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        mails.push({ to: session.envelope.rcptTo.map(rcpt => rcpt.address), raw, text: decodeMime(raw) });
        callback();
      });
    },
  });
  return { server, mails };
}

/** Decodifica quoted-printable y bloques base64 del MIME (suficiente para buscar enlaces y asuntos). */
function decodeMime(raw) {
  const qp = raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const base64 = [...raw.matchAll(/\r?\n\r?\n([A-Za-z0-9+/=\r\n]{60,})/g)]
    .map(match => {
      try {
        return Buffer.from(match[1].replace(/\s+/g, ''), 'base64').toString('utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
  const subject = raw.match(/^Subject: (.+)$/m)?.[1] ?? '';
  const decodedSubject = subject.replace(/=\?UTF-8\?([QB])\?([^?]+)\?=/gi, (_, enc, text) =>
    enc.toUpperCase() === 'B' ? Buffer.from(text, 'base64').toString('utf8') : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'),
  );
  return `${decodedSubject}\n${qp}\n${base64}`;
}
