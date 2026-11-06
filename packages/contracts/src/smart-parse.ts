/**
 * Intérprete del buscador inteligente (y del Copiloto de compra): entiende frases como «jeepeta
 * automática hasta 22 lucas» con reglas, sin IA. Sinónimos venezolanos, corrección de faltas por
 * distancia de edición contra el vocabulario real del catálogo y extracción de filtros.
 */

export interface SmartVocabulary {
  /** Modelo normalizado → marca y nombre como se publica. */
  models: Record<string, { make: string; label: string }>;
  /** Marcas normalizadas. */
  brands: string[];
  /** Ciudades como se publican («Valencia», «Los Teques»). */
  cities: string[];
}

export type SmartCategory = 'SUV' | 'PICKUP' | 'SEDAN' | 'HATCHBACK' | 'SPORTS' | 'CONVERTIBLE';
export type SmartUse = 'city' | 'family' | 'work';
export type SmartPriority = 'fuel' | 'value' | 'space';

export interface SmartParse {
  /** Texto normalizado y corregido (con espacios a los lados). */
  q: string;
  fixes: Array<{ from: string; to: string }>;
  models: string[];
  brand: string | null;
  gearbox: 'AUTOMATIC' | 'MANUAL' | null;
  bothGearboxes: boolean;
  category: SmartCategory | null;
  electric: boolean;
  use: SmartUse | null;
  priority: SmartPriority | null;
  city: string | null;
  year: number | null;
  km: number | null;
  min: number | null;
  max: number | null;
  /** Monto suelto («un Corolla de 18 mil»). */
  amount: number | null;
  isFair: boolean;
  isSell: boolean;
  isInfo: boolean;
  isQuestion: boolean;
}

export const normalizeText = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const SYNONYMS: Array<[RegExp, string]> = [
  [/\b(jeepeta|jeepetas|rustico|rustica|rusticos|camionetica|camioneticas|suv)\b/g, 'camioneta'],
  [/\b(picop|pikup|pick up|pick-up|platon)\b/g, 'pickup'],
  [/\b(mecanico|mecanica|estandar|de cambios|sincronica|sincronicos|sincronicas)\b/g, 'sincronico'],
  [/\b(automatica|automaticos|automaticas|tiptronic)\b/g, 'automatico'],
  [/\b(chevy|chevrolete)\b/g, 'chevrolet'],
  [/\b(verdes|dolares|usd)\b/g, ''],
  [/\b(carro|carros|coche|coches|vehiculo|vehiculos|nave|maquina)\b/g, 'auto'],
];
/** Lo que el buscador cuenta que tradujo (««jeepeta» = camioneta»). */
const SEEN: Array<[RegExp, (word: string) => string]> = [
  [/\b(jeepeta|jeepetas|rustico|rustica|camionetica|suv)\b/, w => `«${w}» = camioneta`],
  [/\b(picop|pikup|pick up|platon)\b/, w => `«${w}» = pickup`],
  [/\b(mecanico|mecanica|estandar|de cambios)\b/, w => `«${w}» = sincrónico`],
  [/\b\d+(?:[.,]\d+)?\s*(lucas|k|mil)\b/, w => `«${w}» = ${usdText(parseFloat(w.replace(',', '.')) * 1000)}`],
  [/\b(carro|coche|nave|maquina)\b/, w => `«${w}» = auto`],
];
/** Palabras comunes que no se corrigen. */
const STOP = new Set(
  'hasta desde entre menos maximo minimo quiero busco necesito para como cual cuales cuanto cuanta donde tengo algo todo todos mejor bueno buena nuevo nueva usado usada color rojo negro blanco gris azul plata verde precio barato barata grande pequeno familia trabajo ciudad gasolina diesel electrico electricos hibrido kilometros automatico sincronico camioneta camionetas pickup pickups sedan sedanes compacto compactos auto autos tiene tienen puesto puestos puertas motor cuatro anos'.split(
    ' ',
  ),
);

const WHOLE_USD = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const CENTS_USD = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Dólares como se escriben en Venezuela, igual en toda la app: $46.900 (punto de miles). */
export const usdText = (value: number) => `$${WHOLE_USD.format(Math.round(value))}`;

/** Con céntimos solo cuando los tiene: $24,99 · $46.900. */
export const usdPrice = (value: number) => (Math.round(value * 100) % 100 !== 0 ? `$${CENTS_USD.format(value)}` : usdText(value));

function distance(a: string, b: string): number {
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

export function smartParse(text: string, vocab: SmartVocabulary): SmartParse {
  let q = normalizeText(text);
  for (const [re, to] of SYNONYMS) q = q.replace(re, to);
  const words = new Set([...Object.keys(vocab.models), ...vocab.brands, ...vocab.cities.map(normalizeText).filter(city => !city.includes(' '))]);
  const vocabulary = [...words, 'camioneta', 'pickup', 'sedan', 'automatico', 'sincronico', 'familia', 'trabajo', 'ciudad', 'gasolina', 'diesel', 'electrico'];
  const fixes: SmartParse['fixes'] = [];
  q = q.replace(/[a-zñ]{4,}/g, word => {
    if (words.has(word) || STOP.has(word) || vocabulary.includes(word)) return word;
    let best: string | null = null;
    let bestDistance = 9;
    for (const candidate of vocabulary) {
      const dd = distance(word, candidate);
      if (dd < bestDistance) {
        bestDistance = dd;
        best = candidate;
      }
    }
    if (best && bestDistance <= (word.length >= 7 ? 2 : 1)) {
      fixes.push({ from: word, to: best });
      return best;
    }
    return word;
  });
  q = ` ${q.replace(/\s+/g, ' ').trim()} `;

  const models = Object.keys(vocab.models).filter(model => new RegExp(`[^a-z0-9]${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9]`).test(q));
  const brand = vocab.brands.find(b => new RegExp(`[^a-z0-9]${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9]`).test(q)) ?? (models[0] ? normalizeText(vocab.models[models[0]]!.make) : null);
  const auto = /autom/.test(q);
  const manual = /(sincr|manual)/.test(q);
  const category: SmartCategory | null = /camioneta/.test(q)
    ? 'SUV'
    : /(pickup|carga pesada)/.test(q)
      ? 'PICKUP'
      : /sedan/.test(q)
        ? 'SEDAN'
        : /(pequeno|compacto|hatch|chiquito)/.test(q)
          ? 'HATCHBACK'
          : /deportiv/.test(q)
            ? 'SPORTS'
            : /(convertible|descapotable)/.test(q)
              ? 'CONVERTIBLE'
              : null;
  // Inicio de palabra: «cobran» no es «obra», ni «descarga» es «carga».
  const use: SmartUse | null = /\b(familia|ninos|hijos|viaje)/.test(q) ? 'family' : /\b(trabajo|carga|campo|finca|obra)/.test(q) ? 'work' : /\b(ciudad|trafico|calle|universidad|oficina)/.test(q) ? 'city' : null;
  const priority: SmartPriority | null = /\b(consumo|gaste poco|gasta poco|economico)/.test(q) ? 'fuel' : /\b(reventa|dure|duradero|confiable|repuesto)/.test(q) ? 'value' : /\b(espacio|comodo|grande|amplio)/.test(q) ? 'space' : null;
  const city = vocab.cities.find(c => q.includes(` ${normalizeText(c)} `)) ?? null;

  let year: number | null = null;
  let km: number | null = null;
  const nums: Array<{ n: number; at: number }> = [];
  const re = /(\$\s?)?(\d+(?:[.,]\d+)*)\s*(mil|k|lucas)?(\s*(km|kilometros))?/g;
  for (let m = re.exec(q); m; m = re.exec(q)) {
    const raw = m[2]!;
    const n = m[3] ? parseFloat(raw.replace(',', '.')) * 1000 : Number(raw.replace(/[.,]/g, ''));
    if (!Number.isFinite(n)) continue;
    if (m[4]) {
      km = n;
      continue;
    }
    if (!m[1] && !m[3] && n >= 1990 && n <= 2030) {
      year = n;
      continue;
    }
    if (n >= 1000) nums.push({ n, at: m.index });
  }
  let min: number | null = null;
  let max: number | null = null;
  let amount: number | null = null;
  if (/entre/.test(q) && nums.length >= 2) {
    min = Math.min(nums[0]!.n, nums[1]!.n);
    max = Math.max(nums[0]!.n, nums[1]!.n);
  } else if (nums.length) {
    const before = q.slice(Math.max(0, nums[0]!.at - 18), nums[0]!.at);
    if (/(desde|mas de|minimo|arriba de)/.test(before)) min = nums[0]!.n;
    else if (/(hasta|maximo|menos de|no mas de|tengo|presupuesto|cuento con|gastar)/.test(before)) max = nums[0]!.n;
    else amount = nums[0]!.n;
  }
  const isFair = /(justo|caro|buen precio|vale la pena|esta bien|sobreprecio|cuanto vale|cuanto cuesta|en cuanto esta|a como|precio de|promedio)/.test(q);
  const isSell = /(vend|publicar|tasar|tasa|cuanto (me )?dan|cuanto pido|mi auto|el mio)/.test(q);
  const isInfo = /(que tal|como es|opinion|me sirve|sirve para|es bueno|es buena|problemas|fallas|consumo|gasta mucho|cuanto gasta|repuestos|mantenimiento|confiable|aguanta|dura )/.test(q);
  const isQuestion = /\?/.test(text) || /^\s*(como|que |cual|cuanto|vale|es |por que|conviene)/.test(q) || isFair || isSell || isInfo;
  return {
    q,
    fixes,
    models,
    brand,
    gearbox: auto && manual ? null : auto ? 'AUTOMATIC' : manual ? 'MANUAL' : null,
    bothGearboxes: auto && manual,
    category,
    electric: /electric/.test(q),
    use,
    priority,
    city,
    year,
    km,
    min,
    max,
    amount,
    isFair,
    isSell,
    isInfo,
    isQuestion,
  };
}

/** Traducciones que se le muestran a la persona: correcciones y sinónimos. */
export function smartUnderstood(text: string, parsed: SmartParse, vocab: SmartVocabulary): string[] {
  const raw = normalizeText(text);
  const label = (word: string) => vocab.models[word]?.label ?? word.charAt(0).toUpperCase() + word.slice(1);
  const out = parsed.fixes.map(fix => `«${fix.from}» → ${label(fix.to)}`);
  for (const [re, format] of SEEN) {
    const m = raw.match(re);
    if (m) out.push(format(m[0]));
  }
  return out;
}
