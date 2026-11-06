'use client';

import type { TermsDTO } from '@automarket/contracts';
import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi } from '@/features/auth';
import { cn } from '@/shared/lib/cn';
import { DEFAULT_CONSENT, readConsent, saveConsent, type CookieConsent } from '@/shared/lib/cookie-consent';
import { normalizeSearch, parseLegalDocs, sectionText, type LegalBlock } from '@/shared/lib/legal-docs';
import { useSession } from '@/shared/lib/use-session';
import { useToast } from '@/shared/ui/toaster';

const longDate = (iso: string) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

/** «**negrita**» dentro de una línea. React escapa el resto: nunca se inyecta HTML. */
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>,
  );
}

function Blocks({ blocks, className }: { blocks: LegalBlock[]; className?: string }) {
  const groups: Array<{ kind: 'p'; text: string } | { kind: 'ul'; items: string[] }> = [];
  for (const block of blocks) {
    const last = groups.at(-1);
    if (block.kind === 'li') {
      if (last?.kind === 'ul') last.items.push(block.text);
      else groups.push({ kind: 'ul', items: [block.text] });
    } else groups.push({ kind: 'p', text: block.text });
  }
  return groups.map((group, index) =>
    group.kind === 'ul' ? (
      <ul key={index} className={cn('m-0 grid list-disc gap-1 pl-5', className)}>
        {group.items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>
    ) : (
      <p key={index} className={cn('m-0', className)}>
        {inline(group.text)}
      </p>
    ),
  );
}

/**
 * Centro legal (diseño «terminos-pc»): los documentos que publica el administrador, con
 * buscador dentro del texto, imprimir / guardar en PDF y las preferencias de cookies.
 */
export function TermsCenter({ terms }: { terms: TermsDTO }) {
  const docs = useMemo(() => parseLegalDocs(terms.content), [terms.content]);
  const [docKey, setDocKey] = useState(docs[0]?.key ?? '');
  const [query, setQuery] = useState('');
  const session = useSession();
  const toast = useToast();

  // Enlace directo a un documento: /terminos#cookies, /terminos#politica-de-privacidad…
  useEffect(() => {
    const fromHash = decodeURIComponent(window.location.hash.slice(1));
    if (fromHash && docs.some(doc => doc.key === fromHash)) setDocKey(fromHash);
  }, [docs]);

  const choose = (key: string) => {
    setDocKey(key);
    window.history.replaceState(null, '', `#${key}`);
  };

  const needle = normalizeSearch(query);
  const searching = needle.length >= 3;
  const matches = useMemo(
    () => new Map(docs.map(doc => [doc.key, searching ? doc.sections.map(section => sectionText(section).includes(needle)) : doc.sections.map(() => false)])),
    [docs, needle, searching],
  );
  const doc = docs.find(item => item.key === docKey) ?? docs[0];
  const docMatches = doc ? (matches.get(doc.key) ?? []) : [];

  const user = session.status === 'authenticated' ? session.user : null;
  const acceptedCurrent = user?.termsAcceptedAt != null && (terms.updatedAt === null || user.termsAcceptedAt >= terms.updatedAt);
  const isAdmin = user !== null && ['ADMIN', 'ADMIN_ONE'].includes(user.role);

  const print = () => {
    try {
      window.print();
    } catch {
      toast({ tone: 'info', title: 'Usa Imprimir → Guardar como PDF.' });
    }
  };

  return (
    <div className="mx-auto grid max-w-[1180px] gap-[18px] px-5 pt-7 pb-16 sm:px-[clamp(20px,3vw,40px)] print:max-w-none print:p-0">
      <div className="flex flex-wrap items-end justify-between gap-3.5">
        <div>
          <h1 className="m-0 text-[clamp(28px,4vw,36px)] leading-tight font-extrabold tracking-[-0.03em] text-ink">Términos y políticas</h1>
          <p className="mt-1 text-[15px] text-muted">
            {terms.updatedAt ? `Última actualización: ${longDate(terms.updatedAt)}` : 'Versión inicial de AutoMarket'}
            {acceptedCurrent && user?.termsAcceptedAt && ` · Aceptaste esta versión el ${longDate(user.termsAcceptedAt)}.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <label htmlFor="terms-q" className="sr-only">
            Buscar en los términos
          </label>
          <input
            id="terms-q"
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Buscar: abono, datos, reembolso…"
            className="box-border h-[46px] w-[260px] max-w-full rounded-full border border-edge bg-surface px-4 text-[14.5px] font-medium text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
          />
          <button type="button" onClick={print} className="h-[46px] rounded-full border border-edge bg-surface px-4 text-sm font-bold text-ink hover:border-ink">
            Descargar PDF
          </button>
        </div>
      </div>

      {isAdmin && terms.updatedAt === null && (
        <p className="m-0 rounded-[14px] bg-gold-soft px-3.5 py-3 text-[13.5px] leading-[1.45] text-gold-fg print:hidden">
          Texto inicial de AutoMarket (este aviso solo lo ve el equipo). Antes de usarlo, revísalo con un abogado del país donde opera AutoMarket. Lo cambias desde{' '}
          <Link href="/admin/sitio" className="font-bold underline underline-offset-2">
            Portada, login y Términos
          </Link>
          .
        </p>
      )}

      {user && !acceptedCurrent && <AcceptBanner neverAccepted={user.termsAcceptedAt === null} updatedAt={terms.updatedAt} />}

      {doc ? (
        <div className="grid items-start gap-5 md:grid-cols-[260px_minmax(0,1fr)] print:block">
          <nav aria-label="Documentos" className="scrollbar-none flex gap-0.5 overflow-x-auto rounded-[22px] border border-line bg-surface p-2.5 md:sticky md:top-5 md:grid print:hidden">
            {docs.map(item => {
              const count = (matches.get(item.key) ?? []).filter(Boolean).length;
              const selected = item.key === doc.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => choose(item.key)}
                  className={cn(
                    'flex min-h-11 shrink-0 items-center justify-between gap-2 rounded-xl px-3 text-left text-sm whitespace-nowrap text-ink md:whitespace-normal',
                    selected ? 'bg-tile font-extrabold' : 'font-semibold hover:bg-tile/60',
                  )}
                >
                  {item.title}
                  {count > 0 && (
                    <span className="grid h-[22px] min-w-[22px] place-items-center rounded-full bg-brand px-1.5 font-mono text-[11px] font-semibold text-on-brand" aria-label={`${count} ${count === 1 ? 'sección coincide' : 'secciones coinciden'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <article key={doc.key} className="am-step-in grid gap-[18px] rounded-[22px] border border-line bg-surface px-[clamp(20px,3vw,36px)] py-[26px] print:border-0 print:p-0">
            <h2 className="m-0 text-[26px] leading-tight font-extrabold tracking-[-0.02em] text-ink">{doc.title}</h2>
            {doc.intro.length > 0 && (
              <div className="-mt-2 grid gap-2">
                <Blocks blocks={doc.intro} className="text-[15px] leading-[1.55] text-ink/80" />
              </div>
            )}
            {doc.sections.map((section, index) => (
              <section key={index} className={cn('grid gap-1.5 rounded-[14px]', docMatches[index] && 'bg-gold-soft px-3.5 py-3')}>
                <h3 className="m-0 text-[17px] font-extrabold text-ink">
                  {index + 1}. {inline(section.heading)}
                </h3>
                <Blocks blocks={section.blocks} className="text-[15px] leading-[1.6] text-ink" />
              </section>
            ))}
            {doc.cookies && <CookiePreferences />}
            {searching && !docMatches.some(Boolean) && (
              <p className="m-0 text-[14.5px] text-muted">No encontramos «{query.trim()}» en este documento. Prueba en otro de la lista.</p>
            )}
            <p className="m-0 border-t border-line pt-3.5 text-[13.5px] text-muted">
              ¿Dudas? Escríbenos desde el{' '}
              <Link href="/#contacto" className="font-semibold text-ink underline underline-offset-2">
                formulario de contacto
              </Link>{' '}
              y te respondemos por correo.
            </p>
          </article>
        </div>
      ) : (
        <p className="text-muted">Aún no hay términos publicados.</p>
      )}
    </div>
  );
}

function AcceptBanner({ neverAccepted, updatedAt }: { neverAccepted: boolean; updatedAt: string | null }) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const accept = async () => {
    setPending(true);
    try {
      await authApi.acceptTerms();
      toast({ tone: 'success', title: 'Aceptaste la versión vigente.' });
    } catch (error) {
      toast({ tone: 'error', title: 'No se pudo guardar', description: error instanceof Error ? error.message : undefined });
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-gold-soft px-3.5 py-3 print:hidden">
      <p className="m-0 text-[13.5px] leading-[1.45] text-gold-fg">
        {neverAccepted
          ? 'Todavía no aceptaste estos términos. Léelos y, si estás de acuerdo, acéptalos.'
          : `Los términos cambiaron${updatedAt ? ` el ${longDate(updatedAt)}` : ''}, después de que los aceptaste. Revisa esta versión y acéptala.`}
      </p>
      <button type="button" disabled={pending} onClick={accept} className="h-10 rounded-full bg-brand px-4 text-sm font-bold text-on-brand hover:bg-brand-600 disabled:opacity-60">
        Aceptar esta versión
      </button>
    </div>
  );
}

function CookiePreferences() {
  const toast = useToast();
  const [consent, setConsent] = useState<CookieConsent>(DEFAULT_CONSENT);
  // Lo guardado en este navegador (cookie o localStorage); sin elección, los valores por defecto.
  useEffect(() => setConsent(readConsent()), []);

  const save = () => {
    saveConsent(consent);
    toast({ tone: 'success', title: 'Preferencias guardadas.' });
  };

  return (
    <div aria-label="Tus preferencias de cookies" role="group" className="grid gap-2.5 rounded-2xl border border-line p-4 print:hidden">
      <p className="m-0 text-base font-extrabold text-ink">Tus preferencias</p>
      <CookieRow name="Necesarias" description="Sesión y seguridad. Siempre activas." checked fixed />
      <CookieRow name="Preferencias" description="Modo oscuro y emojis recientes del chat." checked={consent.pref} onChange={pref => setConsent(value => ({ ...value, pref }))} />
      <CookieRow name="Medición" description="Uso de páginas, sin identificarte. Hoy no usamos ninguna." checked={consent.measure} onChange={measure => setConsent(value => ({ ...value, measure }))} />
      <button type="button" onClick={save} className="h-11 justify-self-start rounded-full bg-brand px-[18px] text-sm font-bold text-on-brand hover:bg-brand-600">
        Guardar preferencias
      </button>
    </div>
  );
}

function CookieRow({ name, description, checked, fixed = false, onChange }: { name: string; description: string; checked: boolean; fixed?: boolean; onChange?: (value: boolean) => void }) {
  const id = `cookie-${name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')}`;
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <span id={id} className="block text-[14.5px] font-bold text-ink">
          {name}
        </span>
        <span className="text-[13px] text-muted">{description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={fixed}
        onClick={() => onChange?.(!checked)}
        className={cn('relative h-7 w-[46px] shrink-0 rounded-full transition-colors disabled:opacity-60', checked ? 'bg-brand' : 'bg-edge')}
      >
        <span aria-hidden className={cn('absolute top-[3px] left-[3px] size-[22px] rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none', checked && 'translate-x-[18px]')} />
      </button>
    </div>
  );
}
