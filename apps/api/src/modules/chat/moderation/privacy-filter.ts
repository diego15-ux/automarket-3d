import type { Blocklist } from '../../../shared/moderation/blocklist.js';

/**
 * Filtro automático de privacidad y lenguaje para el chat.
 * - Oculta emails, teléfonos y enlaces (evita fraudes y que la negociación salga
 *   de la plataforma) salvo que exista una reserva aceptada.
 * - Enmascara los términos de la lista negra global (panel de administración),
 *   aunque se escriban con acentos, repeticiones o leetspeak.
 */

export type ModerationFlag = 'EMAIL' | 'PHONE' | 'URL' | 'PROFANITY';

export interface ModerationResult {
  text: string;
  flags: ModerationFlag[];
}

const CONTACT_DETECTORS: ReadonlyArray<readonly [Exclude<ModerationFlag, 'PROFANITY'>, RegExp, string]> = [
  ['EMAIL', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email oculto]'],
  ['URL', /\b(?:https?:\/\/|www\.)\S+/gi, '[enlace oculto]'],
  ['PHONE', /\+?\d[\d\s().-]{6,}\d/g, '[teléfono oculto]'],
];

const MIN_PHONE_DIGITS = 8; // por debajo son precios, años o kilometraje

export function moderateText(input: string, { allowContactInfo = false, blocklist }: { allowContactInfo?: boolean; blocklist: Blocklist }): ModerationResult {
  const flags = new Set<ModerationFlag>();
  let text = input;

  if (!allowContactInfo) {
    for (const [flag, pattern, label] of CONTACT_DETECTORS) {
      text = text.replace(pattern, match => {
        if (flag === 'PHONE' && (match.match(/\d/g)?.length ?? 0) < MIN_PHONE_DIGITS) return match;
        flags.add(flag);
        return label;
      });
    }
  }

  const masked = blocklist.mask(text);
  if (masked.matched) flags.add('PROFANITY');

  return { text: masked.text, flags: [...flags] };
}
