import {
  DRIVETRAIN_LABELS,
  FUEL_LABELS,
  MAX_VEHICLE_MEDIA,
  countryName,
  normalizeText,
  smartParse,
  usdPrice,
  usdText,
  type CopilotChipDTO,
  type DealerCopilotAskInput,
  type DealerCopilotBlockDTO,
  type DealerCopilotEventDTO,
  type DealerCopilotInventoryItemDTO,
  type DealerCopilotOverviewDTO,
  type DealerCopilotReplyDTO,
  type DealerSuggestionDTO,
} from '@automarket/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/errors/app-error.js';
import { prisma } from '../../shared/infra/prisma.js';
import { vocabulary } from '../vehicles/vehicles.smart.js';
import { helpAnswer, matchHelp, searchTerms, withCta } from '../vehicles/copilot-help.js';
import { getSettings, listPlans } from '../memberships/plans.js';

/**
 * Copiloto para agencias (diseño «copiloto-agencia-pc») con datos reales y reglas, sin IA:
 * precio sugerido con anuncios activos parecidos y ventas cerradas (venta por reserva o venta
 * marcada con su comisión pagada), demanda por tipo de auto con vistas y contactos reales,
 * diagnóstico de autos que no se venden, descripción con los datos del anuncio y respuestas a
 * ofertas que llegaron por el chat. «Aprende» = recalcula con cada dato nuevo; no hay modelo.
 *
 * Voz (instrucciones del proyecto): empieza por la cifra o el estado, sin saludos; pasos y
 * opciones en listas, cifras en **negrita** y un solo siguiente paso al final, que es la primera
 * opción de la respuesta (así «sí» o «dale» la ejecuta).
 */

const DAY_MS = 86_400_000;
const SALES_WINDOW_DAYS = 365;
const STALE_DAYS = 45;
/** Fotos que pide el asistente de publicar (frente, lado, atrás, interior, tablero y motor). */
const SUGGESTED_PHOTOS = 6;
const usd = usdText;
const kmText = (km: number) => `${Math.round(km).toLocaleString('es-VE')} km`;
const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const round100 = (value: number) => Math.round(value / 100) * 100;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const titleOf = (v: { make: string; model: string; version: string | null; year: number }) => [v.make, v.model, v.version, v.year].filter(Boolean).join(' ');
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const say = (text: string): CopilotChipDTO => ({ label: text, text });
const text = (value: string): DealerCopilotBlockDTO => ({ type: 'text', text: value });
const note = (value: string): DealerCopilotBlockDTO => ({ type: 'note', text: value });
const go = (label: string, href: string): CopilotChipDTO => ({ label, href });
const MY_LISTINGS = go('Ir a Mis anuncios', '/cuenta/anuncios');
const NEW_LISTING = go('Publicar un auto', '/cuenta/anuncios/nuevo');
/** Cierre cuando la respuesta no trae una acción propia. */
const DEALER_CTA = 'Pregúntame por el precio de uno de tus autos o qué conviene traer.';

/** El siguiente paso va en la última burbuja de texto (antes de las notas de datos) o en una propia. */
function closeWith(blocks: DealerCopilotBlockDTO[], cta: string | null): DealerCopilotBlockDTO[] {
  if (!cta) return blocks;
  const out = [...blocks];
  let i = out.length - 1;
  while (i >= 0 && out[i]!.type === 'note') i -= 1;
  const last = out[i];
  if (last?.type === 'text') out[i] = text(withCta(last.text, cta));
  else out.splice(i + 1, 0, text(`**${cta}**`));
  return out;
}

const CATEGORY_PLURAL: Record<string, string> = { SUV: 'Camionetas', PICKUP: 'Pickups', SEDAN: 'Sedanes', HATCHBACK: 'Compactos', SPORTS: 'Deportivos', CONVERTIBLE: 'Convertibles', ELECTRIC: 'Eléctricos' };
const FEM = new Set(['SUV', 'PICKUP']);

async function dealerOf(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, businessName: true, accountType: true, city: true, country: true } });
  if (!user) throw AppError.notFound('USER_NOT_FOUND', 'Cuenta no encontrada.');
  if (user.accountType !== 'DEALER') throw AppError.forbidden('DEALER_ONLY', 'El Copiloto para agencias es para cuentas de concesionario.');
  return { ...user, display: user.businessName ?? user.name };
}
type Dealer = Awaited<ReturnType<typeof dealerOf>>;

const inventorySelect = {
  id: true,
  slug: true,
  make: true,
  model: true,
  version: true,
  year: true,
  mileageKm: true,
  price: true,
  transmission: true,
  fuelType: true,
  drivetrain: true,
  category: true,
  condition: true,
  ownersCount: true,
  exteriorColor: true,
  description: true,
  city: true,
  publishedAt: true,
  createdAt: true,
  _count: { select: { media: { where: { kind: 'IMAGE' } }, conversations: true } },
} satisfies Prisma.VehicleSelect;
type InventoryRow = Prisma.VehicleGetPayload<{ select: typeof inventorySelect }>;

async function inventory(userId: string) {
  const rows = await prisma.vehicle.findMany({ where: { sellerId: userId, deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] } }, orderBy: { publishedAt: 'desc' }, take: 200, select: inventorySelect });
  const views = rows.length ? await prisma.vehicleViewDay.groupBy({ by: ['vehicleId'], where: { vehicleId: { in: rows.map(row => row.id) } }, _sum: { views: true } }) : [];
  const viewsOf = new Map(views.map(row => [row.vehicleId, row._sum.views ?? 0]));
  const now = Date.now();
  return rows.map(row => ({
    row,
    item: {
      id: row.id,
      slug: row.slug,
      title: titleOf(row),
      model: row.model,
      year: row.year,
      price: Number(row.price),
      mileageKm: row.mileageKm,
      days: Math.max(0, Math.floor((now - (row.publishedAt ?? row.createdAt).getTime()) / DAY_MS)),
      photos: row._count.media,
      views: viewsOf.get(row.id) ?? 0,
      contacts: row._count.conversations,
    } satisfies DealerCopilotInventoryItemDTO,
  }));
}
type Owned = Awaited<ReturnType<typeof inventory>>[number];

/** Ventas cerradas en AutoMarket (reserva completada o venta marcada y pagada), con su precio final. */
async function closedSales(vehicle: Prisma.VehicleWhereInput, since: Date) {
  const select = { make: true, model: true, version: true, year: true, mileageKm: true, price: true, publishedAt: true, city: true } as const;
  const [reserves, direct] = await Promise.all([
    prisma.cartReserve.findMany({ where: { type: 'RESERVATION', status: 'COMPLETED', completedAt: { gte: since }, salePrice: { not: null }, currency: 'USD', vehicle }, orderBy: { completedAt: 'desc' }, take: 500, select: { salePrice: true, completedAt: true, vehicle: { select } } }),
    prisma.vehicleSale.findMany({ where: { status: 'COMPLETED', completedAt: { gte: since }, currency: 'USD', vehicle }, orderBy: { completedAt: 'desc' }, take: 500, select: { salePrice: true, completedAt: true, vehicle: { select } } }),
  ]);
  return [...reserves, ...direct]
    .filter(sale => sale.completedAt && sale.salePrice)
    .map(sale => ({
      price: Number(sale.salePrice),
      at: sale.completedAt!,
      vehicle: sale.vehicle,
      days: sale.vehicle.publishedAt ? Math.max(1, Math.round((sale.completedAt!.getTime() - sale.vehicle.publishedAt.getTime()) / DAY_MS)) : null,
    }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Precio sugerido (diseño): 50 % anuncios parecidos + 50 % ventas cerradas, ajuste por km, redondeo a $100. */
async function suggest(target: { make: string; model: string; year: number; mileageKm: number | null; id?: string; price?: number; title: string }): Promise<DealerSuggestionDTO | null> {
  const same: Prisma.VehicleWhereInput = { make: target.make, model: target.model, year: { gte: target.year - 1, lte: target.year + 1 } };
  const [active, sales] = await Promise.all([
    prisma.vehicle.findMany({ where: { ...same, deletedAt: null, status: { in: ['PUBLISHED', 'RESERVED'] }, currency: 'USD', ...(target.id && { id: { not: target.id } }) }, take: 300, select: { price: true, mileageKm: true } }),
    closedSales(same, new Date(Date.now() - SALES_WINDOW_DAYS * DAY_MS)),
  ]);
  if (!active.length && !sales.length) return null;
  const avgActive = avg(active.map(row => Number(row.price)));
  const avgSales = avg(sales.map(sale => sale.price));
  const base = avgActive !== null && avgSales !== null ? avgActive * 0.5 + avgSales * 0.5 : (avgActive ?? avgSales)!;
  const kmAvg = avg([...active.map(row => row.mileageKm), ...sales.map(sale => sale.vehicle.mileageKm)]);
  const adjust = target.mileageKm !== null && kmAvg !== null ? clamp(((kmAvg - target.mileageKm) / 10_000) * 0.012, -0.08, 0.06) : 0;
  const price = round100(base * (1 + adjust));
  const n = active.length + sales.length;
  const confidence = Math.min(95, 30 + 8 * n);
  const saleDays = sales.flatMap(sale => (sale.days !== null ? [sale.days] : []));
  const baseDays = saleDays.length ? Math.round(avg(saleDays)!) : null;
  const diff = target.price !== undefined ? (target.price - price) / price : null;
  const days = baseDays === null ? null : Math.round(baseDays * (diff !== null && diff > 0.03 ? 1.4 : diff !== null && diff < -0.02 ? 0.75 : 1));
  return {
    vehicleId: target.id ?? null,
    title: target.title,
    price,
    current: target.price ?? null,
    diff,
    listings: { count: active.length, avg: avgActive === null ? null : Math.round(avgActive) },
    sales: { count: sales.length, avg: avgSales === null ? null : Math.round(avgSales) },
    confidence,
    level: confidence >= 75 ? 'alta' : confidence >= 50 ? 'media' : 'baja',
    baseDays,
    days,
  };
}

const suggestOwned = (owned: Owned) =>
  suggest({ make: owned.row.make, model: owned.row.model, year: owned.row.year, mileageKm: owned.row.mileageKm, id: owned.row.id, price: owned.item.price, title: owned.item.title });

function gauge(s: DealerSuggestionDTO): DealerCopilotBlockDTO {
  const diff = s.diff;
  const [verdict, tone] = diff === null || s.level === 'baja' ? ['Precio sugerido', 'neutral'] : diff > 0.03 ? ['Arriba del cierre', 'warn'] : diff < -0.03 ? ['Barato', 'warn'] : ['En el punto', 'good'];
  return {
    type: 'gauge',
    title: s.title,
    subtitle: `Confianza ${s.level} · ${s.listings.count + s.sales.count === 1 ? '1 dato' : `${s.listings.count + s.sales.count} datos`}`,
    verdict,
    tone: tone as 'good' | 'warn' | 'neutral',
    scale: { min: s.price * 0.8, max: s.price * 1.2 },
    band: { low: round100(s.price * 0.96), high: round100(s.price * 1.04) },
    price: s.current ?? s.price,
    rows: [
      { label: 'Sugerido', value: usd(s.price) },
      { label: `Anuncios parecidos (${s.listings.count})`, value: s.listings.avg !== null ? usd(s.listings.avg) : 'Sin datos' },
      { label: `Ventas cerradas (${s.sales.count})`, value: s.sales.avg !== null ? usd(s.sales.avg) : 'Sin datos' },
      { label: 'Días estimados para vender', value: s.days !== null ? `${s.days} días` : 'Sin ventas para estimar' },
    ],
  };
}

const sourceNote = (s: DealerSuggestionDTO) =>
  note(`Basado en ${s.listings.count} ${s.listings.count === 1 ? 'anuncio' : 'anuncios'} y ${s.sales.count} ${s.sales.count === 1 ? 'venta' : 'ventas'} de AutoMarket (año ±1, último año) · se recalcula con cada dato nuevo`);

// ── Resumen del costado: inventario, cifras, feed real y precio sugerido ────

export const dealerCopilot = {
  async overview(userId: string, vehicleId?: string): Promise<DealerCopilotOverviewDTO> {
    const dealer = await dealerOf(userId);
    const owned = await inventory(userId);
    const country = dealer.country;
    const since90 = new Date(Date.now() - 90 * DAY_MS);
    const since7 = new Date(Date.now() - 7 * DAY_MS);
    const [listings, sales, contacts, newListings, recentContacts] = await Promise.all([
      prisma.vehicle.count({ where: { deletedAt: null, status: 'PUBLISHED', ...(country && { country }) } }),
      closedSales(country ? { country } : {}, since90),
      prisma.conversation.count({ where: { sellerId: userId, createdAt: { gte: since7 } } }),
      prisma.vehicle.findMany({ where: { deletedAt: null, status: 'PUBLISHED', sellerId: { not: userId }, publishedAt: { gte: since7 }, ...(country && { country }) }, orderBy: { publishedAt: 'desc' }, take: 6, select: { make: true, model: true, version: true, year: true, mileageKm: true, price: true, city: true, publishedAt: true } }),
      prisma.conversation.findMany({ where: { sellerId: userId, createdAt: { gte: since7 } }, orderBy: { createdAt: 'desc' }, take: 6, select: { createdAt: true, buyer: { select: { name: true } }, vehicle: { select: { make: true, model: true, year: true } } } }),
    ]);
    const feed: DealerCopilotEventDTO[] = [
      ...newListings.map(v => ({ type: 'listing' as const, text: `Nuevo anuncio: ${titleOf(v)} · ${kmText(v.mileageKm)} · ${usd(Number(v.price))} en ${v.city}`, at: v.publishedAt!.toISOString() })),
      ...sales.filter(sale => sale.at >= since7).slice(0, 6).map(sale => ({ type: 'sale' as const, text: `Venta cerrada: ${titleOf(sale.vehicle)} en ${usd(sale.price)}${sale.days ? ` en ${sale.days} días` : ''}`, at: sale.at.toISOString() })),
      ...recentContacts.map(c => ({ type: 'contact' as const, text: `${firstName(c.buyer.name)} te escribió por tu ${c.vehicle.make} ${c.vehicle.model} ${c.vehicle.year}`, at: c.createdAt.toISOString() })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 6);
    const selected = owned.find(entry => entry.row.id === vehicleId) ?? owned[0];
    return {
      dealer: { name: dealer.display, city: dealer.city, country: dealer.country },
      inventory: owned.map(entry => entry.item),
      counts: { listings, sales: sales.length, contacts },
      feed,
      suggestion: selected ? await suggestOwned(selected) : null,
    };
  },

  async ask(userId: string, input: DealerCopilotAskInput): Promise<DealerCopilotReplyDTO> {
    const dealer = await dealerOf(userId);
    const owned = await inventory(userId);
    const menu = await menuChips(userId, owned);
    if (input.action === 'start' || !input.text) {
      const first = owned[0];
      const stock = owned.length ? `**${owned.length} ${owned.length === 1 ? 'auto activo' : 'autos activos'}**` : '**ningún auto activo** todavía';
      return {
        blocks: [
          text(
            withCta(
              `${dealer.display.replace(/\.$/, '')} tiene ${stock} en AutoMarket. Con los anuncios, las ventas cerradas y los contactos reales te ayudo a:\n- Ponerle precio a cada auto.\n- Ver qué conviene traer.\n- Entender por qué uno no se vende.\n- Armar descripciones y responder ofertas.\nLas cifras se recalculan con cada dato nuevo.`,
              first ? `¿Empezamos con el precio del ${first.row.model} ${first.row.year}?` : '¿Te muestro qué autos conviene traer?',
            ),
          ),
        ],
        chips: menu,
        vehicleId: null,
      };
    }
    const vocab = await vocabulary();
    const e = smartParse(input.text, vocab);
    const q = e.q;
    const modelKey = e.models[0];
    const model = modelKey ? vocab.models[modelKey] : undefined;
    // El auto de la agencia: por modelo (y año si lo dijo); si no, el de la conversación anterior.
    const byModel = model ? owned.filter(entry => normalizeText(entry.row.model) === normalizeText(model.label)) : [];
    const mine = (e.year ? byModel.find(entry => entry.row.year === e.year) : undefined) ?? byModel[0] ?? (!model ? owned.find(entry => entry.row.id === input.vehicleId) : undefined);
    /** Respuesta con su siguiente paso: `next.chip` va primero; sin chip, el paso es una instrucción. */
    const turn = (blocks: DealerCopilotBlockDTO[], vehicleId: string | null = mine?.row.id ?? null, next?: { cta: string; chip?: CopilotChipDTO }): DealerCopilotReplyDTO => ({
      blocks: closeWith(blocks, next?.cta ?? null),
      chips: next?.chip ? [next.chip, ...menu.filter(item => item.label !== next.chip!.label)].slice(0, 6) : menu,
      vehicleId,
    });
    const priceChip = (entry: Owned) => say(`¿A cuánto pongo el ${entry.row.model} ${entry.row.year}?`);

    // Dudas de la cuenta y de AutoMarket (verificación, destacar, planes, pagos…), con las reglas reales.
    const topic = matchHelp(input.text, Boolean(model));
    if (topic) {
      const reply = helpAnswer(topic, { plans: await listPlans(), settings: await getSettings() }, DEALER_CTA);
      return { blocks: [text(withCta(reply.text, reply.cta))], chips: [...reply.chips, ...menu].slice(0, 6), vehicleId: input.vehicleId ?? null };
    }

    if (/(respond|contest|oferta|ofrece|que le digo|le respondo|contraoferta)/.test(q)) {
      const reply = await replies(userId, q, owned);
      return turn(reply.blocks, mine?.row.id ?? null, reply.to ? { cta: `Copia la respuesta que prefieras y pégala en el chat con ${reply.to}.` } : { cta: DEALER_CTA });
    }
    if (/(comprar|conviene tener|que autos|demanda|buscan|rotan|surtir|traer|que traigo|piden)/.test(q)) {
      const first = owned[0];
      return turn(await demand(dealer), null, first ? { cta: `¿Te calculo el precio del ${first.row.model} ${first.row.year}?`, chip: priceChip(first) } : { cta: '¿Publicamos tu primer auto?', chip: NEW_LISTING });
    }
    if (/(descrip|redact|escribe|texto del anuncio)/.test(q)) {
      const target = mine ?? owned.find(entry => !entry.row.description || entry.row.description.length < 60) ?? owned[0];
      return target
        ? turn(describeOwned(target), target.row.id, { cta: '¿Abrimos Mis anuncios para pegarla?', chip: MY_LISTINGS })
        : turn([text('Todavía no tienes autos publicados. Cuando publiques uno, te armo su descripción.')], null, { cta: '¿Publicamos tu primer auto?', chip: NEW_LISTING });
    }
    if (/(no se vende|por que no|vende lento|estancad|no me escriben|no sale|no lo compran)/.test(q)) {
      const target = mine ?? worst(owned);
      return target
        ? turn(await diagnose(target, owned), target.row.id, { cta: '¿Lo ajustamos en Mis anuncios?', chip: MY_LISTINGS })
        : turn([text('No tienes autos publicados para revisar.')], null, { cta: '¿Publicamos tu primer auto?', chip: NEW_LISTING });
    }
    if (/(cuanto tarda|cuantos dias|que tan rapido|tiempo en vender|en cuanto se vende)/.test(q) && (model || mine)) {
      const make = mine?.row.make ?? model!.make;
      const label = mine?.row.model ?? model!.label;
      const year = e.year ?? mine?.row.year ?? null;
      const sales = await closedSales({ make, model: label, ...(year && { year: { gte: year - 1, lte: year + 1 } }) }, new Date(Date.now() - SALES_WINDOW_DAYS * DAY_MS));
      const days = sales.flatMap(sale => (sale.days !== null ? [sale.days] : []));
      const priceNext = mine ? { cta: `¿Te calculo el precio del ${mine.row.model} ${mine.row.year}?`, chip: priceChip(mine) } : { cta: DEALER_CTA };
      return turn(
        [
          text(
            days.length
              ? `Un ${make} ${label}${year ? ` de ${year - 1} a ${year + 1}` : ''} se vendió en unos **${Math.round(avg(days)!)} días** en promedio, según ${days.length} ${days.length === 1 ? 'venta registrada' : 'ventas registradas'} en AutoMarket. Con precio justo y buenas fotos suele ser menos.`
              : `Todavía no hay ventas registradas de ${make} ${label}${year ? ` de ${year - 1} a ${year + 1}` : ''} en AutoMarket para calcular cuánto tarda.`,
          ),
        ],
        mine?.row.id ?? null,
        priceNext,
      );
    }
    if (/(aprend|que sabes|que datos|de donde sacas|como funciona el copiloto|como calculas)/.test(q)) {
      const country = dealer.country;
      const [listings, sales, contacts] = await Promise.all([
        prisma.vehicle.count({ where: { deletedAt: null, status: 'PUBLISHED', ...(country && { country }) } }),
        closedSales(country ? { country } : {}, new Date(Date.now() - 90 * DAY_MS)),
        prisma.conversation.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * DAY_MS) }, vehicle: country ? { country } : {} } }),
      ]);
      return turn(
        [
          text(
            `No uso inteligencia artificial: cada vez que preguntas, recalculo con los datos de AutoMarket.\n- **Anuncios**: cómo se mueve la oferta.\n- **Ventas cerradas**: el precio real.\n- **Contactos**: qué quiere la gente.\nHoy hay **${listings} ${listings === 1 ? 'anuncio activo' : 'anuncios activos'}**, **${sales.length} ${sales.length === 1 ? 'venta cerrada' : 'ventas cerradas'}** en 90 días y **${contacts} ${contacts === 1 ? 'contacto' : 'contactos'}** esta semana${country ? ` en ${countryName(country)}` : ''}.`,
          ),
        ],
        mine?.row.id ?? null,
        { cta: DEALER_CTA },
      );
    }
    if ((model || mine) && (e.isFair || e.isSell || /(precio|cuanto|a como|pongo|vale|valor|tasa)/.test(q))) {
      if (mine) {
        const s = await suggestOwned(mine);
        if (!s) return turn([text(`No hay ${mine.row.make} ${mine.row.model} parecidos (año ±1) ni ventas cerradas para calcular su precio.`)], mine.row.id, { cta: '¿Te armo su descripción?', chip: say(`Escríbeme la descripción del ${mine.row.model}`) });
        const d = Math.round((s.diff ?? 0) * 100);
        const off = s.diff !== null && Math.abs(s.diff) > 0.03;
        const close =
          s.diff !== null && s.diff > 0.03
            ? `Lo tienes en **${usd(s.current!)}**: **${d} % arriba**.${s.days !== null ? ` A ese precio calculo unos **${s.days} días** para venderlo.` : ''}`
            : s.diff !== null && s.diff < -0.03
              ? `Lo tienes en **${usd(s.current!)}**: **${Math.abs(d)} % abajo**. Podrías subirlo un poco sin salirte del mercado.`
              : `Tu precio de **${usd(s.current!)}** está bien.${s.days !== null ? ` Calculo unos **${s.days} días** para venderlo.` : ''}`;
        return turn(
          [text(`Te sugiero **${usd(s.price)}** para tu ${s.title}. ${mixText(s)} Confianza **${s.level}**.`), gauge(s), text(close), sourceNote(s)],
          mine.row.id,
          off ? { cta: `¿Lo dejamos en ${usd(s.price)} desde Mis anuncios?`, chip: MY_LISTINGS } : { cta: `¿Te armo la descripción del ${mine.row.model}?`, chip: say(`Escríbeme la descripción del ${mine.row.model}`) },
        );
      }
      const year = e.year ?? new Date().getFullYear() - 4;
      const s = await suggest({ make: model!.make, model: model!.label, year, mileageKm: e.km, title: `${model!.make} ${model!.label} ${year}` });
      if (!s) return turn([text(`No hay ${model!.make} ${model!.label} de ${year - 1} a ${year + 1} publicados ni vendidos para calcular un precio.`)], null, { cta: DEALER_CTA });
      const publish = go(`Publicar con ${usd(s.price)}`, `/cuenta/anuncios/nuevo?${new URLSearchParams({ marca: model!.make, modelo: model!.label, anio: String(year), precio: String(Math.round(s.price)), ...(e.km !== null && { km: String(Math.round(e.km)) }) })}`);
      return turn(
        [text(`Un ${s.title} se puede publicar cerca de **${usd(s.price)}**. ${mixText(s)} Confianza **${s.level}**.${e.year ? '' : ` (No me dijiste el año: tomé ${year}.)`}`), gauge(s), text('Publícalo cerca de ese número y ajusta en una semana según los contactos.'), sourceNote(s)],
        null,
        { cta: `¿Lo publicamos en ${usd(s.price)}?`, chip: publish },
      );
    }
    // Planes de concesionario con los precios del panel.
    if (!model && /(plan|planes|membresia|suscripcion)/.test(q)) {
      const plans = (await listPlans()).filter(plan => plan.accountType === 'DEALER');
      const rate = (value: number) => `${String(Math.round(value * 1000) / 10).replace('.', ',')} %`;
      const lines = plans.map(plan => `- **${plan.name}**: ${usdPrice(plan.priceMonthly)} al mes · ${plan.maxActiveListings === null ? 'sin límite de anuncios' : `${plan.maxActiveListings} anuncios`}${plan.listingDurationDays ? ` por ${plan.listingDurationDays} días` : ''} · comisión de ${rate(plan.commissionRate)}`);
      return turn([text(`Planes para concesionarios:\n${lines.join('\n')}\nSe pagan con Binance en USDT, por mes o por año.`)], null, { cta: '¿Revisamos tu plan?', chip: go('Ver mi plan', '/cuenta/plan') });
    }
    // Pide un precio pero el modelo no está entre los anuncios: se pide solo ese dato, bien escrito.
    if (!model && !mine && /(precio|cuanto|a como|pongo|vale|valor|tasa)/.test(q) && !/(plan|comision|destac|membres|binance|pago|cobra)/.test(q)) {
      return turn([text('No encontré ese modelo entre los anuncios de AutoMarket. Escribe la marca, el modelo y el año como salen en el catálogo, por ejemplo «¿a cuánto pongo el Sportage 2020?».')], null);
    }
    // Ninguna regla encaja: los Términos y políticas publicados y, si tampoco, se dice.
    const terms = searchTerms(input.text, (await getSettings()).termsContent);
    if (terms) return { blocks: [text(withCta(terms.text, terms.cta))], chips: [...terms.chips, ...menu].slice(0, 6), vehicleId: input.vehicleId ?? null };
    return {
      blocks: [
        text(
          withCta(
            'Eso no lo sé responder. Con tus autos te ayudo con:\n- El precio de cada uno.\n- Qué conviene traer.\n- Descripciones y respuestas a ofertas.\n- Por qué uno no se vende.\nPor ejemplo: «¿a cuánto pongo el Sportage 2020?». Si es otra cosa, escríbele al equipo desde «Contacto».',
            'Elige una de las preguntas de abajo o escríbeme otra.',
          ),
        ),
      ],
      chips: [...menu, go('Escribir al equipo', '/#contacto')].slice(0, 6),
      vehicleId: input.vehicleId ?? null,
    };
  },
};

const mixText = (s: DealerSuggestionDTO) =>
  `Mezclo ${s.listings.count} ${s.listings.count === 1 ? 'anuncio activo' : 'anuncios activos'}${s.listings.avg !== null ? ` (promedio ${usd(s.listings.avg)})` : ''} con ${s.sales.count} ${s.sales.count === 1 ? 'venta cerrada' : 'ventas cerradas'}${s.sales.avg !== null ? ` (cerraron en ${usd(s.sales.avg)})` : ''}.`;

/** El auto que peor va: más días publicado y menos contactos por vista. */
function worst(owned: Owned[]) {
  return [...owned].sort((a, b) => b.item.days - a.item.days || a.item.contacts / Math.max(1, a.item.views) - b.item.contacts / Math.max(1, b.item.views))[0];
}

async function menuChips(userId: string, owned: Owned[]): Promise<CopilotChipDTO[]> {
  const first = owned[0];
  const slow = worst(owned);
  const lastChat = await prisma.conversation.findFirst({ where: { sellerId: userId, lastMessageAt: { not: null } }, orderBy: { lastMessageAt: 'desc' }, select: { buyer: { select: { name: true } } } });
  return [
    ...(first ? [say(`¿A cuánto pongo el ${first.row.model} ${first.row.year}?`)] : []),
    say('¿Qué autos me conviene traer?'),
    ...(slow ? [say(`¿Por qué el ${slow.row.model} no se vende?`)] : []),
    ...(first ? [say(`Escríbeme la descripción del ${(slow ?? first).row.model}`)] : []),
    ...(lastChat ? [say(`¿Cómo le respondo a ${firstName(lastChat.buyer.name)}?`)] : []),
  ];
}

function describeOwned(target: Owned): DealerCopilotBlockDTO[] {
  const v = target.row;
  const parts = [`${titleOf(v)}, ${v.condition === 'NEW' ? '0 km' : kmText(v.mileageKm)}, caja ${v.transmission === 'MANUAL' ? 'sincrónica' : 'automática'}`];
  let body = `${parts.join(', ')}.`;
  if (v.condition !== 'NEW') body += v.ownersCount === 1 ? ' Un solo dueño.' : v.ownersCount === 2 ? ' Dos dueños.' : ' Tres dueños o más.';
  body += ` Motor a ${FUEL_LABELS[v.fuelType].toLowerCase()}${v.drivetrain ? `, tracción ${DRIVETRAIN_LABELS[v.drivetrain].toLowerCase()}` : ''}.`;
  if (v.exteriorColor) body += ` Color ${v.exteriorColor.toLowerCase()}.`;
  body += ` Lo puedes ver en ${v.city} con cita. Apártalo con abono desde la app: se descuenta del precio.`;
  const missing = Math.max(0, SUGGESTED_PHOTOS - target.item.photos);
  return [
    text(`Descripción para tu **${target.item.title}**, solo con los datos del anuncio. Cópiala y agrégale lo que sepas tú (mantenimiento, extras, estado):`),
    { type: 'quote', text: body },
    note(
      missing > 0
        ? `Tiene ${target.item.photos} de ${MAX_VEHICLE_MEDIA} fotos posibles. Faltan ${missing} de los ángulos que pide Publicar: frente, lado, atrás, interior, tablero encendido y motor.`
        : `Tiene ${target.item.photos} fotos: ya cubre los ángulos que más miran los compradores.`,
    ),
  ];
}

async function diagnose(target: Owned, owned: Owned[]): Promise<DealerCopilotBlockDTO[]> {
  const s = await suggestOwned(target);
  const reasons: string[] = [];
  if (s && s.diff !== null && s.diff > 0.03 && s.level !== 'baja') reasons.push(`está **${Math.round(s.diff * 100)} % arriba** del precio sugerido (${usd(s.price)})`);
  if (target.item.photos < SUGGESTED_PHOTOS) reasons.push(`tiene ${target.item.photos} ${target.item.photos === 1 ? 'foto' : 'fotos'}; Publicar pide al menos ${SUGGESTED_PHOTOS} (frente, lado, atrás, interior, tablero y motor)`);
  if (target.item.days > STALE_DAYS) reasons.push(`lleva ${target.item.days} días publicado`);
  const rate = target.item.views ? (target.item.contacts / target.item.views) * 100 : null;
  const totalViews = owned.reduce((n, entry) => n + entry.item.views, 0);
  const totalContacts = owned.reduce((n, entry) => n + entry.item.contacts, 0);
  const mean = totalViews ? (totalContacts / totalViews) * 100 : null;
  if (rate !== null && mean !== null && owned.length > 1 && rate < mean * 0.6) reasons.push(`le escriben menos que a tus otros autos`);
  const rateText =
    rate === null
      ? 'Todavía no tiene vistas registradas.'
      : `De cada 100 personas que lo ven, ${String(Math.round(rate * 10) / 10).replace('.', ',')} te escriben${mean !== null && owned.length > 1 ? ` (en tus otros autos, ${String(Math.round(mean * 10) / 10).replace('.', ',')})` : ''}.`;
  const blocks: DealerCopilotBlockDTO[] = [
    text(reasons.length ? `Tu **${target.item.title}**:\n${reasons.map(reason => `- ${cap(reason)}.`).join('\n')}\n${rateText}` : `Tu **${target.item.title}** está bien de precio y de fotos. ${rateText}`),
  ];
  if (s) {
    blocks.push(gauge(s));
    const fix = [s.diff !== null && s.diff > 0.03 ? `déjalo en ${usd(s.price)}` : null, target.item.photos < SUGGESTED_PHOTOS ? 'sube las fotos que faltan' : null].filter(Boolean).join(' y ');
    if (fix) blocks.push(text(`Para moverlo: ${fix}.${s.baseDays !== null ? ` Los parecidos se vendieron en unos **${s.baseDays} días**.` : ''} También puedes destacarlo desde Mis anuncios.`));
    blocks.push(sourceNote(s));
  }
  return blocks;
}

/** Demanda por tipo de auto en la ciudad (o el país) de la agencia: vistas y contactos de 30 días contra lo publicado. */
async function demand(dealer: Dealer): Promise<DealerCopilotBlockDTO[]> {
  const since = new Date(Date.now() - 30 * DAY_MS);
  const sinceDay = new Date(since.toISOString().slice(0, 10));
  const scope = async (where: { city?: string; country?: string }) => {
    const vehicles = { deletedAt: null, ...where } satisfies Prisma.VehicleWhereInput;
    const [listed, viewRows, contactRows] = await Promise.all([
      prisma.vehicle.groupBy({ by: ['category', 'transmission'], where: { ...vehicles, status: 'PUBLISHED' }, _count: { _all: true } }),
      prisma.vehicleViewDay.findMany({ where: { day: { gte: sinceDay }, vehicle: vehicles }, select: { views: true, vehicle: { select: { category: true, transmission: true } } } }),
      prisma.conversation.findMany({ where: { createdAt: { gte: since }, vehicle: vehicles }, select: { vehicle: { select: { category: true, transmission: true } } } }),
    ]);
    const key = (v: { category: string; transmission: string }) => `${v.category}|${v.transmission === 'MANUAL' ? 'M' : 'A'}`;
    const rows = new Map<string, { views: number; contacts: number; listings: number }>();
    const get = (k: string) => rows.get(k) ?? rows.set(k, { views: 0, contacts: 0, listings: 0 }).get(k)!;
    for (const row of listed) get(key(row)).listings += row._count._all;
    for (const row of viewRows) get(key(row.vehicle)).views += row.views;
    for (const row of contactRows) get(key(row.vehicle)).contacts += 1;
    return rows;
  };
  let place = dealer.city ?? (dealer.country ? countryName(dealer.country) : 'AutoMarket');
  let rows = dealer.city ? await scope({ city: dealer.city }) : new Map();
  const total = (map: Map<string, { contacts: number; views: number }>) => [...map.values()].reduce((n, row) => n + row.contacts + row.views, 0);
  if (total(rows) < 10 && dealer.country) {
    rows = await scope({ country: dealer.country });
    place = countryName(dealer.country);
  }
  const list = [...rows.entries()]
    .filter(([, row]) => row.views + row.contacts > 0)
    .map(([k, row]) => {
      const [category, gear] = k.split('|') as [string, 'A' | 'M'];
      const noun = CATEGORY_PLURAL[category] ?? category;
      const segment = `${noun} ${gear === 'A' ? (FEM.has(category) ? 'automáticas' : 'automáticos') : FEM.has(category) ? 'sincrónicas' : 'sincrónicos'}`;
      return { segment, ...row, ratio: (row.contacts * 10 + row.views) / Math.max(1, row.listings) };
    })
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 6);
  if (!list.length) return [text(`Todavía no hay vistas ni contactos registrados en ${place} en los últimos 30 días para medir la demanda.`)];
  const ratios = list.map(row => row.ratio).sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)]!;
  const top = list[0]!;
  return [
    text(
      `En ${place}, en los últimos 30 días, lo que más se pide para lo que hay publicado son **${top.segment.toLowerCase()}**: ${top.contacts} ${top.contacts === 1 ? 'contacto' : 'contactos'} y ${top.views} vistas para ${top.listings} ${top.listings === 1 ? 'auto publicado' : 'autos publicados'}. Si consigues uno a buen precio, debería moverse rápido.`,
    ),
    { type: 'demand', title: `Lo que piden en ${place}`, rows: list.map(row => ({ segment: row.segment, views: row.views, contacts: row.contacts, listings: row.listings, tag: row.ratio >= median * 1.5 ? 'high' : row.ratio <= median * 0.6 ? 'low' : 'normal' })) },
    note('Contactos = conversaciones que abren los compradores; vistas = personas distintas por día. AutoMarket no guarda lo que se escribe en el buscador.'),
  ];
}

/** Respuestas a una oferta que llegó por el chat: la conversación que nombra o la más reciente con un monto. */
async function replies(userId: string, q: string, owned: Owned[]): Promise<{ blocks: DealerCopilotBlockDTO[]; to: string | null }> {
  const conversations = await prisma.conversation.findMany({
    where: { sellerId: userId, lastMessageAt: { not: null } },
    orderBy: { lastMessageAt: 'desc' },
    take: 20,
    select: {
      id: true,
      buyerId: true,
      buyer: { select: { name: true } },
      vehicle: { select: { id: true, make: true, model: true, version: true, year: true, mileageKm: true, price: true } },
      messages: { where: { deletedAt: null, type: 'TEXT' }, orderBy: { createdAt: 'desc' }, take: 10, select: { senderId: true, body: true } },
    },
  });
  if (!conversations.length) return { blocks: [text('Todavía no tienes conversaciones con compradores. Cuando alguien te escriba por un auto, te propongo cómo responderle.')], to: null };
  const amountOf = (body: string | null) => {
    const m = /(\d{1,3}(?:[.,]\d{3})+|\d{4,6})(?!\s*km)|(\d+(?:[.,]\d+)?)\s*(mil|k|lucas)\b/i.exec(body ?? '');
    if (!m) return null;
    const value = m[3] ? parseFloat(m[2]!.replace(',', '.')) * 1000 : Number(m[1]!.replace(/[.,]/g, ''));
    return value >= 1000 && value <= 5_000_000 ? value : null;
  };
  const withOffer = conversations.map(c => {
    const fromBuyer = c.messages.filter(m => m.senderId === c.buyerId);
    const offer = fromBuyer.map(m => amountOf(m.body)).find((value): value is number => value !== null && !(value >= 1990 && value <= 2035)) ?? null;
    return { c, offer };
  });
  const named = withOffer.find(({ c }) => q.includes(` ${normalizeText(firstName(c.buyer.name))} `) || q.includes(` ${normalizeText(firstName(c.buyer.name))}?`));
  const pick = named ?? withOffer.find(entry => entry.offer !== null) ?? withOffer[0]!;
  const { c, offer } = pick;
  const name = firstName(c.buyer.name);
  const ownedVehicle = owned.find(entry => entry.row.id === c.vehicle.id);
  const s = ownedVehicle ? await suggestOwned(ownedVehicle) : await suggest({ make: c.vehicle.make, model: c.vehicle.model, year: c.vehicle.year, mileageKm: c.vehicle.mileageKm, id: c.vehicle.id, price: Number(c.vehicle.price), title: titleOf(c.vehicle) });
  const listPrice = Number(c.vehicle.price);
  const car = `${c.vehicle.model} ${c.vehicle.year}`;
  if (offer === null) {
    const blocks: DealerCopilotBlockDTO[] = [
      text(`En tu conversación con ${name} por el ${car} no encontré una oferta con monto. Estas respuestas mantienen tu precio de **${usd(listPrice)}**${s ? ` (el sugerido es ${usd(s.price)})` : ''}:`),
      {
        type: 'replies',
        to: name,
        conversationId: c.id,
        items: [
          { tone: 'Invitar a verlo', text: `Hola ${name}, gracias por escribir. El ${car} está disponible en ${usd(listPrice)}. ¿Quieres venir a verlo esta semana? Te muestro los papeles y lo pruebas.` },
          { tone: 'Pedir su oferta', text: `Hola ${name}, ¿qué precio tenías en mente para el ${car}? Si me dices, lo conversamos.` },
          { tone: 'Reservar', text: `Hola ${name}, si te interesa, puedes apartar el ${car} con el abono desde la app: se descuenta del precio y nadie más lo reserva mientras tanto.` },
        ],
      },
    ];
    return { blocks, to: name };
  }
  const reference = s?.price ?? listPrice;
  const counter = Math.max(offer, round100((reference + offer) / 2));
  const blocks: DealerCopilotBlockDTO[] = [
    text(`${name} ofrece **${usd(offer)}** por tu ${car}, que tienes en **${usd(listPrice)}**.${s ? ` El precio sugerido para parecidos es ${usd(s.price)} (confianza ${s.level}).` : ''} Tres respuestas para elegir:`),
    {
      type: 'replies',
      to: name,
      conversationId: c.id,
      items: [
        { tone: 'Cerrar rápido', text: `Hola ${name}, gracias por la oferta. Te lo dejo en ${usd(counter)} si lo reservas esta semana; el abono se descuenta del precio.` },
        { tone: 'Mantener precio', text: `Hola ${name}, el precio está en línea con el mercado${s ? ` (${usd(s.price)} para parecidos)` : ''}. ¿Quieres venir a verlo y lo conversamos?` },
        { tone: 'Aceptar', text: `Hola ${name}, aceptamos ${usd(offer)}. Apártalo con el abono desde la app para dejarlo a tu nombre.` },
      ],
    },
    ...(s ? [sourceNote(s)] : []),
  ];
  return { blocks, to: name };
}
