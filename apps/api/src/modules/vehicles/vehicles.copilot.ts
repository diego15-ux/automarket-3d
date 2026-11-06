import {
  CopilotContextSchema,
  DRIVETRAIN_LABELS,
  FUEL_LABELS,
  MAX_VEHICLE_MEDIA,
  MIN_MARKET_COMPARABLES,
  normalizeText,
  smartParse,
  usdPrice,
  usdText,
  type CopilotAskInput,
  type CopilotBlockDTO,
  type CopilotChipDTO,
  type CopilotContext,
  type CopilotIntent,
  type CopilotPickDTO,
  type CopilotReplyDTO,
  type PlanDTO,
} from '@automarket/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../shared/infra/prisma.js';
import { getSettings, listPlans } from '../memberships/plans.js';
import { vehicleInsights } from './vehicles.insights.js';
import { cardSelect, toCardDTO, type CardRow } from './vehicles.mapper.js';
import { PRIORITY_FIT, USE_FIT, vocabulary, type Vocabulary } from './vehicles.smart.js';
import { helpAnswer, helpFallback, matchHelp, sameQuestion, searchTerms, withCta, type HelpAnswer } from './copilot-help.js';

/**
 * Copiloto del comprador (diseños «copiloto-pc» y «copiloto-movil»): un chat con reglas sobre los
 * anuncios reales, sin IA. Entiende la frase con el mismo intérprete del buscador, recuerda lo
 * que ya se habló (contexto) y responde con cifras calculadas en MySQL: nada se inventa. Las
 * reglas de AutoMarket (plazos, planes, comisiones) salen de la configuración del panel.
 *
 * Voz (instrucciones del proyecto): cada respuesta empieza por el dato o el estado, sin saludos ni
 * frases de relleno; pasos numerados, opciones en viñetas, cifras en **negrita**; si falta un
 * dato, se pide solo ese; y cierra con una sola llamada a la acción que es la primera opción.
 */

type Row = CardRow;
type Filters = CopilotContext;

const EMPTY: CopilotContext = CopilotContextSchema.parse({});
const usd = usdText;
const kmText = (km: number) => `${Math.round(km).toLocaleString('es-VE')} km`;
const pct = (rate: number) => `${String(Math.round(rate * 1000) / 10).replace('.', ',')} %`;
const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const priceOf = (row: Row) => Number(row.price);
const isAuto = (row: Row) => row.transmission !== 'MANUAL';
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const roundTo = (value: number, step: number) => Math.round(value / step) * step;

const NOUN: Record<string, { many: string; fem: boolean }> = {
  SUV: { many: 'camionetas', fem: true },
  PICKUP: { many: 'pickups', fem: true },
  SEDAN: { many: 'sedanes', fem: false },
  HATCHBACK: { many: 'compactos', fem: false },
  SPORTS: { many: 'deportivos', fem: false },
  CONVERTIBLE: { many: 'convertibles', fem: false },
};
const TYPE_LABEL: Record<string, string> = { SUV: 'Camioneta', PICKUP: 'Pickup', SEDAN: 'Sedán', HATCHBACK: 'Compacto', SPORTS: 'Deportivo', CONVERTIBLE: 'Convertible', ELECTRIC: 'Eléctrico' };
const CAT_WHY: Record<string, string> = {
  SEDAN: 'Sedán: gasta poco y es cómodo en ciudad',
  SUV: 'Camioneta: espacio para la familia',
  PICKUP: 'Pickup: aguanta carga y caminos malos',
  HATCHBACK: 'Compacto: fácil de estacionar y económico',
};
const USE_WHY: Record<'city' | 'family' | 'work', Record<string, string>> = {
  family: { SUV: 'Camioneta: espacio de sobra para la familia', SEDAN: 'Sedán: cabe la familia y gasta poco', PICKUP: 'Pickup: aguanta viajes y caminos malos' },
  work: { PICKUP: 'Pickup: carga peso y entra por caminos malos', SUV: 'Camioneta: aguanta trabajo y viajes' },
  city: { HATCHBACK: 'Compacto: fácil de estacionar y gasta poco', SEDAN: 'Sedán: cómodo y económico en ciudad', ELECTRIC: 'Eléctrico: casi no gasta en ciudad' },
};
const PRIO_WHY = { fuel: 'Gasta poco combustible', value: 'Marca con buena reventa y repuestos', space: 'Mucho espacio y comodidad' } as const;

const text = (value: string): CopilotBlockDTO => ({ type: 'text', text: value });
/** Burbuja de cierre: la llamada a la acción, después de las tarjetas. */
const close = (value: string): CopilotBlockDTO => text(`**${value}**`);
/** Cierre cuando no hay una acción propia: lo siguiente es buscar. */
const SEARCH_CTA = 'Escribe el modelo o tu presupuesto y te muestro lo publicado.';
const note = (value: string): CopilotBlockDTO => ({ type: 'note', text: value });
const say = (value: string): CopilotChipDTO => ({ label: value, text: value });
const chip = (label: string, send: string): CopilotChipDTO => ({ label, text: send });
const MENU_CHIP = chip('Menú', 'menu');
const MENU: CopilotChipDTO[] = [
  chip('Ayúdame a elegir', 'ayudame a elegir'),
  say('¿Este precio es justo?'),
  chip('Automático o sincrónico', 'comparar automatico y sincronico'),
  say('¿A cuánto vendo mi auto?'),
  say('¿Cómo funciona la reserva?'),
  chip('Otras dudas', 'otras dudas'),
];

// ── Datos ───────────────────────────────────────────────────────────────────

function whereOf(f: Filters, vocab: Vocabulary, withReserved = false): Prisma.VehicleWhereInput {
  const labels = f.models.flatMap(model => (vocab.models[model] ? [vocab.models[model].label] : []));
  const and: Prisma.VehicleWhereInput[] = [];
  if (f.gearbox === 'MANUAL') and.push({ transmission: 'MANUAL' });
  if (f.gearbox === 'AUTOMATIC') and.push({ transmission: { not: 'MANUAL' } });
  if (f.electric) and.push({ OR: [{ fuelType: 'ELECTRIC' }, { category: 'ELECTRIC' }] });
  return {
    deletedAt: null,
    status: withReserved ? { in: ['PUBLISHED', 'RESERVED'] } : 'PUBLISHED',
    currency: 'USD',
    ...(labels.length ? { model: { in: labels } } : f.brand ? { make: vocab.brandLabel.get(f.brand) ?? f.brand } : {}),
    ...(f.category && { category: f.category }),
    ...(f.city && { city: f.city }),
    ...(f.year && { year: { gte: f.year - 1, lte: f.year + 1 } }),
    ...((f.min !== null || f.max !== null) && { price: { ...(f.min !== null && { gte: f.min }), ...(f.max !== null && { lte: f.max }) } }),
    ...(and.length && { AND: and }),
  };
}

/** Autos que cumplen, del más barato al más caro. Las cifras de mercado cuentan también los reservados; las sugerencias, solo los disponibles. */
const find = (f: Filters, vocab: Vocabulary, withReserved = false) => prisma.vehicle.findMany({ where: whereOf(f, vocab, withReserved), orderBy: { price: 'asc' }, take: 1000, select: cardSelect });
const countPublished = () => prisma.vehicle.count({ where: { deletedAt: null, status: 'PUBLISHED' } });

let factsCache: { at: number; plans: PlanDTO[]; settings: Awaited<ReturnType<typeof getSettings>> } | null = null;
async function facts() {
  if (factsCache && Date.now() - factsCache.at < 60_000) return factsCache;
  factsCache = { at: Date.now(), plans: await listPlans(), settings: await getSettings() };
  return factsCache;
}

/** Los modelos con más anuncios (para los ejemplos de los botones). */
function topModels(vocab: Vocabulary, n: number) {
  return [...vocab.counts.models]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .flatMap(([model]) => (vocab.models[model] ? [{ key: model, ...vocab.models[model] }] : []));
}

// ── Textos ──────────────────────────────────────────────────────────────────

function gearboxWord(gearbox: 'AUTOMATIC' | 'MANUAL', fem: boolean, plural: boolean) {
  const base = gearbox === 'AUTOMATIC' ? 'automátic' : 'sincrónic';
  return `${base}${fem ? 'a' : 'o'}${plural ? 's' : ''}`;
}

/** «camionetas automáticas de 2019 a 2021 hasta $20,000 en Valencia». */
function describe(f: Filters, vocab: Vocabulary) {
  const labels = f.models.flatMap(model => (vocab.models[model] ? [vocab.models[model].label] : []));
  const noun = labels.length ? labels.join(' o ') : f.category ? NOUN[f.category]!.many : f.electric ? 'eléctricos' : f.brand ? `autos ${vocab.brandLabel.get(f.brand) ?? cap(f.brand)}` : 'autos';
  const fem = !labels.length && (f.category === 'SUV' || f.category === 'PICKUP');
  let out = noun;
  if (f.gearbox) out += ` ${gearboxWord(f.gearbox, fem, true)}`;
  if (f.year) out += ` de ${f.year - 1} a ${f.year + 1}`;
  if (f.min !== null && f.max !== null) out += ` entre ${usd(f.min)} y ${usd(f.max)}`;
  else if (f.max !== null) out += ` hasta ${usd(f.max)}`;
  else if (f.min !== null) out += ` desde ${usd(f.min)}`;
  if (f.city) out += ` en ${f.city}`;
  return out;
}

function catalogHref(f: Filters, vocab: Vocabulary) {
  const params = new URLSearchParams();
  const model = f.models[0] ? vocab.models[f.models[0]] : undefined;
  if (model) {
    params.set('make', model.make);
    params.set('model', model.label);
  } else if (f.brand) params.set('make', vocab.brandLabel.get(f.brand) ?? f.brand);
  if (f.gearbox) params.set('gearbox', f.gearbox);
  if (f.category) params.set('category', f.category);
  if (f.electric) params.set('fuel', 'ELECTRIC');
  if (f.city) params.set('city', f.city);
  if (f.year) {
    params.set('yearMin', String(f.year - 1));
    params.set('yearMax', String(f.year + 1));
  }
  if (f.min !== null) params.set('priceMin', String(Math.round(f.min)));
  if (f.max !== null) params.set('priceMax', String(Math.round(f.max)));
  const query = params.toString();
  return `/vehiculos${query ? `?${query}` : ''}`;
}

/** Concordancia: «camionetas publicadas», «sedanes publicados». */
const isFem = (f: Filters) => !f.models.length && (f.category === 'SUV' || f.category === 'PICKUP');
const published = (f: Filters, plural = true) => `publicad${isFem(f) ? 'a' : 'o'}${plural ? 's' : ''}`;
/** Precio de un plan con céntimos si los tiene ($9,99), como en el resto de la app. */
const planPrice = (value: number) => usdPrice(value);

const nameOf = (make: string, model: string, year?: number | null, gearbox?: 'AUTOMATIC' | 'MANUAL' | null) =>
  `${make} ${model}${year ? ` ${year}` : ''}${gearbox ? ` ${gearboxWord(gearbox, false, false)}` : ''}`;

function reasonsOf(row: Row, f: Filters, groupKm: number | null): string[] {
  const reasons: string[] = [];
  const byUse = f.use ? USE_WHY[f.use][row.category] : undefined;
  if (byUse) reasons.push(byUse);
  else if (!f.use && CAT_WHY[row.category]) reasons.push(CAT_WHY[row.category]!);
  if (f.priority && PRIORITY_FIT[f.priority](row) >= 2) reasons.push(PRIO_WHY[f.priority]);
  if (f.max !== null && priceOf(row) < f.max) reasons.push(`${usd(f.max - priceOf(row))} por debajo de tu tope`);
  if (groupKm && row.condition !== 'NEW' && row.mileageKm < groupKm * 0.85) reasons.push(`${Math.round((1 - row.mileageKm / groupKm) * 100)} % menos km que el promedio del grupo`);
  if (row.condition === 'NEW') reasons.push('Nuevo, 0 km');
  else if (row.ownersCount === 1) reasons.push('Un solo dueño');
  if (row.seller.accountType === 'DEALER' && row.seller.businessName) reasons.push(`Lo vende ${row.seller.businessName}`);
  else if (row.seller.isVerified) reasons.push('Vendedor con identidad verificada');
  return [...reasons.slice(0, 4), `${kmText(row.mileageKm)} · ${isAuto(row) ? 'automático' : 'sincrónico'} · ${row.city}`];
}

// ── Respuestas frecuentes (reglas reales de AutoMarket) ─────────────────────

type Facts = Awaited<ReturnType<typeof facts>>;
/** Lo que una respuesta frecuente necesita saber además de las reglas del panel. */
interface FaqExtra {
  gearboxGap: number | null;
  /** Identidad verificada de quien escribe (null: sin sesión). */
  verified: boolean | null;
  viewing: Viewing | null;
}
interface Faq {
  id: string;
  re: RegExp;
  answer: (facts: Facts, extra: FaqExtra) => string;
  /** La primera opción es la acción del cierre (`cta`). */
  chips: CopilotChipDTO[] | ((extra: FaqExtra) => CopilotChipDTO[]);
  cta: string | ((extra: FaqExtra) => string | null);
}

const planList = (plans: PlanDTO[]) =>
  plans.map(plan => {
    const listings = plan.maxActiveListings === null ? 'sin límite de anuncios' : `${plan.maxActiveListings} ${plan.maxActiveListings === 1 ? 'anuncio' : 'anuncios'}`;
    const days = plan.listingDurationDays ? ` por ${plan.listingDurationDays} días` : '';
    const price = plan.priceMonthly > 0 ? `${planPrice(plan.priceMonthly)} al mes` : 'sin costo';
    return `- **${plan.name}**: ${price} · ${listings}${days} · comisión de ${pct(plan.commissionRate)}`;
  });

const go = (label: string, href: string): CopilotChipDTO => ({ label, href });
const SAFE_CHIPS = [say('¿Qué reviso antes de comprar?'), say('¿Cómo es el traspaso?')];
const SAFE_CTA = '¿Te digo qué revisar antes de comprar?';
const VERIFY_CHIP = go('Verificar mi identidad', '/cuenta/verificacion');
const CATALOG_CHIP = go('Ver autos en el catálogo', '/vehiculos');

const FAQ: Faq[] = [
  {
    id: 'refund',
    re: /(devuelv|reembols|si no se da|no se concreta|no se cierra|pierdo el abono|me regresan)/,
    answer: ({ settings }) =>
      `Si la compra no se concreta, el vendedor te devuelve el **100 % del abono**: es una condición que él acepta al publicar y tú al reservar. Si pasan **${settings.reservationHoldDays} días** sin venta, el auto vuelve solo al catálogo.`,
    chips: [say('¿A quién le pago el abono?'), say('¿Cuánto dura la reserva?')],
    cta: '¿Te explico a quién le pagas el abono?',
  },
  {
    id: 'payee',
    re: /(a quien (le )?pag|a quien se (le )?paga|quien recibe|donde pago el abono|pago el abono)/,
    answer: () => 'Al vendedor, **directo**. AutoMarket no cobra ni guarda el abono: solo registra la reserva para que nadie más aparte ese auto.',
    chips: [say('¿Y si no se da la venta?'), say('¿Cómo funciona la reserva?')],
    cta: '¿Te explico qué pasa si no se da la venta?',
  },
  {
    id: 'deadline',
    re: /(cuanto tarda|cuanto tiempo tiene|plazo|confirma|responde el vendedor)/,
    answer: ({ settings }) => `El vendedor tiene **${settings.sellerResponseHours} horas** para confirmar tu solicitud. Si no responde a tiempo, la solicitud vence y **no pagas nada**.`,
    chips: [say('¿Cómo funciona la reserva?'), say('¿A quién le pago el abono?')],
    cta: '¿Te explico cómo funciona la reserva?',
  },
  {
    id: 'hold',
    re: /(cuanto dura|dias dura|duracion de la reserva|cuantos dias)/,
    answer: ({ settings }) => `Una reserva confirmada dura **${settings.reservationHoldDays} días**. En ese tiempo se cierra la compra; si no, el auto vuelve al catálogo y el vendedor te devuelve el abono.`,
    chips: [say('¿A quién le pago el abono?'), say('¿Y si no se da la venta?')],
    cta: '¿Te explico a quién le pagas el abono?',
  },
  {
    id: 'reserve',
    re: /(reserv|apartar|aparto|abono)/,
    answer: ({ settings }) =>
      `Reserva en 3 pasos:\n1. En la ficha del auto, toca «Reservar».\n2. El vendedor tiene **${settings.sellerResponseHours} horas** para confirmar.\n3. Cuando confirma, le pagas el abono **directo a él**; se descuenta del precio.\nDurante **${settings.reservationHoldDays} días** nadie más puede reservar ese auto. Para reservar necesitas tu identidad verificada.`,
    chips: ({ verified, viewing }) =>
      verified ? (viewing ? [say('¿Y si no se da la venta?'), say('¿A quién le pago el abono?')] : [CATALOG_CHIP, say('¿Y si no se da la venta?')]) : [VERIFY_CHIP, say('¿Y si no se da la venta?'), say('¿A quién le pago el abono?')],
    cta: ({ verified, viewing }) => (verified ? (viewing ? 'Si te convence, toca «Reservar» en la ficha.' : '¿Buscamos el auto que quieres reservar?') : '¿Empezamos la verificación de identidad?'),
  },
  {
    id: 'payments',
    re: /(binance|usdt|pay id|como pago|como pagar|pagar el plan|pagar la comision|pagar con|en efectivo|efectivo|tarjeta|zelle|paypal|pago movil|metodo de pago|metodos de pago|formas de pago|forma de pago)/,
    answer: () =>
      'Los **planes**, los **destacados** y las **comisiones** se pagan con Binance en USDT: con Binance Pay o con una transferencia a nuestro Pay ID, que el equipo confirma a mano. El **abono de una reserva** es distinto: se lo pagas directo al vendedor.',
    chips: [say('¿Qué planes hay?'), say('¿Cuánto cobran de comisión?')],
    cta: '¿Te muestro los planes?',
  },
  {
    id: 'commission',
    re: /(comision|cuanto cobran|cobra automarket|cuanto me cobran)/,
    answer: ({ plans, settings }) =>
      `Solo pagas comisión cuando vendes:\n${plans.map(plan => `- **${pct(plan.commissionRate)}** con ${plan.name}`).join('\n')}\nSe paga con Binance después de la venta; tienes **${settings.commissionDueDays} días**.`,
    chips: [say('¿Qué planes hay?'), say('¿A cuánto vendo mi auto?')],
    cta: '¿Te muestro los planes?',
  },
  {
    id: 'plans',
    re: /(plan|planes|premium|membresia|suscripcion)/,
    answer: ({ plans }) => `Estos son los planes:\n${planList(plans).join('\n')}`,
    chips: [go('Ver mi plan', '/cuenta/plan'), say('¿Cómo pago el plan?')],
    cta: '¿Revisamos tu plan?',
  },
  {
    id: 'publish',
    re: /(publicar|publico|anunciar|poner en venta|subir mi auto)/,
    answer: ({ plans }) => {
      const free = plans.find(plan => plan.code === 'FREE');
      const freeText = free ? `\nCon el plan ${free.name} tienes **${free.maxActiveListings ?? 'varios'} ${free.maxActiveListings === 1 ? 'anuncio' : 'anuncios'}**${free.listingDurationDays ? ` por ${free.listingDurationDays} días` : ''}.` : '';
      return `Publica tu auto en 3 pasos:\n1. Verifica tu identidad (cédula, selfie y teléfono).\n2. Sube hasta **${MAX_VEHICLE_MEDIA} fotos o vídeos**, el precio y los datos del auto.\n3. Toca «Publicar».${freeText}`;
    },
    chips: [go('Publicar mi auto', '/cuenta/anuncios/nuevo'), say('¿A cuánto vendo mi auto?')],
    cta: '¿Empezamos tu anuncio?',
  },
  {
    id: 'verify',
    re: /(verific|segur|estafa|confiable el vendedor|es real|fraude|confiar)/,
    answer: () =>
      'Cada vendedor verifica su identidad antes de publicar: cédula, pasaporte o licencia vigente, una selfie y su teléfono. A los concesionarios también les pedimos el RIF.\n- Busca la marca **Verificado** en el anuncio.\n- No pagues el resto del precio antes de firmar el traspaso.',
    chips: SAFE_CHIPS,
    cta: SAFE_CTA,
  },
  {
    id: 'contact',
    re: /(telefono|whatsapp|numero|contacto|correo|llamar)/,
    answer: () => 'El chat oculta teléfonos, correos y enlaces hasta que el vendedor **confirma la reserva**. Desde ese momento los dos ven los datos de contacto y pueden mandarse notas de voz.',
    chips: [say('¿Cómo funciona la reserva?'), say('¿A quién le pago el abono?')],
    cta: '¿Te explico cómo funciona la reserva?',
  },
  {
    id: 'chat',
    re: /(chat|mensaje|fotos del|video del|escribirle)/,
    answer: () => 'En el chat de cada ficha puedes mandar fotos y vídeos. Antes de ir a verlo, pide:\n- Fotos del motor y del tablero encendido.\n- Un vídeo del auto andando.',
    chips: SAFE_CHIPS,
    cta: SAFE_CTA,
  },
  {
    id: 'report',
    re: /(denunci|reportar|anuncio falso|anuncio raro)/,
    answer: () => 'Cada anuncio tiene el botón «Denunciar». El equipo revisa el caso y puede pausar el anuncio o bloquear la cuenta.',
    chips: SAFE_CHIPS,
    cta: SAFE_CTA,
  },
  {
    id: 'transfer',
    re: /(traspaso|papeles|documentos|titulo|notaria|intt)/,
    answer: () =>
      'Por lo general, el traspaso va así:\n1. Se firma en una notaría con el título (certificado de registro), las cédulas de los dos y la solvencia de multas.\n2. Después se actualiza ante el INTT.\nLos requisitos cambian: confírmalos en el INTT o con un gestor antes de pagar.',
    chips: [say('¿Qué reviso antes de comprar?'), say('¿Cómo funciona la reserva?')],
    cta: SAFE_CTA,
  },
  {
    id: 'inspect',
    re: /(que reviso|revisar antes|antes de comprar|antes de pagar|consejo|recomendacion para comprar)/,
    answer: () =>
      'Antes de pagar:\n1. Haz una prueba de manejo con el motor en frío.\n2. Revisa que los seriales de carrocería y motor coincidan con el título.\n3. Llévalo a un mecánico de confianza.\n4. Pide las facturas de mantenimiento.\nEl resto del precio, solo al firmar el traspaso.',
    chips: [say('¿Cómo es el traspaso?'), say('¿Cómo funciona la reserva?')],
    cta: '¿Te explico cómo es el traspaso?',
  },
  {
    id: 'finance',
    re: /(financ|credito|cuotas|a plazos|prestamo)/,
    answer: () => 'AutoMarket no da créditos. Algunos concesionarios sí financian: en sus anuncios aparece la calculadora de cuota para que lo converses con ellos.',
    chips: [go('Ver concesionarios', '/concesionarios'), say('¿Cómo funciona la reserva?'), MENU_CHIP],
    cta: '¿Vemos los concesionarios?',
  },
  {
    id: 'cvt',
    re: /\bcvt\b/,
    answer: () => 'La CVT es una caja automática sin cambios fijos: es suave y ahorra gasolina, pero necesita su aceite especial a tiempo. Pide la factura del último cambio.',
    chips: [say('¿Qué reviso antes de comprar?'), MENU_CHIP],
    cta: SAFE_CTA,
  },
  {
    id: '4x4',
    re: /(4x4|doble traccion|4wd|awd)/,
    answer: () => 'El 4x4 lleva la fuerza a las cuatro ruedas: sirve en campo, barro o subidas fuertes. En ciudad no hace falta y gasta un poco más.',
    chips: [chip('Ver pickups', 'pickups'), MENU_CHIP],
    cta: '¿Te muestro las pickups publicadas?',
  },
  {
    id: 'diesel',
    re: /(diesel|gasoil)/,
    answer: () => 'El diésel rinde más por litro y aguanta trabajo pesado. La gasolina es más fácil de conseguir en algunas zonas y su motor suele ser más barato de reparar.',
    chips: [chip('Ver pickups', 'pickups'), MENU_CHIP],
    cta: '¿Te muestro las pickups publicadas?',
  },
  {
    id: 'electric',
    re: /(electrico|cargar la bateria|bateria)/,
    answer: () => 'Un eléctrico cuesta muy poco por kilómetro y casi no lleva mantenimiento, pero en Venezuela hay pocos puntos de carga: necesitas poder cargarlo en casa.',
    chips: [chip('Ver eléctricos', 'electricos'), MENU_CHIP],
    cta: '¿Te muestro los eléctricos publicados?',
  },
  {
    id: 'gearbox',
    re: /(caja|automatico o sincronico|sincronico o automatico|automatico vs|sincronico vs)/,
    answer: (_facts, { gearboxGap }) =>
      `- **Automático**: más cómodo en el tráfico y se revende un poco mejor, pero cuesta más y su reparación es más cara.\n- **Sincrónico**: más barato de comprar y de mantener.${gearboxGap !== null && Math.abs(gearboxGap) >= 0.01 ? `\nEn AutoMarket, del mismo modelo, los automáticos cuestan en promedio **${Math.round(Math.abs(gearboxGap) * 100)} % ${gearboxGap > 0 ? 'más' : 'menos'}**.` : ''}`,
    // Las opciones salen de los modelos con más anuncios (ver `faqTurn`).
    chips: [],
    cta: () => null,
  },
  {
    id: 'mileage',
    re: /(kilometraje|kilometros|mucho km|muchos km)/,
    answer: () => 'Un auto suele recorrer entre **15.000 y 20.000 km al año**. Si tiene bastante más para su edad, negocia el precio y revisa bien motor y caja.',
    chips: SAFE_CHIPS,
    cta: SAFE_CTA,
  },
  {
    id: 'owners',
    re: /(duenos|dueno anterior|cuantos duenos)/,
    answer: () => 'Menos dueños suele significar un historial más claro. Pregunta por qué lo venden y pide las facturas de mantenimiento.',
    chips: SAFE_CHIPS,
    cta: SAFE_CTA,
  },
  {
    id: 'haggle',
    re: /(negociar|regatear|rebaja|descuento|ofrecer menos)/,
    answer: () => 'Negocia con datos: dile al vendedor el promedio de autos parecidos y ofrece cerca de ese número. Escríbeme el modelo, el año y el precio, y te doy la cifra.',
    chips: [say('¿Este precio es justo?'), MENU_CHIP],
    cta: '¿Revisamos si el precio es justo?',
  },
];

/** Diferencia media entre automáticos y sincrónicos del mismo modelo (para la respuesta de la caja). */
async function gearboxGap(): Promise<number | null> {
  const rows = await prisma.vehicle.groupBy({
    by: ['make', 'model', 'transmission'],
    where: { deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] }, currency: 'USD' },
    _avg: { price: true },
  });
  const byModel = new Map<string, { auto: number[]; manual: number[] }>();
  for (const row of rows) {
    const key = `${row.make}|${row.model}`;
    const entry = byModel.get(key) ?? { auto: [], manual: [] };
    const value = Number(row._avg.price ?? 0);
    if (value > 0) (row.transmission === 'MANUAL' ? entry.manual : entry.auto).push(value);
    byModel.set(key, entry);
  }
  const gaps = [...byModel.values()].filter(entry => entry.auto.length && entry.manual.length).map(entry => avg(entry.auto) / avg(entry.manual) - 1);
  return gaps.length ? avg(gaps) : null;
}

// ── Motor ───────────────────────────────────────────────────────────────────

interface Turn {
  blocks: CopilotBlockDTO[];
  chips: CopilotChipDTO[];
  context: CopilotContext;
}

interface Viewing {
  id: string;
  slug: string;
  make: string;
  model: string;
  year: number;
  price: number;
  mileageKm: number;
  transmission: string;
}

async function viewingOf(slug: string | undefined): Promise<Viewing | null> {
  if (!slug) return null;
  const row = await prisma.vehicle.findFirst({
    where: { slug, deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED', 'PENDING_SALE'] }, currency: 'USD' },
    select: { id: true, slug: true, make: true, model: true, year: true, price: true, mileageKm: true, transmission: true },
  });
  return row ? { ...row, price: Number(row.price) } : null;
}

const conditionOf = (q: string) => (/(como nuevo|excelente|impecable|perfecto estado|nuevecito)/.test(q) ? 1.04 : /(detalle|choque|chocado|necesita|reparar|falla|golpe)/.test(q) ? 0.9 : null);

export const copilot = {
  /** `verified`: identidad verificada de quien escribe (null sin sesión). */
  async ask(input: CopilotAskInput, verified: boolean | null): Promise<CopilotReplyDTO> {
    const [vocab, viewing] = await Promise.all([vocabulary(), viewingOf(input.vehicleSlug)]);
    const turn = await respond(input, vocab, viewing, verified);
    return { ...turn, viewing: viewing ? { slug: viewing.slug, title: `${viewing.make} ${viewing.model} ${viewing.year}`, price: viewing.price } : null };
  },
};

async function respond(input: CopilotAskInput, vocab: Vocabulary, viewing: Viewing | null, verified: boolean | null): Promise<Turn> {
  const raw = input.text;
  if (input.action === 'start') return greet(vocab, viewing);
  if (input.action === 'reset' || !raw) return { blocks: [text(withCta('Conversación nueva.', viewing ? '¿Reviso si este auto tiene buen precio?' : 'Escribe qué auto buscas o elige una opción.'))], chips: viewingChips(viewing, MENU), context: EMPTY };

  const previous = input.context ?? EMPTY;
  const e = smartParse(raw, vocab);
  const q = e.q;
  const words = q.trim().split(' ').filter(Boolean).length;
  const fixes = e.fixes.length ? `(Entendí ${e.fixes.map(fix => `«${fix.from}» como ${vocab.models[fix.to]?.label ?? cap(fix.to)}`).join(' y ')}.) ` : '';
  const withFixes = (turn: Turn): Turn => {
    if (!fixes) return turn;
    const first = turn.blocks.findIndex(block => block.type === 'text');
    if (first >= 0) turn.blocks[first] = text(fixes + (turn.blocks[first] as { text: string }).text);
    return turn;
  };

  if (/^ (menu|menú|inicio|opciones|empezar de nuevo|volver a empezar) $/.test(q)) return { blocks: [text('Elige una opción o escribe lo que buscas: modelo, presupuesto o tu duda.')], chips: viewingChips(viewing, MENU), context: EMPTY };
  if (words <= 4 && !e.models.length && /^ (hola|buenas|buenos dias|buenas tardes|buenas noches|hey|epa|saludos)\b/.test(q)) return { blocks: [text('Dime qué auto buscas, cuánto quieres gastar o qué precio quieres revisar, y te respondo con los anuncios publicados.')], chips: viewingChips(viewing, MENU), context: EMPTY };
  if (words <= 4 && /\b(gracias|perfecto|excelente|chevere|genial)\b/.test(q)) return { blocks: [text(withCta('A la orden. Cuando quieras, reviso otro auto.', '¿Te explico cómo reservar el que te gustó?'))], chips: [say('¿Cómo funciona la reserva?'), MENU_CHIP], context: previous };
  // «Sí» suelto llega aquí solo si no había opciones en pantalla (la web ejecuta la primera); «no», cierra sin insistir.
  if (!previous.guide && /^ (si|sii|ok|okay|dale|va|vale|claro|listo|bueno|de una) $/.test(q)) return { blocks: [text(SEARCH_CTA)], chips: viewingChips(viewing, MENU), context: previous };
  if (!previous.guide && /^ (no|no gracias|nop|nada|asi esta bien|eso es todo|ya no|ninguno|ninguna) $/.test(q)) return { blocks: [text(`Entendido. ${SEARCH_CTA}`)], chips: viewingChips(viewing, MENU), context: previous };

  const condition = conditionOf(q);
  const parsed: Partial<CopilotContext> = {
    ...(e.models.length && { models: e.models.slice(0, 3) }),
    ...(e.brand && { brand: e.brand }),
    ...(e.gearbox && { gearbox: e.gearbox }),
    ...(e.category && { category: e.category }),
    ...(e.electric && { electric: true }),
    ...(e.city && { city: e.city }),
    ...(e.year && { year: e.year }),
    ...(e.km !== null && { km: Math.round(e.km) }),
    ...(e.min !== null && { min: e.min }),
    ...(e.max !== null && { max: e.max }),
    ...(e.amount !== null && { amount: e.amount }),
    ...(e.use && { use: e.use }),
    ...(e.priority && { priority: e.priority }),
    ...(condition !== null && { condition }),
  };
  const hasFilters = Object.keys(parsed).length > 0;

  // «Ayúdame a elegir»: presupuesto → uso → prioridad, y luego la búsqueda.
  const guideStart = /(ayudame a elegir|ayuda a elegir|no se que (comprar|auto)|recomiendame|que me recomiendas|que auto compro)/.test(q) && !e.models.length;
  if (guideStart) return guideStep(1, EMPTY);
  if (previous.guide && !e.models.length && !e.isFair && !e.isSell) {
    const skip = /(da igual|cualquiera|no se|no tengo|sin tope|todas|lo que sea)/.test(q);
    const ctx = { ...previous, ...parsed };
    if (previous.guide === 1 && (e.min !== null || e.max !== null || e.amount !== null || skip)) {
      return guideStep(2, { ...ctx, max: e.max ?? (e.amount !== null && e.min === null ? e.amount : ctx.max), amount: null });
    }
    if (previous.guide === 2 && (e.use || skip)) return guideStep(3, ctx);
    if (previous.guide === 3 && (e.priority || skip)) return withFixes(await search({ ...ctx, guide: null, intent: 'search' }, vocab, 'search'));
  }

  // Dudas de la app y de compra (cuenta, verificación, pagos, publicar…): antes que las búsquedas.
  const topic = matchHelp(raw, e.models.length > 0);
  if (topic) return helpTurn(helpAnswer(topic, await facts(), SEARCH_CTA), raw, previous);

  const fresh = /(otro modelo|otro auto|otro carro)/.test(q);
  const keep = !fresh && (/^ (y|tambien|ahora|pero|y si|y en)\b/.test(q) || (words <= 6 && !hasFilters) || (words <= 6 && !e.models.length && !e.brand && previous.models.length > 0 && !e.category));
  const base = keep ? { ...previous, guide: null } : { ...EMPTY };
  if (keep && e.brand && !e.models.length && previous.models.length && normalizeText(vocab.models[previous.models[0]!]?.make ?? '') !== e.brand) base.models = [];
  if (keep && (e.min !== null || e.max !== null)) Object.assign(base, { min: null, max: null });
  const f: Filters = { ...base, ...parsed, guide: null, ...(e.bothGearboxes && { gearbox: null }) };

  const facts$ = facts();
  const faq = FAQ.find(item => item.re.test(q));
  const faqTurn = async (item: Faq): Promise<Turn> => {
    const extra: FaqExtra = { gearboxGap: item.id === 'gearbox' ? await gearboxGap() : null, verified, viewing };
    const answer = item.answer(await facts$, extra);
    const top = topModels(vocab, 2);
    const chips = item.id === 'gearbox' ? top.map(model => chip(`${model.label} automático vs sincrónico`, `${model.label} automatico o sincronico`)) : typeof item.chips === 'function' ? item.chips(extra) : item.chips;
    const cta = item.id === 'gearbox' ? (top[0] ? `¿Comparo el ${top[0].label} automático y sincrónico?` : null) : typeof item.cta === 'function' ? item.cta(extra) : item.cta;
    const asked = normalizeText(raw).replace(/[¿?]/g, '').trim();
    const shown = [...chips.filter(item => item !== MENU_CHIP && normalizeText(item.text ?? '').replace(/[¿?]/g, '').trim() !== asked), MENU_CHIP];
    // El cierre se dice solo si su opción quedó primera (si era la misma pregunta, se quitó).
    const keeps = !chips.length || shown[0] === chips[0] || !cta?.startsWith('¿');
    return { blocks: [text(withCta(answer, keeps ? cta : null))], chips: shown, context: { ...f, intent: null } };
  };
  const moneyQuestion = faq && ['commission', 'plans', 'payments', 'publish'].includes(faq.id);

  // Enrutamiento (en este orden, como en el diseño).
  if (e.isSell && !(moneyQuestion && !e.models.length)) return withFixes(await sell(f, vocab));
  if (f.models.length >= 2 && e.models.length >= 2) return withFixes(await versus(f, vocab));
  const gearboxTalk = e.bothGearboxes || /(diferencia|comparar|compara|versus| vs |contra).*(caja|automatico|sincronico)|(automatico|sincronico).*(diferencia|versus| vs |contra)/.test(q);
  if (gearboxTalk && !f.models.length && faq?.id === 'gearbox' && !/(comparar automatico y sincronico|otro modelo)/.test(q)) return faqTurn(faq);
  if (gearboxTalk) return withFixes(await sameModel(f, vocab));
  if (keep && hasFilters && previous.intent && !e.isFair && !e.isSell && !e.isInfo) return withFixes(await run(previous.intent, f, vocab, viewing, q));
  if (faq && !e.models.length && e.amount === null && !/(busco|quiero|necesito|muestrame)/.test(q) && !e.isInfo) return faqTurn(faq);
  if (e.isInfo && f.models.length) return withFixes(await modelInfo(f, vocab));
  if (e.isFair || (e.amount !== null && f.models.length)) return withFixes(await fair(f, vocab, viewing, q));
  if (faq && e.isQuestion) return faqTurn(faq);
  if (/(mas barat|economic|baratos|barato)/.test(q)) return withFixes(await search({ ...f, intent: 'cheap' }, vocab, 'cheap'));
  if (/(cuantos|cuantas|hay )/.test(q) && hasFilters) return withFixes(await count({ ...f, intent: 'count' }, vocab));
  const asking = /\b(como|saber|que es|que pasa|donde|cuando|por que|puedo|se puede)\b/.test(q);
  if (hasFilters || (/(busco|quiero|necesito|muestrame|dame|ver )/.test(q) && !asking)) return withFixes(await search({ ...f, intent: 'search' }, vocab, 'search'));
  // Ninguna regla encaja: se busca en los Términos y políticas publicados y, si tampoco, se dice.
  const reply = searchTerms(raw, (await facts$).settings.termsContent) ?? helpFallback();
  return helpTurn(reply, raw, previous, viewingChips(viewing, MENU).slice(0, 3));
}

/** Respuesta de una duda (tema de ayuda, Términos o «no lo sé»): sin repetir lo que se preguntó. */
function helpTurn(reply: HelpAnswer, asked: string, previous: CopilotContext, extra: CopilotChipDTO[] = []): Turn {
  const chips = [...reply.chips, ...extra].filter(item => !item.text || !sameQuestion(item.text, asked));
  // El cierre corresponde a la primera opción del tema: si se quitó por ser la misma pregunta, no se dice.
  const keeps = !reply.chips.length || chips[0] === reply.chips[0];
  return { blocks: [text(withCta(reply.text, keeps ? reply.cta : null))], chips: [...chips, ...(extra.length ? [] : [MENU_CHIP])], context: { ...previous, intent: null, guide: null } };
}

function run(intent: CopilotIntent, f: Filters, vocab: Vocabulary, viewing: Viewing | null, q: string): Promise<Turn> {
  if (intent === 'cheap' || intent === 'search') return search({ ...f, intent }, vocab, intent);
  if (intent === 'count') return count(f, vocab);
  if (intent === 'fair') return fair(f, vocab, viewing, q);
  if (intent === 'same') return sameModel(f, vocab);
  if (intent === 'versus') return versus(f, vocab);
  if (intent === 'sell') return sell(f, vocab);
  return modelInfo(f, vocab);
}

const viewingChips = (viewing: Viewing | null, chips: CopilotChipDTO[]) => (viewing ? [say('¿Este auto tiene buen precio?'), ...chips] : chips);

async function greet(vocab: Vocabulary, viewing: Viewing | null): Promise<Turn> {
  const total = await countPublished();
  const examples = topModels(vocab, 1)[0];
  const cta = viewing ? '¿Reviso si tiene buen precio frente a los parecidos?' : 'Elige una opción o escribe lo que buscas.';
  const intro =
    total === 0
      ? 'Todavía no hay autos publicados. Te resuelvo dudas de tu cuenta, la verificación, cómo publicar, las reservas, los pagos o qué revisar antes de comprar.'
      : `Hay **${total} ${total === 1 ? 'auto publicado' : 'autos publicados'}** en AutoMarket. Escríbeme como le escribirías a un vendedor:\n- «camioneta automática hasta 20 mil»${examples ? `\n- «¿cuánto cuesta un ${examples.label}?»` : ''}\nTambién reviso precios y resuelvo dudas de tu cuenta, la verificación, las reservas y los pagos.`;
  return {
    blocks: viewing ? [text(intro), text(withCta(`Estás viendo el **${viewing.make} ${viewing.model} ${viewing.year}**.`, cta))] : [text(withCta(intro, cta))],
    chips: viewingChips(viewing, MENU),
    context: EMPTY,
  };
}

async function guideStep(step: 1 | 2 | 3, ctx: CopilotContext): Promise<Turn> {
  const context = { ...ctx, guide: step, intent: null };
  if (step === 1) {
    // Los cortes salen de los precios publicados (tercios), redondeados a mil.
    const prices = (await prisma.vehicle.findMany({ where: { deletedAt: null, status: 'PUBLISHED', currency: 'USD' }, select: { price: true }, orderBy: { price: 'asc' }, take: 2000 })).map(row => Number(row.price));
    const low = prices.length >= 6 ? Math.max(1000, roundTo(prices[Math.floor(prices.length / 3)]!, 1000)) : 12_000;
    const high = prices.length >= 6 ? Math.max(low + 1000, roundTo(prices[Math.floor((prices.length * 2) / 3)]!, 1000)) : 25_000;
    return {
      blocks: [text('**Paso 1 de 3.** ¿Cuánto quieres gastar? Elige un rango o escribe un monto.')],
      chips: [chip(`Hasta ${usd(low)}`, `hasta ${low}`), chip(`${usd(low)} a ${usd(high)}`, `entre ${low} y ${high}`), chip(`Más de ${usd(high)}`, `mas de ${high}`), chip('No tengo un tope', 'da igual')],
      context,
    };
  }
  if (step === 2) return { blocks: [text('**Paso 2 de 3.** ¿Para qué lo vas a usar más?')], chips: [chip('Ciudad y tráfico', 'ciudad'), chip('Familia y viajes', 'familia'), chip('Trabajo y carga', 'trabajo'), chip('De todo un poco', 'da igual')], context };
  return { blocks: [text('**Paso 3 de 3.** ¿Qué te importa más?')], chips: [chip('Gastar poco en gasolina', 'gaste poco'), chip('Que dure y se revenda bien', 'reventa'), chip('Espacio y comodidad', 'espacio'), chip('Nada en especial', 'da igual')], context };
}

async function search(f: Filters, vocab: Vocabulary, mode: 'search' | 'cheap'): Promise<Turn> {
  let used = f;
  let rows = await find(f, vocab);
  let relaxed = '';
  if (!rows.length && f.city) {
    const next = { ...f, city: null };
    rows = await find(next, vocab);
    if (rows.length) [used, relaxed] = [next, ` No hay en ${f.city}, así que busqué en todo el país.`];
  }
  if (!rows.length && f.max !== null) {
    const next = { ...used, max: Math.round(f.max * 1.15) };
    rows = await find(next, vocab);
    if (rows.length) [used, relaxed] = [next, ` Nada hasta ${usd(f.max)}; subí el tope un 15 %.`];
  }
  if (!rows.length && f.gearbox) {
    const next = { ...used, gearbox: null };
    rows = await find(next, vocab);
    if (rows.length) [used, relaxed] = [next, ` No hay ${gearboxWord(f.gearbox, false, true)} con eso; te muestro de las dos cajas.`];
  }
  const desc = describe(used, vocab);
  if (!rows.length) {
    const total = await countPublished();
    return {
      blocks: [text(withCta(`No hay ${describe(f, vocab)} entre los **${total} autos publicados**. Prueba con un tope más alto o quita algún filtro.`, '¿Vemos el catálogo completo?'))],
      chips: [{ label: 'Ver el catálogo', href: '/vehiculos' }, chip('Empezar de nuevo', 'menu')],
      context: used,
    };
  }
  const prices = rows.map(priceOf);
  const mean = avg(prices);
  const groupKm = avg(rows.map(row => row.mileageKm));
  let picks: Row[];
  let tags: Array<string | null>;
  if (mode === 'cheap') {
    picks = rows.slice(0, 3);
    tags = ['El más barato', '#2 en precio', '#3 en precio'];
  } else {
    // Encaje con el uso y la prioridad; después pesan el precio y los km frente al resto del grupo.
    const score = (row: Row) =>
      (used.use ? (USE_FIT[used.use][row.category] ?? 0) * 2 : 0) +
      (used.priority ? PRIORITY_FIT[used.priority](row) * 2 : 0) +
      ((mean - priceOf(row)) / mean) * 1.5 +
      ((groupKm - row.mileageKm) / Math.max(groupKm, 1)) * 1.5;
    picks = [...rows].sort((a, b) => score(b) - score(a) || priceOf(a) - priceOf(b)).slice(0, 3);
    tags = picks.map(() => null);
  }
  const items: CopilotPickDTO[] = picks.map((row, i) => ({ vehicle: toCardDTO(row), tag: tags[i] ?? null, reasons: reasonsOf(row, used, groupKm) }));
  const lead =
    mode === 'cheap'
      ? `De **${rows.length} ${desc}**, ${isFem(used) ? 'estas son las más baratas' : 'estos son los más baratos'}. Precio medio del grupo: **${usd(mean)}**.`
      : rows.length === 1
        ? `Solo hay uno con eso (${desc}): **${usd(prices[0]!)}**.`
        : `Hay **${rows.length} ${desc}**. Precio medio: **${usd(mean)}**.${used.use || used.priority ? ` Estos ${picks.length} son los que mejor encajan con lo que me dijiste:` : ` Estos ${picks.length} tienen el mejor precio para sus kilómetros:`}`;
  const top = picks[0]!;
  const toggle: CopilotChipDTO[] =
    used.gearbox === 'AUTOMATIC' ? [chip('¿Y sincrónicos?', 'y sincronicos')] : used.gearbox === 'MANUAL' ? [chip('¿Y automáticos?', 'y automaticos')] : rows.some(isAuto) && rows.some(row => !isAuto(row)) ? [chip('Solo automáticos', 'y en automatico')] : [];
  const catalog: CopilotChipDTO = { label: rows.length > 1 ? `Ver los ${rows.length} en el catálogo` : 'Ver en el catálogo', href: catalogHref(used, vocab) };
  const fairCheck = chip(`¿El ${top.model} ${top.year} tiene buen precio?`, `${top.make} ${top.model} ${top.year} en ${Math.round(priceOf(top))} es buen precio`);
  // Siguiente paso: si hay más de los que caben aquí, verlos todos; si no, revisar el precio del primero.
  const more = rows.length > picks.length;
  const chips: CopilotChipDTO[] = more ? [catalog, fairCheck, ...toggle, chip('Empezar de nuevo', 'menu')] : [fairCheck, ...toggle, catalog, chip('Empezar de nuevo', 'menu')];
  const cta = more ? `¿Vemos los ${rows.length} en el catálogo?` : `¿Reviso si el ${top.model} ${top.year} tiene buen precio?`;
  return {
    blocks: [text(lead + relaxed), { type: 'picks', items }, close(cta), note(`Datos de ${rows.length} ${rows.length === 1 ? 'anuncio publicado' : 'anuncios publicados'} en AutoMarket.`)],
    chips,
    context: { ...used, intent: mode },
  };
}

async function count(f: Filters, vocab: Vocabulary): Promise<Turn> {
  const rows = await find(f, vocab, true);
  const desc = describe(f, vocab);
  if (!rows.length) return { blocks: [text(withCta(`Ahora no hay ${desc} ${published(f)}.`, '¿Vemos el catálogo completo?'))], chips: [{ label: 'Ver el catálogo', href: '/vehiculos' }, chip('Empezar de nuevo', 'menu')], context: { ...f, intent: 'count' } };
  const prices = rows.map(priceOf);
  return {
    blocks: [
      text(
        withCta(
          rows.length === 1 ? `Hay uno: **${usd(prices[0]!)}**.` : `Hay **${rows.length} ${desc} ${published(f)}**.\n- Desde **${usd(Math.min(...prices))}** hasta **${usd(Math.max(...prices))}**.\n- Precio medio: **${usd(avg(prices))}**.`,
          '¿Te muestro los mejores?',
        ),
      ),
    ],
    chips: [chip('Muéstrame los mejores', 'muestrame los mejores'), chip('Los más baratos', 'los mas baratos'), { label: 'Ver en el catálogo', href: catalogHref(f, vocab) }],
    context: { ...f, intent: 'count' },
  };
}

/** ¿Precio justo? Con año: el valor estimado de la ficha (±2 años, ajustado por km y caja). */
async function fair(f: Filters, vocab: Vocabulary, viewing: Viewing | null, q: string): Promise<Turn> {
  const aboutViewing = viewing && (!f.models.length || /(este auto|este carro|este precio)/.test(q));
  const model = aboutViewing ? { make: viewing.make, label: viewing.model } : f.models[0] ? vocab.models[f.models[0]] : undefined;
  if (!model) {
    const top = topModels(vocab, 2);
    const examples = await Promise.all(
      top.map(async item => {
        const row = await prisma.vehicle.findFirst({ where: { deletedAt: null, status: 'PUBLISHED', currency: 'USD', make: item.make, model: item.label }, orderBy: { createdAt: 'desc' }, select: { year: true, price: true } });
        return row ? chip(`${item.label} ${row.year} en ${usd(Number(row.price))}`, `${item.label} ${row.year} en ${Math.round(Number(row.price))}`) : null;
      }),
    );
    return {
      blocks: [text('¿Qué auto quieres revisar? Escribe el modelo, el año y el precio que te piden, por ejemplo «Corolla 2021 en 18.500».')],
      chips: [...examples.filter((item): item is CopilotChipDTO => item !== null), ...(top[0] ? [chip(`¿Cuánto cuesta un ${top[0].label}?`, `cuanto cuesta un ${top[0].label}`)] : [])],
      context: { ...f, intent: 'fair' },
    };
  }
  const year = aboutViewing ? viewing.year : f.year;
  const km = aboutViewing ? viewing.mileageKm : f.km;
  const gearbox = aboutViewing ? (viewing.transmission === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC') : f.gearbox;
  const price = aboutViewing ? viewing.price : (f.amount ?? f.max);
  const name = nameOf(model.make, model.label, year, gearbox);
  const context = { ...f, intent: 'fair' as const };

  if (!year) {
    const rows = await find({ ...EMPTY, models: f.models, gearbox: f.gearbox }, vocab, true);
    if (!rows.length) return { blocks: [text(withCta(`Ahora no hay ${model.label} publicados para comparar.`, '¿Vemos el catálogo completo?'))], chips: [{ label: 'Ver el catálogo', href: '/vehiculos' }, MENU_CHIP], context };
    const prices = rows.map(priceOf);
    const years = [...new Set(rows.map(row => row.year))].sort((a, b) => b - a).slice(0, 3);
    // Falta el año: se pide solo ese dato (los km, si los sabe).
    const ask = price ? `¿De qué año es el de ${usd(price)}?` : '¿De qué año es? Si sabes los km, escríbelos también.';
    return {
      blocks: [
        text(
          rows.length === 1
            ? `Ahora solo hay un ${model.make} ${model.label} publicado: ${rows[0]!.year}, en **${usd(prices[0]!)}**.\n\n**${ask}**`
            : `Un ${model.make} ${model.label} se publica en promedio en **${usd(avg(prices))}**:\n- El más barato: **${usd(Math.min(...prices))}**.\n- El más caro: **${usd(Math.max(...prices))}**.\n- Años: de ${Math.min(...rows.map(row => row.year))} a ${Math.max(...rows.map(row => row.year))}.\n\n**${ask}**`,
        ),
      ],
      chips: years.map(y => chip(`${model.label} ${y}${price ? ` en ${usd(price)}` : ''}`, `${model.label} ${y}${price ? ` en ${Math.round(price)}` : ''}`)),
      context,
    };
  }

  const insights = await vehicleInsights({ make: model.make, model: model.label, year, ...(km !== null && { mileageKm: km }), ...(gearbox && { transmission: gearbox }), ...(aboutViewing && { excludeId: viewing.id }) });
  const market = insights.market;
  if (!market) {
    return {
      blocks: [
        text(
          withCta(
            insights.comparables ? `Solo hay ${insights.comparables} ${model.label} de ${year - 2} a ${year + 2}: hacen falta al menos **${MIN_MARKET_COMPARABLES}** para estimar un precio.` : `No hay ${model.label} de ${year - 2} a ${year + 2} para comparar ahora.`,
            `¿Vemos los ${model.label} del catálogo?`,
          ),
        ),
      ],
      chips: [{ label: `Ver ${model.label} en el catálogo`, href: `/vehiculos?${new URLSearchParams({ make: model.make, model: model.label })}` }, MENU_CHIP],
      context,
    };
  }
  const sample = `Según ${market.sample} ${model.label} parecidos (${year - 2}–${year + 2}) publicados o vendidos en AutoMarket.${market.sample < 5 ? ' Son pocos: tómalo como referencia.' : ''}`;
  const otherGearbox = gearbox === 'AUTOMATIC' ? chip('¿Y en sincrónico?', 'y en sincronico') : chip('¿Y en automático?', 'y en automatico');
  if (!price) {
    return {
      blocks: [
        text(`Un ${name} ronda **${usd(market.value)}**. Lo normal va de **${usd(market.low)}** a **${usd(market.high)}**.`),
        { type: 'gauge', title: name, subtitle: km !== null ? kmText(km) : 'Sin kilometraje: promedio del grupo', verdict: 'Valor de mercado', tone: 'neutral', scale: { min: market.low * 0.85, max: market.high * 1.15 }, band: { low: market.low, high: market.high }, price: null, rows: [{ label: 'Valor estimado', value: usd(market.value) }, { label: 'Rango normal', value: `${usd(market.low)} – ${usd(market.high)}` }] },
        close(`¿Te muestro los ${model.label} más baratos publicados?`),
        note(sample),
      ],
      chips: [chip('Ver los más baratos', 'los mas baratos'), otherGearbox, MENU_CHIP],
      context,
    };
  }
  const diff = (price - market.value) / market.value;
  const d = Math.round(diff * 100);
  const [verdict, tone] =
    price < market.low ? (d <= -12 ? ['Muy por debajo: revísalo bien', 'warn'] : ['Buen precio', 'good']) : price <= market.value ? ['Precio justo', 'good'] : price <= market.high ? [`Algo alto (+${d} %)`, 'warn'] : [`Alto (+${d} %)`, 'warn'];
  const advice =
    price > market.value
      ? `Está **${d} % por encima** del valor estimado. Ofrecer cerca de **${usd(Math.max(market.low, market.value))}** tiene base; el vendedor decide.`
      : d <= -12
        ? 'Está **muy por debajo** de lo normal. Puede ser una oportunidad, pero revisa papeles y kilometraje, y que el vendedor esté verificado.'
        : 'Está **dentro de lo normal**. Antes de reservar, pide las facturas de mantenimiento.';
  // Siguiente paso: si está caro, ver opciones más baratas; si es el auto abierto y está bien, reservarlo.
  const nextStep = price <= market.value && aboutViewing ? 'Si te convence, toca «Reservar» en la ficha.' : `¿Te muestro ${model.label} más baratos?`;
  return {
    blocks: [
      text(
        `Comparé ${aboutViewing ? 'este' : 'ese'} ${name} con ${market.sample} parecidos: **${
          price < market.low ? (d <= -12 ? 'está muy por debajo de lo normal' : 'tiene buen precio') : price <= market.value ? 'está en precio justo' : price <= market.high ? 'está algo alto' : 'está alto'
        }**.`,
      ),
      {
        type: 'gauge',
        title: name,
        subtitle: `Precio que revisas: ${usd(price)}`,
        verdict,
        tone: tone as 'good' | 'warn',
        scale: { min: Math.min(market.low, price) * 0.9, max: Math.max(market.high, price) * 1.1 },
        band: { low: market.low, high: market.high },
        price,
        rows: [
          { label: 'Valor estimado', value: usd(market.value) },
          { label: 'Rango normal', value: `${usd(market.low)} – ${usd(market.high)}` },
          { label: 'Diferencia con el valor', value: `${d > 0 ? '+' : ''}${d} %` },
        ],
      },
      text(withCta(advice, nextStep)),
      note(sample),
    ],
    chips: [chip(`Ver ${model.label} más baratos`, `${model.label} mas baratos`), otherGearbox, MENU_CHIP],
    context,
  };
}

/** Mismo modelo: automáticos contra sincrónicos, con los más baratos de cada caja. */
async function sameModel(f: Filters, vocab: Vocabulary): Promise<Turn> {
  const model = f.models[0] ? vocab.models[f.models[0]] : undefined;
  if (!model) {
    return {
      blocks: [text('¿Qué modelo comparo? Elige uno o escríbelo: junto todos los iguales y los separo en automáticos y sincrónicos.')],
      chips: topModels(vocab, 3).map(item => chip(`${item.make} ${item.label}`, `${item.label} automatico o sincronico`)),
      context: { ...f, intent: 'same' },
    };
  }
  const rows = await find({ ...EMPTY, models: [f.models[0]!], city: f.city }, vocab, true);
  const available = rows.filter(row => row.status === 'PUBLISHED');
  const context = { ...f, gearbox: null, intent: 'same' as const };
  if (!rows.length) return { blocks: [text(withCta(`Ahora no hay ${model.make} ${model.label} publicados.`, '¿Vemos el catálogo completo?'))], chips: [{ label: 'Ver el catálogo', href: '/vehiculos' }, MENU_CHIP], context };
  const autos = rows.filter(isAuto);
  const manuals = rows.filter(row => !isAuto(row));
  const groups = [
    ...(autos.length ? [{ label: 'Automático', count: autos.length, avg: avg(autos.map(priceOf)) }] : []),
    ...(manuals.length ? [{ label: 'Sincrónico', count: manuals.length, avg: avg(manuals.map(priceOf)) }] : []),
  ];
  const cheapest = available[0] ?? rows[0]!;
  const years = rows.map(row => row.year);
  let lead: string;
  if (!autos.length || !manuals.length) {
    lead = `Del ${model.make} ${model.label} solo hay ${autos.length ? 'automáticos' : 'sincrónicos'} publicados (${rows.length}). Precio medio: **${usd(avg(rows.map(priceOf)))}**.`;
  } else {
    const gap = groups[0]!.avg - groups[1]!.avg;
    const rate = Math.abs(gap) / Math.min(groups[0]!.avg, groups[1]!.avg);
    lead = `Hay **${rows.length} ${model.make} ${model.label}** publicados. Los automáticos cuestan en promedio **${usd(Math.abs(gap))} ${gap >= 0 ? 'más' : 'menos'}** que los sincrónicos (${Math.round(rate * 100)} %). El más barato es el ${cheapest.year}${cheapest.version ? ` ${cheapest.version}` : ''} ${isAuto(cheapest) ? 'automático' : 'sincrónico'} en **${usd(priceOf(cheapest))}**.`;
  }
  const commonYear = [...years].sort((a, b) => years.filter(y => y === b).length - years.filter(y => y === a).length)[0]!;
  return {
    blocks: [
      text(lead),
      { type: 'gearbox', title: `${model.make} ${model.label} ${Math.min(...years)}–${Math.max(...years)}`, groups, rows: available.slice(0, 6).map((row, i) => ({ vehicle: toCardDTO(row), cheapest: i === 0 })) },
      close(`¿Te calculo cuánto vale un ${model.label} ${commonYear}?`),
      note(`Datos de ${rows.length} ${rows.length === 1 ? 'anuncio' : 'anuncios'} · mismo modelo, varios años.`),
    ],
    chips: [chip(`¿Cuánto vale un ${model.label} ${commonYear}?`, `cuanto vale un ${model.label} ${commonYear}`), chip('Otro modelo', 'otro modelo automatico o sincronico'), MENU_CHIP],
    context,
  };
}

async function versus(f: Filters, vocab: Vocabulary): Promise<Turn> {
  const pair = f.models.slice(0, 2).flatMap(key => (vocab.models[key] ? [{ key, ...vocab.models[key] }] : []));
  const stats = await Promise.all(pair.map(async item => ({ item, rows: await find({ ...EMPTY, models: [item.key] }, vocab, true) })));
  const missing = stats.find(entry => !entry.rows.length);
  if (pair.length < 2 || missing) {
    return { blocks: [text(withCta(`No hay suficientes anuncios de ${missing?.item.label ?? 'ese modelo'} para comparar ahora.`, '¿Vemos el catálogo completo?'))], chips: [{ label: 'Ver el catálogo', href: '/vehiculos' }, MENU_CHIP], context: { ...f, intent: 'versus' } };
  }
  const info = stats.map(({ item, rows }) => {
    const prices = rows.map(priceOf);
    const categories = rows.map(row => row.category);
    const category = [...categories].sort((a, b) => categories.filter(c => c === b).length - categories.filter(c => c === a).length)[0]!;
    return { item, count: rows.length, mean: avg(prices), min: Math.min(...prices), km: avg(rows.map(row => row.mileageKm)), year: Math.round(avg(rows.map(row => row.year))), category };
  });
  const [a, b] = info as [(typeof info)[0], (typeof info)[0]];
  const cheaper = a.mean <= b.mean ? a : b;
  const closing =
    a.category === b.category ? 'Son del mismo tipo, así que deciden el precio y el kilometraje.' : a.category === 'SUV' || b.category === 'SUV' ? 'Si buscas espacio, la camioneta gana.' : 'Si buscas gastar poco, gana el más pequeño.';
  return {
    blocks: [
      text(`En AutoMarket, el ${cheaper.item.make} ${cheaper.item.label} sale **${usd(Math.abs(a.mean - b.mean))} más barato** en promedio. ${TYPE_LABEL[a.category] ?? a.category} contra ${(TYPE_LABEL[b.category] ?? b.category).toLowerCase()}: ${closing.charAt(0).toLowerCase()}${closing.slice(1)}`),
      {
        type: 'versus',
        columns: [a.item.label, b.item.label],
        rows: [
          { label: 'Anuncios', values: [String(a.count), String(b.count)] },
          { label: 'Precio medio', values: [usd(a.mean), usd(b.mean)] },
          { label: 'Más barato', values: [usd(a.min), usd(b.min)] },
          { label: 'Km medio', values: [kmText(a.km), kmText(b.km)] },
          { label: 'Año medio', values: [String(a.year), String(b.year)] },
          { label: 'Tipo', values: [TYPE_LABEL[a.category] ?? a.category, TYPE_LABEL[b.category] ?? b.category] },
        ],
      },
      close(`¿Te muestro los ${cheaper.item.label} más baratos?`),
      note(`Basado en ${a.count + b.count} anuncios publicados.`),
    ],
    chips: [chip(`Ver ${cheaper.item.label} más baratos`, `${cheaper.item.label} mas baratos`), ...[a, b].filter(item => item !== cheaper).map(item => chip(`Ver ${item.item.label} más baratos`, `${item.item.label} mas baratos`)), MENU_CHIP],
    context: { ...f, intent: 'versus' },
  };
}

/** ¿A cuánto vendo? El valor estimado de la ficha, con el estado que cuente la persona. */
async function sell(f: Filters, vocab: Vocabulary): Promise<Turn> {
  const model = f.models[0] ? vocab.models[f.models[0]] : undefined;
  const context = { ...f, intent: 'sell' as const };
  if (!model || !f.year) {
    const top = topModels(vocab, 2);
    const years = model ? (await prisma.vehicle.findMany({ where: { deletedAt: null, status: 'PUBLISHED', make: model.make, model: model.label }, distinct: ['year'], orderBy: { year: 'desc' }, take: 3, select: { year: true } })).map(row => row.year) : [];
    return {
      blocks: [text(model ? `¿De qué año es tu ${model.label} y cuántos kilómetros tiene? Por ejemplo: «${model.label} ${years[0] ?? 2020} con 60 mil km».` : '¿Qué auto vendes? Escribe el modelo, el año y los kilómetros, por ejemplo «vendo mi Corolla 2020 con 60 mil km».')],
      chips: model ? years.map(year => chip(`${model.label} ${year}`, `vendo mi ${model.label} ${year}`)) : top.map(item => chip(`${item.label} 2020, 60 mil km`, `vendo mi ${item.label} 2020 con 60 mil km`)),
      context,
    };
  }
  const insights = await vehicleInsights({ make: model.make, model: model.label, year: f.year, ...(f.km !== null && { mileageKm: f.km }), ...(f.gearbox && { transmission: f.gearbox }) });
  if (!insights.market) {
    return {
      blocks: [text(withCta(`No hay suficientes ${model.label} parecidos (${f.year - 2}–${f.year + 2}) para calcular un precio.`, `¿Vemos cómo se publican los ${model.label} en el catálogo?`))],
      chips: [{ label: `Ver ${model.label} en el catálogo`, href: `/vehiculos?${new URLSearchParams({ make: model.make, model: model.label })}` }, MENU_CHIP],
      context,
    };
  }
  const value = roundTo(insights.market.value * (f.condition ?? 1), 10);
  const peers = await prisma.vehicle.aggregate({ where: { deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED', 'PENDING_SALE', 'SOLD'] }, currency: 'USD', make: model.make, model: model.label, year: { gte: f.year - 2, lte: f.year + 2 } }, _avg: { mileageKm: true } });
  const peerKm = peers._avg.mileageKm;
  const kmNote = f.km !== null && peerKm !== null && Math.abs(f.km - peerKm) > 8000 ? ` Tiene **${f.km < peerKm ? 'menos' : 'más'} km** que el promedio (${kmText(peerKm)}), por eso el precio ${f.km < peerKm ? 'sube' : 'baja'} un poco.` : '';
  const name = nameOf(model.make, model.label, f.year);
  const params = new URLSearchParams({ marca: model.make, modelo: model.label, anio: String(f.year), precio: String(value), ...(f.km !== null && { km: String(f.km) }) });
  return {
    blocks: [
      text(`Un buen precio para tu ${name} es **${usd(value)}**.${kmNote}`),
      {
        type: 'gauge',
        title: name,
        subtitle: `${f.km !== null ? kmText(f.km) : 'Sin kilometraje'}${f.condition === 1.04 ? ' · como nuevo' : f.condition === 0.9 ? ' · con detalles' : ''}`,
        verdict: 'Precio recomendado',
        tone: 'good',
        scale: { min: value * 0.85, max: value * 1.15 },
        band: { low: value * 0.93, high: value * 1.07 },
        price: value,
        rows: [
          { label: 'Vende rápido', value: usd(roundTo(value * 0.93, 10)) },
          { label: 'Precio justo', value: usd(value) },
          { label: 'Arriba del mercado', value: usd(roundTo(value * 1.07, 10)) },
          { label: 'Comparado con', value: `${insights.market.sample} anuncios parecidos` },
        ],
      },
      text(withCta('Si lo necesitas rápido, publícalo en el primer número. Con fotos claras de día y del interior suele venderse antes.', `¿Lo publicamos en ${usd(value)}?`)),
      note(`Según ${insights.market.sample} ${model.label} parecidos publicados o vendidos en AutoMarket.`),
    ],
    chips: [{ label: `Publicar con ${usd(value)}`, href: `/cuenta/anuncios/nuevo?${params}` }, chip('Otro auto', 'vendo otro auto'), MENU_CHIP],
    context,
  };
}

/** «¿Qué tal la Hilux?»: lo que dicen los anuncios (sin opiniones inventadas). */
async function modelInfo(f: Filters, vocab: Vocabulary): Promise<Turn> {
  const model = f.models[0] ? vocab.models[f.models[0]] : undefined;
  if (!model) return { blocks: [text('¿De qué modelo quieres saber? Elige uno o escríbelo.')], chips: topModels(vocab, 3).map(item => chip(`¿Qué tal el ${item.label}?`, `que tal el ${item.label}`)), context: { ...f, intent: 'info' } };
  const [rows, insights] = await Promise.all([find({ ...EMPTY, models: [f.models[0]!] }, vocab, true), vehicleInsights({ make: model.make, model: model.label })]);
  const typical = insights.typical;
  const traits = typical
    ? [
        typical.category ? (TYPE_LABEL[typical.category] ?? typical.category).toLowerCase() : null,
        typical.transmission ? (typical.transmission === 'MANUAL' ? 'sincrónico' : 'automático') : null,
        typical.fuelType ? FUEL_LABELS[typical.fuelType].toLowerCase() : null,
        typical.drivetrain === 'FOUR_WD' || typical.drivetrain === 'AWD' ? DRIVETRAIN_LABELS[typical.drivetrain] : null,
      ].filter(Boolean)
    : [];
  const market = rows.length
    ? [`- Publicados: **${rows.length}**, de ${Math.min(...rows.map(row => row.year))} a ${Math.max(...rows.map(row => row.year))}.`, `- Precio: de **${usd(priceOf(rows[0]!))}** a **${usd(priceOf(rows[rows.length - 1]!))}** (promedio **${usd(avg(rows.map(priceOf)))}**).`]
    : ['- Ahora no hay ninguno publicado.'];
  const year = rows[0]?.year;
  return {
    blocks: [
      text(
        withCta(
          [`Lo que dicen los anuncios del **${model.make} ${model.label}**:`, ...(traits.length ? [`- Lo más común: ${traits.join(', ')}.`] : []), ...market].join('\n'),
          `¿Comparo el ${model.label} automático y sincrónico?`,
        ),
      ),
      note('Para fallas conocidas de un auto en concreto, pide el historial al vendedor y llévalo a un mecánico de confianza.'),
    ],
    chips: [chip('¿Automático o sincrónico?', `${model.label} automatico o sincronico`), chip(`Ver ${model.label} más baratos`, `${model.label} mas baratos`), ...(year ? [chip(`¿Cuánto vale un ${model.label} ${year}?`, `cuanto vale un ${model.label} ${year}`)] : [])],
    context: { ...f, intent: 'info' },
  };
}
