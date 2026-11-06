import { AppError } from '../errors/app-error.js';
import { prisma } from '../infra/prisma.js';

/**
 * Lista negra global de términos (tabla blocked_terms, editable desde el panel).
 * Se aplica a chats, perfiles, anuncios, búsquedas, reseñas, reportes y contacto. Detecta variantes con
 * acentos, mayúsculas, leetspeak («1d10t4») y letras repetidas («idiooota»).
 */

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };
const WORD = /[\p{L}\p{N}@$]+/gu;
const CACHE_TTL_MS = 60_000;

/** Misma normalización para los términos y para el texto analizado. */
export const normalizeWord = (word: string) =>
  word
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[013457@$]/g, char => LEET[char] ?? char)
    .replace(/(.)\1+/g, '$1');

export interface Blocklist {
  /** Sustituye cada término por «•••» conservando el resto del texto. */
  mask(text: string): { text: string; matched: boolean };
  /** Términos encontrados (normalizados). */
  find(text: string): string[];
}

function compile(terms: string[]): Blocklist {
  // Cada término es una secuencia de palabras normalizadas ("hijo de puta" → 3 palabras).
  const phrases = terms.map(term => (term.match(WORD) ?? []).map(normalizeWord)).filter(words => words.length > 0);
  const byFirstWord = new Map<string, string[][]>();
  for (const words of phrases) {
    const list = byFirstWord.get(words[0]!) ?? [];
    list.push(words);
    byFirstWord.set(words[0]!, list.sort((a, b) => b.length - a.length));
  }

  /** Coincidencias como rangos [inicio, fin) sobre el texto original. */
  const scan = (text: string) => {
    const tokens = [...text.matchAll(WORD)].map(match => ({ start: match.index, end: match.index + match[0].length, norm: normalizeWord(match[0]) }));
    const hits: Array<{ start: number; end: number; term: string }> = [];
    for (let i = 0; i < tokens.length; i++) {
      for (const words of byFirstWord.get(tokens[i]!.norm) ?? []) {
        const window = tokens.slice(i, i + words.length);
        if (window.length === words.length && window.every((token, k) => token.norm === words[k])) {
          hits.push({ start: window[0]!.start, end: window.at(-1)!.end, term: words.join(' ') });
          i += words.length - 1;
          break;
        }
      }
    }
    return hits;
  };

  return {
    find: text => [...new Set(scan(text).map(hit => hit.term))],
    mask(text) {
      const hits = scan(text);
      if (hits.length === 0) return { text, matched: false };
      let out = '';
      let cursor = 0;
      for (const hit of hits) {
        out += text.slice(cursor, hit.start) + '•'.repeat(Math.max(3, hit.end - hit.start));
        cursor = hit.end;
      }
      return { text: out + text.slice(cursor), matched: true };
    },
  };
}

let cache: { list: Blocklist; expiresAt: number } | null = null;
let loading: Promise<Blocklist> | null = null;

/** Lista compilada con caché de 60 s (las altas del panel invalidan al instante en esta instancia). */
export async function getBlocklist(): Promise<Blocklist> {
  if (cache && cache.expiresAt > Date.now()) return cache.list;
  loading ??= prisma.blockedTerm
    .findMany({ select: { term: true } })
    .then(rows => {
      const list = compile(rows.map(row => row.term));
      cache = { list, expiresAt: Date.now() + CACHE_TTL_MS };
      return list;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function invalidateBlocklist(): void {
  cache = null;
}

/**
 * Rechaza textos enviados por usuarios con términos bloqueados.
 * En el chat, en cambio, se enmascaran (`mask`) para no cortar la conversación.
 */
export async function assertNoBlockedTerms(fields: Record<string, string | null | undefined>): Promise<void> {
  const blocklist = await getBlocklist();
  const offending = Object.entries(fields)
    .filter(([, value]) => typeof value === 'string' && blocklist.find(value).length > 0)
    .map(([field]) => field);
  if (offending.length > 0) {
    throw AppError.badRequest('BLOCKED_TERMS', 'El texto contiene palabras no permitidas. Revísalo y vuelve a intentarlo.', { fields: offending });
  }
}
