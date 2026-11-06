import { countryName, type AdminStatsDTO, type StatsBucketDTO } from '@automarket/contracts';

/**
 * Vistas y formato de las estadísticas del panel (sin React): las usan la pantalla Estadísticas y el
 * Copiloto del admin, así las cifras y los CSV salen iguales en los dos lugares.
 */
export type TabKey = 'sales' | 'purchases' | 'cars' | 'users' | 'plans' | 'dealers';
export const TABS: Array<[TabKey, string]> = [
  ['sales', 'Ventas'],
  ['purchases', 'Compras'],
  ['cars', 'Carros'],
  ['users', 'Usuarios'],
  ['plans', 'Ingresos'],
  ['dealers', 'Concesionarios'],
];

const monthDate = (key: string) => new Date(`${key}-15T12:00:00Z`);
export const monthLong = (key: string) => new Intl.DateTimeFormat('es', { month: 'long', timeZone: 'UTC' }).format(monthDate(key));
export const monthShort = (key: string) => new Intl.DateTimeFormat('es', { month: 'short', timeZone: 'UTC' }).format(monthDate(key)).replace('.', '').replace('sept', 'sep');
export const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** Enteros con punto de miles («7.336»). */
export const int = (value: number) => Math.round(value).toLocaleString('de-DE');
/** Dinero: «$17.618» o «$1,16 M». */
export const money = (value: number) => (Math.abs(value) >= 1_000_000 ? `$${(value / 1_000_000).toFixed(2).replace('.', ',')} M` : `$${Math.round(value).toLocaleString('de-DE')}`);
/** Eje y etiquetas: «1,2 M», «12K» o «1.087». */
export const compact = (value: number) => (value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1).replace('.', ',')} M` : value >= 10_000 ? `${Math.round(value / 1000)}K` : int(value));
export const pct = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)} %` : '—');

export function niceMax(value: number) {
  // Mínimo 2: las marcas (0, la mitad y el máximo) quedan en números enteros.
  if (value <= 2) return 2;
  const p = 10 ** Math.floor(Math.log10(value));
  const n = Math.ceil(value / p);
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export interface Kpi {
  label: string;
  value: string;
  current: number | null;
  previous: number | null;
  /** Bajar es bueno (días para vender, canceladas). */
  downIsGood?: boolean;
  note?: string;
}
export interface TabView {
  kpis: Kpi[];
  chart: { title: string; values: number[]; money?: boolean; label: (value: number, i: number) => string; sub: (i: number) => string };
  side: { title: string; sub: string; rows: Array<{ label: string; value: number; text: string }> };
  grid: { title: string; sub: string; cols: string; head: string[]; rows: string[][] };
  table: { head: string[]; rows: (string | number)[][] };
}

export function buildViews(data: AdminStatsDTO): Record<TabKey, TabView> {
  const keys = data.months.map(month => month.key);
  const L = keys.length - 2; // último mes completo
  const P = keys.length - 3;
  const lastName = monthLong(keys[L]!);
  const nowName = monthLong(keys.at(-1)!);
  const monthCell = (i: number) => (data.months[i]!.current ? `${monthShort(keys[i]!)} (en curso)` : monthShort(keys[i]!));
  const s = data.sales.months;
  const pu = data.purchases.months;
  const c = data.cars.months;
  const u = data.users.months;
  const pl = data.plans.months;
  const d = data.dealers.months;
  const avgPrice = (i: number) => (s[i]!.count ? s[i]!.value / s[i]!.count : 0);
  const buckets = (rows: StatsBucketDTO[], text: (v: number) => string) => rows.map(row => ({ label: row.label, value: row.value, text: text(row.value) }));
  const share = (rows: StatsBucketDTO[]) => {
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    return rows.map(row => [row.label, int(row.value), pct(row.value, total)]);
  };
  const lastTotalSales = s[L]!.count;
  const activeTotal = data.cars.byCategory.reduce((sum, row) => sum + row.value, 0);
  const planCount = (i: number) => pl[i]!.premium + pl[i]!.basic + pl[i]!.pro;
  const PLAN = (code: string) => (code === 'DEALER_PRO' ? 'Pro' : code === 'DEALER_BASIC' ? 'Básico' : 'Gratis');
  const dealers = data.dealers.list;

  return {
    sales: {
      kpis: [
        { label: `Autos vendidos en ${lastName}`, value: int(s[L]!.count), current: s[L]!.count, previous: s[P]!.count },
        { label: `Valor vendido en ${lastName}`, value: money(s[L]!.value), current: s[L]!.value, previous: s[P]!.value },
        { label: 'Precio promedio', value: s[L]!.count ? money(avgPrice(L)) : '—', current: avgPrice(L) || null, previous: avgPrice(P) || null },
        { label: 'Días para vender', value: s[L]!.daysToSell === null ? '—' : `${s[L]!.daysToSell} días`, current: s[L]!.daysToSell, previous: s[P]!.daysToSell, downIsGood: true },
      ],
      chart: { title: 'Autos vendidos por mes', values: s.map(m => m.count), label: v => `${int(v)} ${v === 1 ? 'auto vendido' : 'autos vendidos'}`, sub: i => `${money(s[i]!.value)} en total` },
      side: { title: 'Más vendidos por marca', sub: `${cap(lastName)}, ${lastTotalSales} ${lastTotalSales === 1 ? 'venta' : 'ventas'}`, rows: buckets(data.sales.byBrand, v => `${v} ${v === 1 ? 'auto' : 'autos'}`) },
      grid: { title: 'Ventas por ciudad', sub: cap(lastName), cols: '1.4fr 1fr 1fr', head: ['Ciudad', 'Ventas', 'Parte'], rows: share(data.sales.byCity) },
      table: { head: ['Mes', 'Autos vendidos', 'Valor vendido (USD)', 'Precio promedio (USD)', 'Días para vender'], rows: s.map((m, i) => [monthCell(i), m.count, int(m.value), m.count ? int(avgPrice(i)) : '—', m.daysToSell ?? '—']) },
    },
    purchases: {
      kpis: [
        { label: `Reservas en ${lastName}`, value: int(pu[L]!.reservations), current: pu[L]!.reservations, previous: pu[P]!.reservations },
        { label: 'Terminaron en compra', value: pct(pu[L]!.completed, pu[L]!.reservations), current: pu[L]!.reservations ? pu[L]!.completed / pu[L]!.reservations : null, previous: pu[P]!.reservations ? pu[P]!.completed / pu[P]!.reservations : null },
        { label: 'Abono promedio', value: pu[L]!.avgDeposit === null ? '—' : money(pu[L]!.avgDeposit), current: pu[L]!.avgDeposit, previous: pu[P]!.avgDeposit },
        { label: 'Canceladas', value: int(pu[L]!.cancelled), current: pu[L]!.cancelled, previous: pu[P]!.cancelled, downIsGood: true },
      ],
      chart: { title: 'Reservas con abono por mes', values: pu.map(m => m.reservations), label: v => `${int(v)} ${v === 1 ? 'reserva' : 'reservas'}`, sub: i => `${int(pu[i]!.completed)} terminaron en compra` },
      side: {
        title: 'Qué pasó con las reservas',
        sub: `${cap(lastName)}, ${pu[L]!.reservations} ${pu[L]!.reservations === 1 ? 'reserva' : 'reservas'}`,
        rows: [
          { label: 'Concretadas', value: data.purchases.outcome.completed, text: int(data.purchases.outcome.completed) },
          { label: 'Canceladas o vencidas', value: data.purchases.outcome.cancelled, text: int(data.purchases.outcome.cancelled) },
          { label: 'Siguen abiertas', value: data.purchases.outcome.open, text: int(data.purchases.outcome.open) },
        ],
      },
      grid: { title: 'Detalle por mes', sub: 'Reservas que hicieron los compradores con abono', cols: '1fr 1fr 1fr 1fr', head: ['Mes', 'Reservas', 'Concretadas', 'Canceladas'], rows: pu.map((m, i) => [monthShort(keys[i]!), int(m.reservations), int(m.completed), int(m.cancelled)]) },
      table: { head: ['Mes', 'Reservas hechas', 'Concretadas', 'Canceladas', 'Abono promedio (USD)'], rows: pu.map((m, i) => [monthCell(i), m.reservations, m.completed, m.cancelled, m.avgDeposit ?? '—']) },
    },
    cars: {
      kpis: [
        { label: 'Anuncios activos', value: int(c.at(-1)!.active), current: c[L]!.active, previous: c[P]!.active, note: `${cap(monthShort(keys[L]!))} vs ${monthShort(keys[P]!)}` },
        { label: `Nuevos en ${lastName}`, value: int(c[L]!.created), current: c[L]!.created, previous: c[P]!.created },
        { label: 'En negociación', value: int(data.cars.inventory.negotiating), current: null, previous: null, note: 'Hoy' },
        { label: 'Días para vender', value: s[L]!.daysToSell === null ? '—' : `${s[L]!.daysToSell} días`, current: s[L]!.daysToSell, previous: s[P]!.daysToSell, downIsGood: true },
      ],
      chart: { title: 'Anuncios nuevos por mes', values: c.map(m => m.created), label: v => `${int(v)} ${v === 1 ? 'anuncio nuevo' : 'anuncios nuevos'}`, sub: i => `${int(c[i]!.active)} activos al cierre` },
      side: {
        title: 'Estado del inventario',
        sub: 'Hoy',
        rows: [
          { label: 'Publicados', value: data.cars.inventory.published, text: int(data.cars.inventory.published) },
          { label: 'Reservados', value: data.cars.inventory.reserved, text: int(data.cars.inventory.reserved) },
          { label: 'En negociación', value: data.cars.inventory.negotiating, text: int(data.cars.inventory.negotiating) },
          { label: `Vendidos en ${nowName}`, value: data.cars.inventory.soldThisMonth, text: int(data.cars.inventory.soldThisMonth) },
        ],
      },
      grid: { title: 'Por tipo de auto', sub: `Anuncios activos (${int(activeTotal)})`, cols: '1.4fr 1fr 1fr', head: ['Tipo', 'Anuncios', 'Parte'], rows: share(data.cars.byCategory) },
      table: { head: ['Mes', 'Anuncios nuevos', 'Anuncios activos', 'Días para vender'], rows: c.map((m, i) => [monthCell(i), m.created, m.active, s[i]!.daysToSell ?? '—']) },
    },
    users: {
      kpis: [
        { label: 'Cuentas en total', value: int(u.at(-1)!.total), current: u[L]!.total, previous: u[P]!.total, note: `${cap(monthShort(keys[L]!))} vs ${monthShort(keys[P]!)}` },
        { label: `Nuevas en ${lastName}`, value: int(u[L]!.created), current: u[L]!.created, previous: u[P]!.created },
        { label: `Verificadas en ${lastName}`, value: int(u[L]!.verified), current: u[L]!.verified, previous: u[P]!.verified },
        { label: 'Se verifican', value: pct(u[L]!.verified, u[L]!.created), current: u[L]!.created ? u[L]!.verified / u[L]!.created : null, previous: u[P]!.created ? u[P]!.verified / u[P]!.created : null },
      ],
      chart: { title: 'Registros nuevos por mes', values: u.map(m => m.created), label: v => `${int(v)} ${v === 1 ? 'registro' : 'registros'}`, sub: i => `${int(u[i]!.verified)} se verificaron` },
      side: { title: 'Cuentas por país', sub: 'Total', rows: buckets(data.users.byCountry.map(row => ({ ...row, label: countryName(row.label) || row.label })), v => int(v)) },
      grid: { title: 'Detalle por mes', sub: 'Personas y concesionarios', cols: '1fr 1fr 1fr 1fr', head: ['Mes', 'Nuevas', 'Verificadas', 'Total'], rows: u.map((m, i) => [monthShort(keys[i]!), int(m.created), int(m.verified), int(m.total)]) },
      table: { head: ['Mes', 'Registros nuevos', 'Verificados', 'Total de cuentas'], rows: u.map((m, i) => [monthCell(i), m.created, m.verified, m.total]) },
    },
    plans: {
      kpis: [
        { label: `Ingreso de ${lastName}`, value: money(pl[L]!.total), current: pl[L]!.total, previous: pl[P]!.total },
        { label: 'Por planes', value: money(pl[L]!.plans), current: pl[L]!.plans, previous: pl[P]!.plans },
        { label: 'Planes vendidos', value: int(planCount(L)), current: planCount(L), previous: planCount(P) },
        { label: 'Comisiones cobradas', value: money(pl[L]!.commissions), current: pl[L]!.commissions, previous: pl[P]!.commissions },
      ],
      chart: { title: 'Ingreso de AutoMarket por mes (USD)', values: pl.map(m => m.total), money: true, label: v => money(v), sub: i => `planes ${money(pl[i]!.plans)} · comisiones ${money(pl[i]!.commissions)} · destacados ${money(pl[i]!.boosts + pl[i]!.login)}` },
      side: {
        title: 'De dónde sale el dinero',
        sub: cap(lastName),
        rows: [
          { label: 'Planes', value: pl[L]!.plans, text: money(pl[L]!.plans) },
          { label: 'Comisiones', value: pl[L]!.commissions, text: money(pl[L]!.commissions) },
          { label: 'Destacados', value: pl[L]!.boosts, text: money(pl[L]!.boosts) },
          { label: 'Pantalla de entrada', value: pl[L]!.login, text: money(pl[L]!.login) },
        ],
      },
      grid: { title: 'Planes comprados', sub: 'Con Binance, personas y concesionarios', cols: '1fr 1fr 1fr 1fr', head: ['Mes', 'Premium', 'Básico', 'Pro'], rows: pl.map((m, i) => [monthShort(keys[i]!), int(m.premium), int(m.basic), int(m.pro)]) },
      table: {
        head: ['Mes', 'Premium', 'Concesionario Básico', 'Concesionario Pro', 'Ingreso por planes', 'Comisiones', 'Destacados', 'Pantalla de entrada', 'Ingreso total (USD)'],
        rows: pl.map((m, i) => [monthCell(i), m.premium, m.basic, m.pro, m.plans, m.commissions, m.boosts, m.login, m.total]),
      },
    },
    dealers: {
      kpis: [
        { label: 'Concesionarios activos', value: int(d[L]!.active), current: d[L]!.active, previous: d[P]!.active },
        { label: 'En plan Pro', value: int(d[L]!.pro), current: d[L]!.pro, previous: d[P]!.pro },
        { label: 'Ventas de concesionarios', value: `${int(d[L]!.sales)} en ${monthShort(keys[L]!)}`, current: d[L]!.sales, previous: d[P]!.sales },
        { label: 'Países', value: int(d[L]!.countries), current: d[L]!.countries, previous: d[P]!.countries },
      ],
      chart: { title: 'Concesionarios activos por mes', values: d.map(m => m.active), label: v => `${int(v)} ${v === 1 ? 'activo' : 'activos'}`, sub: i => `${int(d[i]!.withPlan)} con plan` },
      side: { title: 'Los que más venden', sub: 'Autos vendidos en 6 meses', rows: [...dealers].sort((a, b) => b.sold6m - a.sold6m).slice(0, 6).map(row => ({ label: row.name, value: row.sold6m, text: `${row.sold6m} ${row.sold6m === 1 ? 'auto' : 'autos'}` })) },
      grid: { title: 'Concesionarios aliados', sub: `Ordenados por ventas de ${lastName}`, cols: '1.6fr 1.2fr 0.8fr 0.6fr', head: ['Nombre', 'Ciudad', 'Plan', cap(monthShort(keys[L]!))], rows: dealers.map(row => [row.name, [row.city, row.country].filter(Boolean).join(', '), PLAN(row.planCode), int(row.soldLastMonth)]) },
      table: {
        head: ['Concesionario', 'Ciudad', 'País', 'Plan', 'Anuncios activos', `Vendidos en ${lastName}`, 'Vendidos en 6 meses', 'Calificación'],
        rows: dealers.map(row => [row.name, row.city ?? '', countryName(row.country), PLAN(row.planCode), row.listings, row.soldLastMonth, row.sold6m, row.rating ?? '—']),
      },
    },
  };
}

/** CSV que Excel abre con acentos: «;», BOM UTF-8 y saltos CRLF. */
export function toCsv(blocks: Array<{ title?: string; head: string[]; rows: (string | number)[][] }>) {
  const cell = (value: string | number) => {
    const text = String(value);
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.title) lines.push(cell(block.title.toUpperCase()));
    lines.push(block.head.map(cell).join(';'));
    for (const row of block.rows) lines.push(row.map(cell).join(';'));
    if (block.title) lines.push('');
  }
  return `﻿${lines.join('\r\n')}`;
}
export function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
