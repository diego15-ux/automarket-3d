/**
 * Preferencias de cookies (Política de cookies): «Necesarias» siempre; «Preferencias» y
 * «Medición» opcionales. Se guardan en este navegador (cookie propia + localStorage).
 * Sin elección guardada: Preferencias encendidas y Medición apagada (valores del diseño).
 */
export interface CookieConsent {
  pref: boolean;
  measure: boolean;
}

const KEY = 'automarket-cookies';
export const DEFAULT_CONSENT: CookieConsent = { pref: true, measure: false };
/** Lo que se guarda solo como «Preferencias»: se borra al apagarlas. */
export const PREFERENCE_KEYS = ['am-theme', 'automarket:recent-emojis'];

export function readConsent(): CookieConsent {
  try {
    const fromCookie = document.cookie.split('; ').find(row => row.startsWith(`${KEY}=`))?.slice(KEY.length + 1);
    const raw = fromCookie ? decodeURIComponent(fromCookie) : localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CONSENT;
    const value = JSON.parse(raw) as Partial<CookieConsent>;
    return { pref: value.pref !== false, measure: value.measure === true };
  } catch {
    return DEFAULT_CONSENT;
  }
}

export function saveConsent(consent: CookieConsent) {
  const value = JSON.stringify({ pref: consent.pref, measure: consent.measure });
  try {
    localStorage.setItem(KEY, value);
    if (!consent.pref) for (const key of PREFERENCE_KEYS) localStorage.removeItem(key);
  } catch {
    // modo privado sin almacenamiento: queda la cookie
  }
  document.cookie = `${KEY}=${encodeURIComponent(value)}; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
}

/** ¿Se pueden guardar preferencias (tema, emojis recientes) en este navegador? */
export const preferencesAllowed = () => (typeof document === 'undefined' ? true : readConsent().pref);
