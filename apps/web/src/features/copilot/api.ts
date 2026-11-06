import type { CopilotAskInput, CopilotReplyDTO } from '@automarket/contracts';
import { api } from '@/shared/lib/http';

/** Copiloto del comprador: cada mensaje va a la API, que responde con los anuncios reales. */
export const copilotApi = {
  ask: (input: CopilotAskInput) => api.post<CopilotReplyDTO>('/api/vehicles/copilot', input),
};

/** Abre el Copiloto desde cualquier parte (p. ej. la ficha) y, si se indica, envía una pregunta. */
export const COPILOT_EVENT = 'am:copilot';
export function openCopilot(text?: string) {
  window.dispatchEvent(new CustomEvent(COPILOT_EVENT, { detail: { text } }));
}

const YES = new Set(['si', 'sii', 'siii', 'si dale', 'dale', 'dale si', 'ok', 'okay', 'okey', 'va', 'vale', 'claro', 'claro que si', 'listo', 'de una', 'perfecto', 'si por favor', 'por favor', 'hagamoslo', 'adelante', 'bueno', 'si claro', 'si quiero', 'yes']);

/**
 * «Sí», «dale», «ok»…: la persona acepta la pregunta con la que cerró la respuesta. Esa pregunta
 * siempre corresponde a la primera opción, así que el chat ejecuta esa opción.
 */
export function isYes(text: string) {
  const plain = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return YES.has(plain);
}
