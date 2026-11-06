import { countryName, type AdminCopilotDTO, type ReportCaseReason } from '@automarket/contracts';
import { cap, int, money, monthLong, monthShort, type TabKey } from './stats-views';

/**
 * Motor del Copiloto del admin: entiende la pregunta con reglas (sin modelo de lenguaje) y arma la
 * respuesta solo con los datos reales de `AdminCopilotDTO`. Si un dato no existe, lo dice; nunca
 * rellena con cifras de ejemplo. No cambia nada: lleva a la pantalla donde se decide.
 */

export type Tone = 'danger' | 'warn' | 'good' | 'purple';
export type Download = { kind: 'all' } | { kind: 'tab'; tab: TabKey; label: string } | { kind: 'compare'; a: number; b: number };
export type Action = { type: 'ask'; label: string; ask: string } | { type: 'go'; label: string; href: string } | { type: 'download'; label: string; download: Download };
export type Bar = { label: string; value: number; text: string; fill: 'marked' | 'normal' | 'current' | 'projected' };
export type Piece =
  | { t: 'note'; text: string }
  | { t: 'text'; text: string }
  | { t: 'kpis'; items: Array<{ label: string; value: string }> }
  | { t: 'bars'; items: Bar[] }
  | { t: 'table'; cols: string; head: string[]; rows: string[][] }
  | { t: 'list'; items: Array<{ tone: Tone; title: string; text: string; link?: { label: string; href: string } }> }
  | { t: 'actions'; items: Action[] };
export type Intent =
  | 'reports' | 'kyc' | 'payments' | 'export' | 'projection' | 'odd' | 'ideas' | 'summary' | 'dealers' | 'brands' | 'cities' | 'countries'
  | 'plans' | 'revenue' | 'reservations' | 'days' | 'avgPrice' | 'listings' | 'users' | 'sales' | 'compare';
export interface Context {
  intent: Intent | null;
  month: number | null;
}
export interface Reply {
  pieces: Piece[];
  context: Context;
  download?: Download;
}

// ───────────────────────────────────────────────────────────── Formato ──

/** Dinero en USDT: con céntimos si los tiene y es menor que mil («$9,99»). */
export const usd = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) || Math.abs(rounded) >= 1000 ? money(rounded) : `$${rounded.toFixed(2).replace('.', ',')}`;
};
const plural = (n: number, one: string, many: string) => `${int(n)} ${n === 1 ? one : many}`;
const share = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)} %` : '—');
const joinAnd = (items: string[]) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`);
const signed = (p: number) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} %`;
const growth = (current: number, previous: number) => (previous > 0 ? Math.round((current / previous - 1) * 100) : null);
const PLAN_SHORT: Record<string, string> = { FREE: 'Gratis', PREMIUM: 'Premium', DEALER_BASIC: 'Básico', DEALER_PRO: 'Pro' };
const REASON_TEXT: Record<ReportCaseReason, [string, string]> = {
  FRAUD: ['de posible fraude', 'de posible fraude'],
  OFFENSIVE: ['por lenguaje ofensivo', 'por lenguaje ofensivo'],
  WRONG_INFO: ['por datos incorrectos', 'por datos incorrectos'],
  SPAM: ['de spam o duplicados', 'de spam o duplicados'],
  OTHER: ['por otro motivo', 'por otros motivos'],
};

// ──────────────────────────────────────────────────── Lectura de la pregunta ──

const norm = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const VOCAB = [
  'ventas', 'venta', 'vendidos', 'vendido', 'vendio', 'vendimos', 'ingresos', 'ingreso', 'ganancias', 'ganancia', 'ganamos', 'dinero', 'facturacion',
  'comision', 'comisiones', 'cobros', 'usuarios', 'registros', 'cuentas', 'verificados', 'verificadas', 'gente', 'concesionarios', 'concesionario',
  'agencias', 'agencia', 'aliados', 'dealers', 'planes', 'premium', 'membresias', 'suscripciones', 'reservas', 'reserva', 'abonos', 'abono', 'compras',
  'compra', 'canceladas', 'anuncios', 'anuncio', 'inventario', 'publicados', 'marcas', 'marca', 'ciudades', 'ciudad', 'region', 'estados', 'estado',
  'paises', 'pais', 'pronostico', 'proyecta', 'proyeccion', 'proyectar', 'estimacion', 'cerraria', 'compara', 'comparar', 'comparacion', 'contra',
  'frente', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre', 'enero', 'febrero', 'marzo', 'abril', 'mayo',
  'actual', 'curso', 'pasado', 'ultimo', 'anterior', 'antes', 'raro', 'anomalia', 'problemas', 'problema', 'alertas', 'alerta', 'riesgo', 'riesgos',
  'preocupa', 'recomienda', 'recomiendas', 'recomendaciones', 'consejo', 'consejos', 'ideas', 'resumen', 'panorama', 'exportar', 'excel', 'descargar',
  'descarga', 'pendientes', 'pendiente', 'verificar', 'binance', 'pagos', 'pago', 'reportes', 'reporte', 'denuncias', 'fraude', 'estafa', 'precio',
  'precios', 'promedio', 'ticket', 'tiempo', 'dias', 'tarda', 'rapido', 'demora', 'destacados', 'portada', 'pantalla', 'entrada', 'estadisticas',
  'identidad', 'documentos', 'cuanto', 'cuantos', 'mejor', 'total', 'ayuda', 'funciona', 'gracias', 'hola', 'buenas', 'buenos',
];
const COMMON = [
  'como', 'vendo', 'vende', 'venden', 'gano', 'subo', 'mejoro', 'aumento', 'mucho', 'mucha', 'muchos', 'poco', 'donde', 'cual', 'cuales', 'quien',
  'quienes', 'tengo', 'tenemos', 'tiene', 'tienen', 'algo', 'todo', 'todos', 'toda', 'todas', 'esta', 'estan', 'este', 'esto', 'estos', 'estas', 'semana',
  'semanas', 'ayer', 'manana', 'dame', 'dime', 'muestra', 'muestrame', 'quiero', 'saber', 'sobre', 'entre', 'desde', 'hasta', 'vendidas', 'nuevos',
  'nuevas', 'cuesta', 'auto', 'autos', 'carro', 'carros', 'mejores', 'peores', 'hacer', 'hago', 'puedo', 'puedes', 'podrias', 'favor', 'ofrezco',
  'cuanta', 'cuantas', 'venderse', 'vendieron', 'usuario', 'plan', 'mismo', 'otro', 'otra', 'para', 'meses', 'cada', 'menos', 'bien', 'nada', 'sigue',
  'ritmo', 'datos', 'lista', 'tabla', 'grafico', 'solo', 'tambien', 'pero', 'porque', 'segun', 'llego', 'cifra', 'vamos', 'estamos', 'cuando', 'hubo',
  'fueron', 'activos', 'cuenta', 'hace', 'hacen', 'tardan', 'ultimos', 'ultimas', 'cosas', 'hoy', 'ganar', 'vender', 'subir', 'mejorar', 'aumentar',
];

/** Distancia de Damerau-Levenshtein (transposición de vecinas); 9 si los largos difieren en más de 2. */
export function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** Corrige errores al escribir contra el vocabulario del panel (más marcas, ciudades y concesionarios reales). */
export function fixTypos(raw: string, known: Set<string>) {
  const fixes: string[] = [];
  const text = norm(raw).replace(/[a-zñ]{4,}/g, word => {
    if (VOCAB.includes(word) || COMMON.includes(word) || known.has(word)) return word;
    let best: string | null = null;
    let bestDistance = 9;
    for (const candidate of VOCAB) {
      const dd = distance(word, candidate);
      if (dd < bestDistance) {
        bestDistance = dd;
        best = candidate;
      }
    }
    if (best && bestDistance <= (word.length > 6 ? 2 : 1)) {
      fixes.push(`${word} → ${best}`);
      return best;
    }
    return word;
  });
  return { text, fixes };
}

const MONTH_WORDS: Array<[number, RegExp]> = [
  [1, /\b(enero|ene)\b/], [2, /\b(febrero|feb)\b/], [3, /\b(marzo)\b/], [4, /\b(abril|abr)\b/], [5, /\b(mayo)\b/], [6, /\b(junio|jun)\b/],
  [7, /\b(julio|jul)\b/], [8, /\b(agosto|ago)\b/], [9, /\b(septiembre|setiembre|sept?)\b/], [10, /\b(octubre|oct)\b/], [11, /\b(noviembre|nov)\b/], [12, /\b(diciembre|dic)\b/],
];

const INTENTS: Array<[Intent, RegExp]> = [
  ['reports', /reporte|denuncia|fraude|estafa/],
  ['kyc', /\bkyc\b|identidad|documentos? (pendiente|por revisar)/],
  ['payments', /pagos? pendiente|pendientes|por verificar|binance/],
  ['export', /export|excel|descarg|pdf|csv/],
  ['projection', /pronostic|proyecc|proyecta|estim|cuanto vamos|cerraria|va a cerrar/],
  ['odd', /raro|anomal|alerta|problema|riesgo|preocup/],
  ['ideas', /recomien|consejo|que hago|como (vendo|gano|subo|aumento|mejoro)|ideas/],
  ['summary', /resumen|como vamos|panorama|como estamos/],
  ['dealers', /concesionari|agencia|dealer|aliad/],
  ['brands', /marca/],
  ['cities', /ciudad|donde se vend|region|estado/],
  ['countries', /pais/],
  ['plans', /plan|membres|premium|suscrip/],
  ['revenue', /ingreso|ganancia|ganamos|dinero|factur|cobra|comision|revenue/],
  ['reservations', /reserva|abono|compra|cancelad/],
  ['days', /tiempo|cuantos dias|tarda|rapido|demora/],
  ['avgPrice', /precio promedio|promedio|ticket/],
  ['listings', /anuncio|inventario|publicad|carros|autos activos/],
  ['users', /usuario|registr|cuenta|verificad|gente/],
  ['sales', /venta|vendid|vendio|vendimos/],
];

// ─────────────────────────────────────────────────────────── Copiloto ──

export function createCopilot(data: AdminCopilotDTO) {
  const st = data.stats;
  const keys = st.months.map(month => month.key);
  const CUR = keys.length - 1;
  const L = keys.length - 2;
  const s = st.sales.months;
  const pu = st.purchases.months;
  const ca = st.cars.months;
  const us = st.users.months;
  const pl = st.plans.months;
  const known = new Set(
    [
      ...data.months.flatMap(month => [...month.brands, ...month.cities].map(bucket => bucket.label)),
      ...st.dealers.list.flatMap(dealer => [dealer.name, dealer.city ?? '']),
      data.adminName,
    ].flatMap(text => norm(text).split(/[^a-zñ]+/)),
  );

  const long = (i: number) => monthLong(keys[i]!);
  const short = (i: number) => monthShort(keys[i]!);
  const days = st.currentDays;
  /** «octubre» o «noviembre (van 4 días)». */
  const mname = (i: number) => (i === CUR ? `${long(i)} (${days === 1 ? 'va 1 día' : `van ${days} días`})` : long(i));
  const deltaText = (i: number, current: number, previous: number) => {
    if (i === CUR || i === 0) return null;
    const p = growth(current, previous);
    if (p === null) return null;
    return p === 0 ? `igual que en ${long(i - 1)}` : `${p > 0 ? 'sube' : 'baja'} ${Math.abs(p)} % frente a ${long(i - 1)}`;
  };
  const bars = (values: number[], text: (v: number) => string, marked: number, extra?: { label: string; value: number }): Piece => ({
    t: 'bars',
    items: [
      ...values.map((value, i) => ({ label: `${short(i)}${i === CUR ? '*' : ''}`, value, text: text(value), fill: (i === CUR ? 'current' : i === marked ? 'marked' : 'normal') as Bar['fill'] })),
      ...(extra ? [{ label: extra.label, value: extra.value, text: text(extra.value), fill: 'projected' as const }] : []),
    ],
  });
  const ask = (label: string, question = label): Action => ({ type: 'ask', label, ask: question });
  const go = (label: string, href: string): Action => ({ type: 'go', label, href });

  // ── Proyección del mes en curso
  const daysInMonth = (() => {
    const [y, m] = keys[CUR]!.split('-').map(Number) as [number, number];
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  })();
  const pace = (values: number[]) => {
    const ratios: number[] = [];
    for (let i = L; i > L - 3 && i > 0; i--) if (values[i - 1]! > 0 && values[i]! > 0) ratios.push(values[i]! / values[i - 1]!);
    return ratios.length ? ratios.reduce((sum, r) => sum + r, 0) / ratios.length : null;
  };
  const gSales = pace(s.map(m => m.count));
  const gRevenue = pace(pl.map(m => m.total));
  const projection = {
    sales: gSales === null ? null : Math.round(s[L]!.count * gSales),
    revenue: gRevenue === null ? null : Math.round(pl[L]!.total * gRevenue),
    monthly: gSales === null ? null : Math.round((gSales - 1) * 100),
    pace: s[CUR]!.count > 0 ? Math.round((s[CUR]!.count / Math.max(1, days)) * daysInMonth) : null,
  };

  // ── Alertas calculables con datos reales
  const alerts = (): Extract<Piece, { t: 'list' }>['items'] => {
    const list: Extract<Piece, { t: 'list' }>['items'] = [];
    const fraud = data.reports.fraud;
    if (fraud.length) {
      const first = fraud[0]!;
      const market = first.diffPct !== null && first.diffPct < 0 ? `, ${Math.abs(first.diffPct)} % bajo el mercado` : '';
      const people = first.count > 1 ? ` ${first.count} personas lo reportaron.` : '';
      list.push({
        tone: 'danger',
        title: fraud.length === 1 ? '1 reporte de posible fraude abierto' : `${fraud.length} reportes de posible fraude abiertos`,
        text: `${fraud.length === 1 ? 'Es' : 'El más reciente es'} ${first.title}${first.price !== null ? ` a ${money(first.price)}` : ''}${market}.${people}`,
        link: { label: 'Ver reportes', href: '/admin/reportes' },
      });
    }
    const repeated = data.duplicates[0];
    if (repeated) {
      list.push({
        tone: 'warn',
        title: `${repeated.seller} tiene ${repeated.count} anuncios iguales`,
        text: `${repeated.title} con el mismo kilometraje. Puede ser el mismo auto publicado varias veces.`,
        link: { label: 'Revisar', href: '/admin/inventario' },
      });
    }
    if (data.payments.count > 0) {
      list.push({
        tone: 'warn',
        title: data.payments.count === 1 ? '1 pago por verificar' : `${data.payments.count} pagos por verificar`,
        text: `${usd(data.payments.total)} en Binance. Revísalos en tu app de Binance antes de aprobar.`,
        link: { label: 'Ir a Pagos Binance', href: '/admin/pagos' },
      });
    }
    if (data.kyc.pending > 0) {
      list.push({
        tone: 'warn',
        title: data.kyc.pending === 1 ? '1 verificación de identidad pendiente' : `${data.kyc.pending} verificaciones de identidad pendientes`,
        text: 'Mientras no se revisan, esas personas no pueden vender.',
        link: { label: 'Revisar KYC', href: '/admin/kyc' },
      });
    }
    const cancelled = pu[L]!.cancelled;
    const before = pu[L - 1]!.cancelled;
    const up = growth(cancelled, before);
    if (up !== null && up > 0) {
      list.push({ tone: 'warn', title: `Las reservas canceladas subieron ${up} %`, text: `${int(cancelled)} en ${long(L)} contra ${int(before)} en ${long(L - 1)}.` });
    }
    if (data.login.slots > 0 && data.login.used >= data.login.slots) {
      list.push({
        tone: 'good',
        title: 'La pantalla de entrada está llena mañana',
        text: `${data.login.used} de ${data.login.slots} cupos vendidos para mañana. Si hay demanda, puedes subir el precio o los cupos.`,
        link: { label: 'Ver turnos', href: '/admin/pantalla-entrada' },
      });
    }
    const others = data.reports.open - fraud.length;
    if (others > 0) {
      list.push({ tone: 'warn', title: others === 1 ? '1 reporte más abierto' : `${others} reportes más abiertos`, text: 'Lenguaje ofensivo, datos incorrectos, duplicados u otros motivos.', link: { label: 'Abrir reportes', href: '/admin/reportes' } });
    }
    return list;
  };

  // ── Ideas con números de los datos
  const ideas = (): Extract<Piece, { t: 'list' }>['items'] => {
    const list: Extract<Piece, { t: 'list' }>['items'] = [];
    const basic = data.plans.find(plan => plan.code === 'DEALER_BASIC');
    const pro = data.plans.find(plan => plan.code === 'DEALER_PRO');
    if (data.upsell.length && basic && pro) {
      const diff = pro.monthly - basic.monthly;
      const names = data.upsell.map(dealer => dealer.name);
      list.push({
        tone: 'good',
        title: `Ofrece el plan Pro a ${plural(data.upsell.length, 'concesionario', 'concesionarios')} en Básico`,
        text: `${joinAnd(names)} ${names.length === 1 ? 'ya vende' : 'ya venden'} cada semana o ${names.length === 1 ? 'tiene' : 'tienen'} casi lleno su cupo de anuncios. El Pro cuesta ${usd(diff)} más al mes: serían ${usd(diff * names.length)} extra cada mes.`,
        link: { label: 'Ver concesionarios', href: '/admin/usuarios' },
      });
    }
    if (data.home.slots > 0 && data.home.used >= Math.ceil(data.home.slots * 0.8)) {
      list.push({
        tone: 'good',
        title: data.home.used >= data.home.slots ? 'La portada está llena' : 'La portada está casi llena',
        text: `${data.home.used} de ${data.home.slots} cupos ocupados. Si la demanda sigue, puedes subir el precio de Portada.`,
        link: { label: 'Cambiar precio', href: '/admin/planes' },
      });
    }
    if (data.login.slots > 0 && data.login.used >= data.login.slots) {
      list.push({ tone: 'good', title: 'La pantalla de entrada se llenó para mañana', text: `${data.login.used} de ${data.login.slots} cupos vendidos. Puedes subir el precio o los cupos por día.`, link: { label: 'Cambiar precio', href: '/admin/planes' } });
    }
    const { created, verified } = data.verification;
    if (created >= 5 && verified / created < 0.7) {
      list.push({
        tone: 'good',
        title: `El ${Math.round((1 - verified / created) * 100)} % de las cuentas nuevas no se verifica`,
        text: `De ${plural(created, 'cuenta creada', 'cuentas creadas')} en ${long(L)}, ${int(verified)} ya se ${verified === 1 ? 'verificó' : 'verificaron'}. Un recordatorio para verificarse suma vendedores, que son los que compran planes y destacados.`,
      });
    }
    return list;
  };

  const fn: Record<Exclude<Intent, 'compare' | 'export'>, (i: number) => Piece[]> = {
    sales: i => {
      const m = s[i]!;
      const delta = deltaText(i, m.count, s[i - 1]?.count ?? 0);
      const text =
        m.count === 0
          ? `En ${mname(i)} ${i === CUR ? 'todavía no hay' : 'no hubo'} ventas concretadas.`
          : `En ${mname(i)} se ${m.count === 1 ? 'vendió 1 auto' : `vendieron ${int(m.count)} autos`} por ${money(m.value)}.${delta ? ` Eso ${delta}.` : ''} El precio promedio fue ${money(m.value / m.count)}.`;
      return [
        { t: 'text', text },
        bars(s.map(month => month.count), int, i),
        { t: 'actions', items: [ask('¿Qué marcas se vendieron más?', `¿Qué marcas se vendieron más en ${long(i)}?`), { type: 'download', label: 'Descargar ventas', download: { kind: 'tab', tab: 'sales', label: 'ventas' } }] },
      ];
    },
    revenue: i => {
      const m = pl[i]!;
      const delta = deltaText(i, m.total, pl[i - 1]?.total ?? 0);
      const text =
        m.total === 0
          ? `En ${mname(i)} ${i === CUR ? 'todavía no entra' : 'no entró'} dinero: no hay planes, comisiones ni destacados cobrados.`
          : `AutoMarket ingresó ${usd(m.total)} en ${mname(i)}${delta ? `, ${delta}` : ''}. Viene de los planes, la comisión por venta de cada plan, los destacados y la pantalla de entrada.`;
      return [
        { t: 'text', text },
        { t: 'kpis', items: [{ label: 'Planes', value: usd(m.plans) }, { label: 'Comisiones', value: usd(m.commissions) }, { label: 'Destacados', value: usd(m.boosts) }, { label: 'Pantalla de entrada', value: usd(m.login) }] },
        bars(pl.map(month => month.total), usd, i),
        { t: 'actions', items: [ask(`Proyecta ${long(CUR)}`), { type: 'download', label: 'Descargar ingresos', download: { kind: 'tab', tab: 'plans', label: 'ingresos' } }] },
      ];
    },
    users: i => {
      const m = us[i]!;
      const ratio = m.created > 0 && m.verified <= m.created ? ` (${share(m.verified, m.created)})` : '';
      return [
        { t: 'text', text: `En ${mname(i)} se ${m.created === 1 ? 'registró 1 cuenta' : `registraron ${int(m.created)} cuentas`} y se ${m.verified === 1 ? 'verificó 1' : `verificaron ${int(m.verified)}`}${ratio}. Ya son ${int(m.total)} en total.` },
        bars(us.map(month => month.created), int, i),
        { t: 'actions', items: [ask('¿De qué países son?', '¿De qué países son los usuarios?')] },
      ];
    },
    countries: () => {
      const total = data.countries.reduce((sum, row) => sum + row.users, 0);
      const named = data.countries.map(row => ({ ...row, name: row.code ? countryName(row.code) : 'Sin país' }));
      const [first, second] = named;
      const withDealers = named.filter(row => row.dealers > 0 && row.code).map(row => row.name);
      const text = !first
        ? 'Todavía no hay cuentas registradas.'
        : `El ${share(first.users, total)} de las cuentas son de ${first.name}.${second ? ` ${second.name} es el segundo país.` : ''}${withDealers.length ? ` Hay concesionarios aliados en ${joinAnd(withDealers)}.` : ' Todavía no hay concesionarios aliados verificados.'}`;
      return [
        { t: 'text', text },
        { t: 'table', cols: '1.6fr 1fr 1fr', head: ['País', 'Cuentas', 'Concesionarios'], rows: named.slice(0, 8).map(row => [row.name, int(row.users), int(row.dealers)]) },
      ];
    },
    dealers: i => {
      const month = data.months[i]!.dealers;
      const actions: Piece = { t: 'actions', items: [ask('¿A quién le ofrezco el plan Pro?', '¿Cómo vendo más planes?'), { type: 'download', label: 'Descargar concesionarios', download: { kind: 'tab', tab: 'dealers', label: 'concesionarios' } }] };
      const table = (rows: string[][]): Piece => ({ t: 'table', cols: '1.6fr 1.1fr 0.7fr 0.7fr', head: ['Concesionario', 'Ciudad', 'Plan', 'Vendidos'], rows });
      const rating = (value: number | null) => (value === null ? '' : ` y ${value.toFixed(1)} de calificación`);
      if (month.length) {
        const top = month[0]!;
        return [
          { t: 'text', text: `En ${mname(i)} el que más vendió fue ${top.name}${top.city ? ` (${top.city})` : ''} con ${plural(top.sold, 'auto', 'autos')}${rating(top.rating)}.` },
          table(month.map(d => [d.name, d.city ?? '—', PLAN_SHORT[d.planCode] ?? d.planCode, int(d.sold)])),
          actions,
        ];
      }
      const six = [...st.dealers.list].sort((a, b) => b.sold6m - a.sold6m || b.listings - a.listings).slice(0, 5);
      if (six[0] && six[0].sold6m > 0) {
        const top = six[0];
        return [
          { t: 'text', text: `En ${mname(i)} ningún concesionario cerró ventas. En los últimos 6 meses el que más vendió fue ${top.name}${top.city ? ` (${top.city})` : ''} con ${plural(top.sold6m, 'auto', 'autos')}${rating(top.rating)}.` },
          table(six.map(d => [d.name, d.city ?? '—', PLAN_SHORT[d.planCode] ?? d.planCode, int(d.sold6m)])),
          actions,
        ];
      }
      return [
        { t: 'text', text: six.length ? `Todavía no hay ventas de concesionarios en los últimos 6 meses. Hay ${plural(st.dealers.list.length, 'concesionario aliado', 'concesionarios aliados')} con estos anuncios activos:` : 'Todavía no hay concesionarios aliados verificados.' },
        ...(six.length ? [{ t: 'table', cols: '1.6fr 1.1fr 0.7fr 0.7fr', head: ['Concesionario', 'Ciudad', 'Plan', 'Anuncios'], rows: six.map(d => [d.name, d.city ?? '—', PLAN_SHORT[d.planCode] ?? d.planCode, int(d.listings)]) } as Piece] : []),
        actions,
      ];
    },
    brands: i => {
      const rows = data.months[i]!.brands;
      const total = s[i]!.count;
      if (!rows.length) return [{ t: 'text', text: `En ${mname(i)} ${i === CUR ? 'todavía no hay' : 'no hubo'} ventas, así que no hay marcas que comparar.` }, { t: 'actions', items: [ask('Ventas por marca de los otros meses', `¿Qué marcas se vendieron más en ${long(Math.max(0, i - 1))}?`)] }];
      const [a, b, c] = rows;
      const follow = [b, c].filter(Boolean).map(row => row!.label);
      return [
        { t: 'text', text: `En ${mname(i)} ${a!.label} lidera con ${int(a!.value)} de ${plural(total, 'venta', 'ventas')} (${share(a!.value, total)})${follow.length ? `, seguida de ${joinAnd(follow)}` : ''}.` },
        { t: 'table', cols: '1.5fr 1fr 1fr', head: ['Marca', 'Vendidos', 'Parte'], rows: rows.map(row => [row.label, int(row.value), share(row.value, total)]) },
      ];
    },
    cities: i => {
      const rows = data.months[i]!.cities;
      const total = s[i]!.count;
      if (!rows.length) return [{ t: 'text', text: `En ${mname(i)} ${i === CUR ? 'todavía no hay' : 'no hubo'} ventas, así que no hay ciudades que comparar.` }];
      const [a, b, c] = rows;
      const follow = [b, c].filter(Boolean).map(row => row!.label);
      return [
        { t: 'text', text: `${a!.label} concentra ${share(a!.value, total)} de las ventas de ${mname(i)}.${follow.length ? ` ${joinAnd(follow)} ${follow.length === 1 ? 'viene' : 'vienen'} detrás.` : ''}` },
        { t: 'table', cols: '1.5fr 1fr 1fr', head: ['Ciudad', 'Ventas', 'Parte'], rows: rows.map(row => [row.label, int(row.value), share(row.value, total)]) },
      ];
    },
    plans: i => {
      const m = pl[i]!;
      const sold = m.premium + m.basic + m.pro;
      const text = sold
        ? `En ${mname(i)} se vendieron ${int(m.premium)} Premium, ${int(m.basic)} Concesionario Básico y ${int(m.pro)} Concesionario Pro: ${usd(m.plans)} en planes.`
        : `En ${mname(i)} ${i === CUR ? 'todavía no se vende' : 'no se vendió'} ningún plan con Binance.`;
      return [
        { t: 'text', text },
        {
          t: 'table',
          cols: '1.6fr 0.8fr 0.8fr 0.9fr',
          head: ['Plan', 'Vendidos', 'Mensual', 'Anual'],
          rows: data.plans.map(plan => [plan.name, int(plan.code === 'PREMIUM' ? m.premium : plan.code === 'DEALER_BASIC' ? m.basic : m.pro), usd(plan.monthly), usd(plan.yearly)]),
        },
        { t: 'actions', items: [ask('¿Cómo vendo más planes?'), go('Cambiar precios de planes', '/admin/planes')] },
      ];
    },
    reservations: i => {
      const m = pu[i]!;
      const text = m.reservations
        ? `En ${mname(i)} hubo ${plural(m.reservations, 'reserva', 'reservas')} con abono: ${int(m.completed)} ${m.completed === 1 ? 'terminó' : 'terminaron'} en compra (${share(m.completed, m.reservations)}) y ${int(m.cancelled)} se ${m.cancelled === 1 ? 'canceló' : 'cancelaron'}.${m.avgDeposit !== null ? ` El abono promedio fue ${usd(m.avgDeposit)}.` : ''}`
        : `En ${mname(i)} ${i === CUR ? 'todavía no hay' : 'no hubo'} reservas con abono.`;
      return [{ t: 'text', text }, bars(pu.map(month => month.reservations), int, i)];
    },
    days: i => {
      const value = s[i]!.daysToSell;
      const firstIndex = s.findIndex(month => month.daysToSell !== null);
      const text =
        value === null
          ? `En ${mname(i)} no hubo ventas, así que no puedo medir cuánto tarda un auto en venderse.`
          : `En ${mname(i)} un auto tardó ${plural(value, 'día', 'días')} en venderse desde que se publicó${firstIndex >= 0 && firstIndex < i ? `, contra ${plural(s[firstIndex]!.daysToSell!, 'día', 'días')} en ${long(firstIndex)}` : ''}.`;
      return [{ t: 'text', text }, bars(s.map(month => month.daysToSell ?? 0), v => `${int(v)} d`, i)];
    },
    avgPrice: i => {
      const m = s[i]!;
      if (!m.count) return [{ t: 'text', text: `En ${mname(i)} ${i === CUR ? 'todavía no hay' : 'no hubo'} ventas, así que no hay precio promedio.` }];
      const byType = data.months[i]!.categories.slice(0, 3).map(row => `${row.label} ${money(row.avgPrice)}`);
      return [{ t: 'text', text: `El precio promedio de venta en ${mname(i)} fue ${money(m.value / m.count)}.${byType.length > 1 ? ` Por tipo de auto: ${joinAnd(byType)}.` : ''}` }];
    },
    listings: i => {
      const m = ca[i]!;
      const inv = st.cars.inventory;
      return [
        { t: 'text', text: `En ${mname(i)} ${m.created === 1 ? 'entró 1 anuncio nuevo' : `entraron ${int(m.created)} anuncios nuevos`} y ${i === CUR ? 'hoy hay' : 'al cierre había'} ${int(m.active)} activos. Hoy ${int(inv.negotiating)} ${inv.negotiating === 1 ? 'está' : 'están'} en negociación y ${int(inv.reserved)} ${inv.reserved === 1 ? 'reservado' : 'reservados'}.` },
        bars(ca.map(month => month.created), int, i),
      ];
    },
    projection: () => {
      const { sales, revenue, monthly, pace: rate } = projection;
      const soFar = s[CUR]!.count;
      if (sales === null && rate === null) {
        return [{ t: 'text', text: `Todavía no hay ventas suficientes para proyectar ${long(CUR)}. Cuando haya al menos dos meses seguidos con ventas te doy una estimación.` }];
      }
      const parts: string[] = [];
      if (sales !== null) parts.push(`Con el ritmo de los últimos meses (${signed(monthly!)} al mes), ${long(CUR)} cerraría con unas ${plural(sales, 'venta', 'ventas')}${revenue !== null ? ` y ${usd(revenue)} de ingreso` : ''}.`);
      if (rate !== null) {
        const versus = sales === null ? '' : rate < sales * 0.95 ? ', un poco por debajo' : rate > sales * 1.05 ? ', un poco por encima' : ', parecido';
        parts.push(`Van ${plural(soFar, 'venta', 'ventas')} en ${plural(days, 'día', 'días')}: a ese paso ${sales === null ? `${long(CUR)} cerraría con` : 'serían'} ${int(rate)}${versus}.`);
      } else parts.push(`En ${long(CUR)} todavía no hay ventas.`);
      parts.push('Es una estimación, no una promesa.');
      const estimate = sales ?? rate!;
      const past = bars(s.slice(0, CUR).map(month => month.count), int, L) as Extract<Piece, { t: 'bars' }>;
      return [
        { t: 'text', text: parts.join(' ') },
        { t: 'bars', items: [...past.items, { label: `${short(CUR)} est.`, value: estimate, text: int(estimate), fill: 'projected' }] },
        { t: 'actions', items: [ask('¿Cómo llego a esa cifra?', '¿Cómo vendo más planes?')] },
      ];
    },
    odd: () => {
      const list = alerts();
      if (!list.length) return [{ t: 'text', text: 'Revisé los datos de hoy y no veo nada raro: no hay reportes abiertos, pagos por verificar, verificaciones pendientes ni anuncios repetidos.' }];
      return [{ t: 'text', text: 'Revisé los datos de hoy. Esto merece tu atención:' }, { t: 'list', items: list }];
    },
    ideas: () => {
      const list = ideas();
      if (!list.length) {
        return [
          { t: 'text', text: 'Con los datos de hoy no tengo una idea con números que valga la pena: ningún concesionario en Básico llena su cupo ni vende cada semana, y la portada y la pantalla de entrada tienen cupos libres.' },
          { t: 'actions', items: [ask('¿Qué concesionario vendió más?'), ask('¿Cómo están los planes?', `Planes de ${long(L)}`)] },
        ];
      }
      return [{ t: 'text', text: list.length === 1 ? 'Una idea con números de tus datos:' : `${cap(['', 'una', 'dos', 'tres', 'cuatro'][list.length] ?? String(list.length))} ideas con números de tus datos:` }, { t: 'list', items: list }];
    },
    summary: () => {
      const m = s[L]!;
      const revenue = pl[L]!.total;
      const delta = deltaText(L, revenue, pl[L - 1]!.total);
      const best = pl.slice(0, CUR).every((month, i) => i === L || month.total < revenue) && revenue > 0;
      const text =
        m.count === 0 && revenue === 0
          ? `${cap(long(L))} cerró sin ventas concretadas ni ingresos. ${cap(long(CUR))} va en curso.`
          : `${cap(long(L))} ${best ? 'fue el mejor mes' : 'cerró'}: ${m.count === 1 ? '1 auto vendido' : `${int(m.count)} autos vendidos`} por ${money(m.value)} y ${usd(revenue)} de ingreso para AutoMarket${delta ? ` (${delta})` : ''}.`;
      return [
        { t: 'text', text },
        summaryKpis(),
        { t: 'actions', items: [ask('¿Hay algo raro?'), ask(`Proyecta ${long(CUR)}`)] },
      ];
    },
    payments: () => {
      const { count, total, items } = data.payments;
      if (!count) return [{ t: 'text', text: 'No hay pagos por verificar ahora.' }, { t: 'actions', items: [go('Ir a Pagos Binance', '/admin/pagos')] }];
      const detail = items.slice(0, 6).map(item => `${item.concept} (${usd(item.amount)})`);
      return [
        { t: 'text', text: `Hay ${plural(count, 'pago', 'pagos')} por verificar en Binance por ${usd(total)}: ${joinAnd(detail)}${items.length > 6 ? ' y otros' : ''}. Revísalos en tu app de Binance antes de aprobar.` },
        { t: 'actions', items: [go('Ir a Pagos Binance', '/admin/pagos')] },
      ];
    },
    kyc: () => [
      { t: 'text', text: data.kyc.pending ? `Hay ${plural(data.kyc.pending, 'persona', 'personas')} esperando la verificación de identidad.` : 'No hay verificaciones de identidad pendientes.' },
      { t: 'actions', items: [go('Abrir verificación KYC', '/admin/kyc')] },
    ],
    reports: () => {
      const { open, byReason, fraud } = data.reports;
      if (!open) return [{ t: 'text', text: 'No hay reportes abiertos.' }, { t: 'actions', items: [go('Abrir reportes', '/admin/reportes')] }];
      const detail = (Object.keys(REASON_TEXT) as ReportCaseReason[]).filter(reason => byReason[reason] > 0).map(reason => `${int(byReason[reason])} ${REASON_TEXT[reason][byReason[reason] === 1 ? 0 : 1]}`);
      const start = fraud[0] ? ` Te recomiendo empezar por ${fraud[0].title}${fraud[0].price !== null ? ` a ${money(fraud[0].price)}` : ''}.` : '';
      return [{ t: 'text', text: `Hay ${plural(open, 'reporte abierto', 'reportes abiertos')}: ${joinAnd(detail)}.${start}` }, { t: 'actions', items: [go('Abrir reportes', '/admin/reportes')] }];
    },
  };

  function summaryKpis(): Piece {
    return {
      t: 'kpis',
      items: [
        { label: 'Ventas', value: int(s[L]!.count) },
        { label: 'Ingreso', value: usd(pl[L]!.total) },
        { label: 'Registros', value: int(us[L]!.created) },
        { label: 'Días para vender', value: s[L]!.daysToSell === null ? '—' : int(s[L]!.daysToSell!) },
      ],
    };
  }

  function compare(a: number, b: number): Piece[] {
    const rows = compareRows(a, b);
    const best = rows
      .slice(0, 6)
      .filter(row => row.change !== null)
      .sort((x, y) => y.change! - x.change!)[0];
    const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);
    const empty = rows.slice(0, 6).every(row => row.a === 0 && row.b === 0);
    const head = `${cap(long(b))} contra ${long(a)}: `;
    const text = empty
      ? `${head}todavía no hay movimiento que comparar en esos meses.`
      : best && best.change! > 0
        ? `${head}lo que más creció fue «${lower(best.label)}» (${signed(best.change!)}).`
        : `${head}ninguna cifra creció.`;
    const warn = b === CUR ? ` Ojo: ${long(CUR)} lleva solo ${plural(days, 'día', 'días')}, así que la comparación todavía no es justa.` : '';
    return [
      { t: 'text', text: text + warn },
      { t: 'table', cols: '1.5fr 1fr 1fr 0.8fr', head: ['', cap(short(a)), cap(short(b)), 'Cambio'], rows: rows.map(row => [row.label, row.textA, row.textB, row.change === null ? '—' : signed(row.change)]) },
      { t: 'actions', items: [{ type: 'download', label: 'Descargar comparación en Excel', download: { kind: 'compare', a, b } }, go('Ver estadísticas', '/admin/estadisticas')] },
    ];
  }

  function compareRows(a: number, b: number) {
    const row = (label: string, x: number | null, y: number | null, text: (v: number) => string) => ({
      label,
      a: x ?? 0,
      b: y ?? 0,
      textA: x === null ? '—' : text(x),
      textB: y === null ? '—' : text(y),
      change: x !== null && y !== null ? growth(y, x) : null,
    });
    return [
      row('Autos vendidos', s[a]!.count, s[b]!.count, int),
      row('Valor vendido', s[a]!.value, s[b]!.value, money),
      row('Ingreso AutoMarket', pl[a]!.total, pl[b]!.total, usd),
      row('Reservas', pu[a]!.reservations, pu[b]!.reservations, int),
      row('Registros nuevos', us[a]!.created, us[b]!.created, int),
      row('Anuncios nuevos', ca[a]!.created, ca[b]!.created, int),
      row('Días para vender', s[a]!.daysToSell, s[b]!.daysToSell, v => plural(v, 'día', 'días')),
    ];
  }

  function helpActions(): Piece {
    return {
      t: 'actions',
      items: [`¿Cuánto ingresamos en ${long(L)}?`, `Compara ${long(L - 1)} y ${long(L)}`, `Proyecta ${long(CUR)}`, '¿Qué concesionario vendió más?', '¿Hay algo raro?', '¿Cómo vendo más planes?'].map(q => ask(q)),
    };
  }

  /** Meses mencionados (índices de la ventana) y si alguno queda fuera de los 6 meses. */
  function monthsIn(text: string) {
    const found: number[] = [];
    let outside = false;
    for (const [number, re] of MONTH_WORDS) {
      if (!re.test(text)) continue;
      const index = keys.findIndex(key => Number(key.slice(5, 7)) === number);
      if (index >= 0) found.push(index);
      else outside = true;
    }
    if (/este mes|mes actual|en curso|\bhoy\b/.test(text)) found.push(CUR);
    if (/mes pasado|ultimo mes|mes anterior/.test(text)) found.push(L);
    return { months: [...new Set(found)].sort((x, y) => x - y), outside };
  }

  function answer(raw: string, context: Context): Reply {
    const { text, fixes } = fixTypos(raw, known);
    const found = monthsIn(text);
    let months = found.months;
    let intent = INTENTS.find(([, re]) => re.test(text))?.[0] ?? null;
    const follow = !intent && (months.length > 0 || /^\s*¿?\s*y\b|anterior|antes/.test(text));
    if (follow && context.intent) intent = context.intent;
    if (/anterior|antes/.test(text) && !/mes anterior/.test(text) && !months.length && context.month !== null) months = [Math.max(0, context.month - 1)];
    const notes: Piece[] = [];
    if (fixes.length) notes.push({ t: 'note', text: `Entendí: ${fixes.join(', ')}` });
    if (found.outside) notes.push({ t: 'note', text: `Solo tengo los últimos 6 meses: de ${long(0)} a ${long(CUR)}.` });

    if (/compar|\bvs\b|contra|frente a/.test(text) || (intent === 'compare' && months.length)) {
      const [a, b] = months.length >= 2 ? [months[0]!, months[1]!] : months.length === 1 ? [Math.max(0, months[0]! - 1), months[0]!] : [L - 1, L];
      return { pieces: [...notes, ...compare(a === b ? Math.max(0, b - 1) : a, b)], context: { intent: 'compare', month: b } };
    }
    if (!intent) {
      if (/^\s*(hola|buenas|buenos|hey)\b|que puedes|ayuda|como funciona/.test(text)) {
        return { pieces: [...notes, { t: 'text', text: 'Leo ventas, reservas, anuncios, usuarios, planes, pagos y reportes, y te respondo con números, gráficos y tablas que puedes descargar.' }, helpActions()], context };
      }
      if (/gracias/.test(text)) {
        return { pieces: [...notes, { t: 'text', text: 'A la orden.\n\n**¿Te descargo todas las estadísticas en Excel?**' }, { t: 'actions', items: [{ type: 'download', label: 'Descargar todo en Excel', download: { kind: 'all' } }] }], context };
      }
      return { pieces: [...notes, { t: 'text', text: 'No encontré ese dato. Pregúntame como le preguntarías a tu contador, por ejemplo:' }, helpActions()], context };
    }
    if (intent === 'export') {
      return {
        pieces: [
          ...notes,
          { t: 'text', text: 'Listo. Te descargué todas las estadísticas en un archivo que Excel abre directo. El PDF con gráficos lo sacas desde Estadísticas.' },
          { t: 'actions', items: [{ type: 'download', label: 'Descargar otra vez', download: { kind: 'all' } }, go('Ir a Estadísticas', '/admin/estadisticas')] },
        ],
        context: { intent, month: context.month },
        download: { kind: 'all' },
      };
    }
    if (intent === 'compare') intent = 'sales';
    const month = months.length ? months[0]! : follow && context.month !== null ? context.month : L;
    return { pieces: [...notes, ...fn[intent as Exclude<Intent, 'compare' | 'export'>](month)], context: { intent, month } };
  }

  /**
   * Mensaje de entrada: directo al estado (el último mes completo y lo que hay que revisar), sin
   * saludo, y cierra con el siguiente paso, que es la primera acción.
   */
  function welcome(): Piece[] {
    const list = alerts();
    const urgent = list.filter(item => item.tone !== 'good').length;
    const m = s[L]!;
    const month = m.count || pl[L]!.total ? `${cap(long(L))} cerró con **${plural(m.count, 'venta', 'ventas')}** y **${usd(pl[L]!.total)}** de ingreso` : `${cap(long(L))} cerró sin ventas ni ingresos`;
    const todo = urgent === 0 ? 'Hoy no hay nada urgente que revisar' : urgent === 1 ? 'Hoy hay **una cosa** que revisar' : `Hoy hay **${['', '', 'dos', 'tres', 'cuatro', 'cinco'][urgent] ?? int(urgent)} cosas** que revisar`;
    return [
      { t: 'text', text: `${month}. ${todo}.` },
      summaryKpis(),
      ...(list.length ? [{ t: 'list', items: list } as Piece] : []),
      { t: 'text', text: `**¿Comparo ${long(L - 1)} y ${long(L)}?**` },
      { t: 'actions', items: [ask(`Compara ${long(L - 1)} y ${long(L)}`), ask(`Proyecta ${long(CUR)}`)] },
    ];
  }

  /** Tarjetas de «Panorama de hoy». */
  function panorama() {
    const revenueDelta = growth(pl[L]!.total, pl[L - 1]!.total);
    const salesDelta = growth(s[L]!.count, s[L - 1]!.count);
    const deltaNote = (p: number | null) => (p === null ? `sin datos de ${long(L - 1)} para comparar` : p === 0 ? `igual que en ${long(L - 1)}` : `${p > 0 ? 'sube' : 'baja'} ${Math.abs(p)} % frente a ${long(L - 1)}`);
    const estimate = projection.sales ?? projection.pace;
    return [
      { label: `Ingreso de ${long(L)}`, value: usd(pl[L]!.total), note: deltaNote(revenueDelta), tone: 'good' as Tone, ask: `¿Cuánto ingresamos en ${long(L)}?` },
      { label: 'Autos vendidos', value: int(s[L]!.count), note: deltaNote(salesDelta), tone: 'good' as Tone, ask: `Ventas de ${long(L)}` },
      { label: 'Posible fraude', value: int(data.reports.byReason.FRAUD), note: data.reports.byReason.FRAUD ? 'reportes abiertos, revisar hoy' : 'sin reportes abiertos', tone: 'danger' as Tone, ask: '¿Hay algo raro?' },
      { label: 'Pagos por verificar', value: usd(data.payments.total), note: data.payments.count === 1 ? '1 pago en Binance' : `${int(data.payments.count)} pagos en Binance`, tone: 'warn' as Tone, ask: '¿Hay pagos pendientes?' },
      { label: `Proyección de ${long(CUR)}`, value: estimate === null ? '—' : plural(estimate, 'venta', 'ventas'), note: estimate === null ? 'faltan meses con ventas' : 'si sigue el ritmo', tone: 'purple' as Tone, ask: `Proyecta ${long(CUR)}` },
    ];
  }

  const chips = [`¿Cuánto ingresamos en ${long(L)}?`, '¿Qué concesionario vendió más?', `Compara ${long(L - 2)} y ${long(L)}`, '¿De qué países son los usuarios?', '¿Hay pagos pendientes?', 'Exporta todo a Excel'];

  /** Filas de la comparación para el CSV. */
  const compareCsv = (a: number, b: number) => ({
    name: `automarket-${long(a)}-vs-${long(b)}.csv`,
    head: ['', cap(short(a)), cap(short(b)), 'Cambio'],
    rows: compareRows(a, b).map(row => [row.label, row.textA, row.textB, row.change === null ? '—' : signed(row.change)]),
  });

  return { answer, welcome, panorama, chips, compareCsv };
}
