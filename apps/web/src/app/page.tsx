import { COPYRIGHT_NOTICE, type DealerDirectoryEntryDTO, type VehicleCardDTO } from '@automarket/contracts';
import { ArrowRight, BadgeCheck, Building2, Check, IdCard, MapPin, MessageSquareLock, ShieldCheck, SlidersHorizontal, Star } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ContactForm } from '@/features/landing/components/ContactForm';
import { HeroSearch } from '@/features/landing/components/HeroSearch';
import { LandingHeader } from '@/features/landing/components/LandingHeader';
import { LiveCounters } from '@/features/landing/components/LiveCounters';
import { PricingSection } from '@/features/landing/components/PricingSection';
import { ScrollRow } from '@/features/landing/components/ScrollRow';
import { Showroom } from '@/features/landing/components/Showroom';
import { SocialIcons } from '@/features/landing/components/SocialIcons';
import { HOME_HERO_DEFAULT } from '@/features/landing/hero';
import { getChatFilterStats, getDealers, getLandingData, getPublicSettings } from '@/features/landing/server';
import { cn } from '@/shared/lib/cn';
import { formatDate, formatKm, formatMoney, formatNumber } from '@/shared/lib/format';
import { buttonClasses } from '@/shared/ui/button';
import { Logo } from '@/shared/ui/logo';
import { MediaImage } from '@/shared/ui/media-image';

// Cifras, showroom (el carrusel lo controla el panel), concesionarios y reseñas siempre al día.
export const dynamic = 'force-dynamic';

const SHOWROOM_MAX = 24;

const FEATURES: Array<{ icon: ReactNode; tone: 'brand' | 'gold'; title: string; text: string; points: string[] }> = [
  {
    icon: <IdCard className="size-6" strokeWidth={1.8} />,
    tone: 'brand',
    title: 'Vendedores con identidad revisada',
    text: 'Antes de publicar, cada vendedor sube su cédula, una selfie y su teléfono, y el equipo lo revisa a mano. A los concesionarios también les revisamos el RIF.',
    points: ['Documento de identidad + selfie', 'Revisión manual del equipo de AutoMarket', 'Insignia «Verificado» visible en cada anuncio'],
  },
  {
    icon: <SlidersHorizontal className="size-6" strokeWidth={1.8} />,
    tone: 'gold',
    title: 'Filtros para comparar de verdad',
    text: 'Marca, modelo, año, precio, kilometraje, caja, combustible, categoría, país y dueños anteriores. Si hoy no está, una alerta te avisa cuando aparezca.',
    points: ['Filtros por caja, combustible y categoría', 'Dueños anteriores declarados en cada ficha', 'Alertas cuando aparece el auto que buscas'],
  },
  {
    icon: <MessageSquareLock className="size-6" strokeWidth={1.8} />,
    tone: 'brand',
    title: 'Un chat sin teléfonos ni insultos',
    text: 'Los teléfonos, correos y enlaces se tapan al momento, igual que los insultos. Los datos de contacto aparecen cuando el vendedor confirma tu reserva.',
    points: ['Oculta teléfonos, correos y enlaces', 'Tapa insultos de la lista del equipo', 'Contacto directo al confirmar una reserva'],
  },
];

const FOOTER_LINKS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  {
    title: 'Plataforma',
    links: [
      { href: '/vehiculos', label: 'Autos en venta' },
      { href: '/vender', label: 'Vender mi auto' },
      { href: '/concesionarios', label: 'Concesionarios' },
      { href: '#beneficios', label: 'Seguridad' },
    ],
  },
  {
    title: 'Compañía',
    links: [
      { href: '#planes', label: 'Planes' },
      { href: '#opiniones', label: 'Opiniones' },
      { href: '#contacto', label: 'Contacto' },
    ],
  },
  {
    title: 'Ayuda',
    links: [
      { href: '/terminos#compra-segura', label: 'Compra segura' },
      { href: '/terminos#pagos-y-reembolsos', label: 'Pagos y reembolsos' },
      { href: '/terminos#reglas-para-anuncios', label: 'Reglas para anuncios' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/terminos#terminos-y-condiciones', label: 'Términos y Condiciones' },
      { href: '/terminos#politica-de-privacidad', label: 'Política de Privacidad' },
      { href: '/terminos#cookies', label: 'Política de Cookies' },
    ],
  },
];

const DEALER_TONES = ['bg-brand text-on-brand', 'bg-gold-soft text-gold-fg', 'bg-ink/10 text-ink', 'bg-soft text-brand-fg'];

const initialsOf = (name: string) =>
  name
    .replace(/\b(C\.?\s?A\.?|S\.?\s?A\.?|S\.?A\.?S\.?|LTDA\.?)\b/gi, '')
    .split(/\s+/)
    .filter(word => word && !/^(de|del|la|las|los|y|el)$/i.test(word))
    .slice(0, 2)
    .map(word => word[0]!.toUpperCase())
    .join('');

/** Encabezado de sección del index.html: rótulo con raya, titular grande y texto. */
function SectionIntro({ eyebrow, id, title, text, center = false }: { eyebrow: string; id: string; title: string; text?: string; center?: boolean }) {
  return (
    <div className={cn('max-w-2xl', center && 'mx-auto text-center')}>
      <span className="am-eyebrow">{eyebrow}</span>
      <h2 id={id} className="mt-3 font-display text-3xl font-extrabold tracking-tight text-balance sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      {text && <p className="mt-4 text-pretty text-muted sm:text-lg">{text}</p>}
    </div>
  );
}

function DealerCard({ dealer, index }: { dealer: DealerDirectoryEntryDTO; index: number }) {
  return (
    <Link href={`/vendedores/${dealer.id}`} className="group flex flex-col rounded-3xl border border-line bg-surface p-6 transition-colors hover:border-edge">
      <div className="flex items-start justify-between">
        {dealer.avatarUrl ? (
          <span className="relative size-12 overflow-hidden rounded-2xl bg-sunken">
            <MediaImage src={dealer.avatarUrl} alt="" fill sizes="48px" className="object-cover" />
          </span>
        ) : (
          <span className={cn('grid size-12 place-items-center rounded-2xl font-display text-lg font-extrabold', DEALER_TONES[index % DEALER_TONES.length])}>{initialsOf(dealer.name)}</span>
        )}
        <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-semibold text-success-fg">
          <BadgeCheck className="size-3.5" />
          Verificado
        </span>
      </div>
      <h3 className="mt-5 font-display text-lg font-bold group-hover:underline group-hover:underline-offset-4">{dealer.name}</h3>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
        <MapPin className="size-4 shrink-0" strokeWidth={1.8} />
        {[dealer.city, dealer.country].filter(Boolean).join(', ')}
      </p>
      <p className="mt-3 flex items-center gap-1 text-sm">
        {dealer.ratingAverage !== null ? (
          <>
            <Star className="size-4 fill-current text-gold" />
            <strong>{dealer.ratingAverage.toLocaleString('es', { maximumFractionDigits: 1 })}</strong>
            <span className="text-muted">
              ({formatNumber(dealer.ratingCount)} {dealer.ratingCount === 1 ? 'reseña' : 'reseñas'})
            </span>
          </>
        ) : (
          <span className="text-muted">Sin reseñas todavía</span>
        )}
      </p>
      <div className="flex-1" />
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4 text-xs text-muted">
        <span>
          <strong className="text-sm text-ink figures">{formatNumber(dealer.activeListings)}</strong> {dealer.activeListings === 1 ? 'vehículo' : 'vehículos'}
        </span>
        {dealer.brands.length > 0 && <span className="truncate">{dealer.brands.slice(0, 2).join(' · ')}</span>}
      </div>
    </Link>
  );
}

export default async function LandingPage() {
  const [{ stats, carousel, plans, reviews, latest }, settings, dealers, filter] = await Promise.all([getLandingData(), getPublicSettings(), getDealers(), getChatFilterStats()]);
  const social = settings?.socialLinks ?? [];
  // Foto grande de la portada: la que subió el panel o la predeterminada de la web.
  const heroPhoto = settings?.homeHeroUrl ?? HOME_HERO_DEFAULT;

  // Showroom: lo que el panel destaca primero y luego lo último publicado (sin repetir).
  const seen = new Set<string>();
  const showroom: VehicleCardDTO[] = [];
  for (const vehicle of [...carousel, ...latest]) {
    if (seen.has(vehicle.id) || showroom.length >= SHOWROOM_MAX) continue;
    seen.add(vehicle.id);
    showroom.push(vehicle);
  }
  const withPhoto = showroom.filter(vehicle => vehicle.coverUrl);
  const cover = withPhoto[0] ?? null;
  const closing = withPhoto[1] ?? cover;
  const topDealers = [...dealers].sort((a, b) => b.activeListings - a.activeListings || (b.ratingAverage ?? 0) - (a.ratingAverage ?? 0)).slice(0, 4);
  const dealerCountries = new Set(dealers.map(dealer => dealer.country).filter(Boolean)).size;

  return (
    <div className="min-h-dvh bg-canvas">
      <LandingHeader />

      <main id="main">
        {/* Portada: foto del panel de fondo, titular, búsqueda, cifras reales y el auto destacado. */}
        <section id="inicio" aria-labelledby="hero-title" className="relative isolate flex min-h-[100svh] items-center overflow-hidden pt-28 pb-16 lg:pt-32">
          <div aria-hidden className="absolute inset-0 -z-10">
            <div className="absolute inset-y-0 right-0 w-full lg:w-[80%]">
              <MediaImage src={heroPhoto} alt="" fill priority sizes="(min-width: 1024px) 80vw, 100vw" className="object-cover object-[60%_center] lg:object-[40%_center]" />
            </div>
            <div className="am-hero-veil absolute inset-0" />
            <div className="am-grid-pattern absolute inset-0" />
          </div>

          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="inline-flex items-center gap-2.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-muted sm:text-sm">
                <span className="size-2 rounded-full bg-brand-fg" aria-hidden />
                {stats && stats.vehicles > 0
                  ? `${formatNumber(stats.vehicles)} ${stats.vehicles === 1 ? 'auto de vendedor verificado' : 'autos de vendedores verificados'}`
                  : 'Vendedores verificados con cédula y selfie'}
              </p>

              <h1 id="hero-title" className="mt-6 font-display text-[2.6rem] leading-[1.04] font-extrabold tracking-tight sm:text-6xl lg:text-7xl">
                Compra tu próximo auto sabiendo <span className="text-brand-fg">con quién tratas</span>
              </h1>

              <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
                Antes de publicar, cada vendedor muestra su cédula y una selfie. El chat oculta teléfonos y correos hasta que el vendedor confirma tu reserva, y el abono se lo pagas directo a él.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/vehiculos" className={buttonClasses({ size: 'lg', className: 'h-14 px-7 text-base' })}>
                  Ver autos en venta <ArrowRight className="size-5" />
                </Link>
                <Link href="/vender" className={buttonClasses({ variant: 'outline', size: 'lg', className: 'h-14 px-7 text-base' })}>
                  <BadgeCheck className="size-5 text-gold-fg" /> Vender mi auto
                </Link>
              </div>

              <HeroSearch />
              <LiveCounters initial={stats} dealers={dealers.length} rating={reviews.average} />
            </div>
          </div>

          {/* Tarjeta del auto destacado, con su propia foto (la de fondo es la del panel). */}
          {cover && (
            <div className="absolute right-6 bottom-16 hidden w-72 lg:block xl:right-16">
              <div className="overflow-hidden rounded-2xl border border-white/12 bg-[#0d0f0e]/90 p-4 text-white shadow-[0_24px_48px_-24px_rgb(0_0_0/0.7)]">
                {cover.coverUrl && (
                  <Link href={`/vehiculos/${cover.slug}`} tabIndex={-1} aria-hidden className="relative -mx-4 -mt-4 mb-3.5 block aspect-[16/9] overflow-hidden bg-black/40">
                    <MediaImage src={cover.coverUrl} alt="" fill sizes="288px" className="object-cover" />
                  </Link>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {cover.sellerVerified && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#2f7a4f] px-2.5 py-[0.32rem] text-[11px] leading-none font-semibold text-white">
                      <BadgeCheck className="size-[13px]" /> Verificado
                    </span>
                  )}
                  {cover.isFeatured && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#efe3c8] px-2.5 py-[0.32rem] text-[11px] leading-none font-semibold text-[#4a360c]">
                      <Star className="size-[13px] fill-current" /> Destacado
                    </span>
                  )}
                </div>
                <p className="mt-3 text-xs text-white/70">
                  {cover.make} · {cover.year} · {formatKm(cover.mileageKm)}
                </p>
                <p className="font-display text-lg font-bold">
                  {cover.model}
                  {cover.version ? ` ${cover.version}` : ''}
                </p>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <p className="font-display text-xl font-extrabold figures">{formatMoney(cover.price, cover.currency)}</p>
                  <Link href={`/vehiculos/${cover.slug}`} className="inline-flex h-8 items-center rounded-full bg-white px-3.5 text-xs font-semibold text-[#0b0d0c] hover:bg-white/90">
                    Ver ficha
                  </Link>
                </div>
              </div>
            </div>
          )}

          <a href="#vehiculos" aria-label="Bajar al showroom" className="am-scroll-cue absolute bottom-6 left-1/2 -translate-x-1/2 flex-col items-center gap-2 text-xs text-muted transition-colors hover:text-ink">
            <span className="flex h-9 w-6 justify-center rounded-full border border-line pt-1.5">
              <span className="h-2 w-1 rounded-full bg-brand-fg motion-safe:animate-bounce" />
            </span>
          </a>
        </section>

        {/* Showroom. */}
        <section id="vehiculos" aria-labelledby="showroom-title" className="relative scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <SectionIntro
                eyebrow="Showroom"
                id="showroom-title"
                title="Autos destacados"
                text="De vendedores verificados, con ficha completa y dueños anteriores declarados."
              />
              <Link href="/vehiculos" className={buttonClasses({ variant: 'outline', className: 'self-start px-5 lg:self-auto' })}>
                Ver catálogo completo <ArrowRight className="size-4" />
              </Link>
            </div>
            {showroom.length > 0 ? (
              <Showroom vehicles={showroom} />
            ) : (
              <div className="mt-10 rounded-3xl border border-dashed border-line bg-surface px-6 py-16 text-center">
                <p className="font-display text-lg font-bold">Aún no hay autos publicados</p>
                <p className="mt-1 text-sm text-muted">El primero que se publique aparece aquí, con su foto y su precio.</p>
                <Link href="/vender" className={buttonClasses({ size: 'sm', className: 'mt-6 px-5' })}>
                  Publicar un auto
                </Link>
              </div>
            )}
          </div>
        </section>

        {/* Seguridad y confianza. */}
        <section id="beneficios" aria-labelledby="benefits-title" className="relative scroll-mt-20 overflow-hidden bg-sunken py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionIntro
              center
              eyebrow="Cómo te cuidamos"
              id="benefits-title"
              title="Antes de que hables con un vendedor"
              text="Esto ya lo revisamos nosotros. A ti te toca elegir el auto."
            />
            <div className="mt-14 grid gap-6 lg:grid-cols-3">
              {FEATURES.map(feature => (
                <article key={feature.title} className="rounded-3xl border border-line bg-surface p-7 transition-colors hover:border-edge sm:p-8">
                  <div className={cn('grid size-12 place-items-center rounded-2xl', feature.tone === 'gold' ? 'bg-gold-soft text-gold-fg' : 'bg-brand text-on-brand')}>{feature.icon}</div>
                  <h3 className="mt-6 font-display text-xl font-bold">{feature.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{feature.text}</p>
                  <ul className="mt-6 space-y-3 text-sm">
                    {feature.points.map(point => (
                      <li key={point} className="flex gap-3">
                        <Check className={cn('mt-0.5 size-4 shrink-0', feature.tone === 'gold' ? 'text-gold-fg' : 'text-brand-fg')} strokeWidth={2.2} />
                        {point}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            {filter && (
              <div className="mt-6 grid gap-8 rounded-3xl border border-line bg-surface p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:items-center lg:gap-10">
                <div>
                  <span className="am-eyebrow">Últimos {filter.days} días</span>
                  <h3 className="mt-3 font-display text-2xl font-bold">Lo que hizo el filtro en los chats</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {filter.messages > 0
                      ? `Cifras de ${formatNumber(filter.conversations)} ${filter.conversations === 1 ? 'conversación real' : 'conversaciones reales'} entre compradores y vendedores; se cuentan solas con las marcas que deja el filtro.`
                      : 'Todavía no hay conversaciones este mes. Cuando las haya, aquí verás lo que el filtro ocultó.'}
                  </p>
                </div>
                <dl className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: filter.messages === 1 ? 'mensaje revisado' : 'mensajes revisados', value: filter.messages, tone: 'text-ink' },
                    { label: filter.contactHidden === 1 ? 'mensaje con datos de contacto ocultos' : 'mensajes con datos de contacto ocultos', value: filter.contactHidden, tone: 'text-brand-fg' },
                    { label: filter.profanityHidden === 1 ? 'mensaje con palabras ofensivas tapadas' : 'mensajes con palabras ofensivas tapadas', value: filter.profanityHidden, tone: 'text-gold-fg' },
                  ].map(item => (
                    <div key={item.label} className="flex flex-col-reverse justify-end gap-1 rounded-2xl border border-line bg-sunken p-5">
                      <dt className="text-xs leading-snug text-muted">{item.label}</dt>
                      <dd className={cn('font-display text-3xl font-extrabold figures', item.tone)}>{formatNumber(item.value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </section>

        {/* Concesionarios aliados (datos reales del directorio). */}
        <section id="concesionarios" aria-labelledby="dealers-title" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <SectionIntro
                eyebrow="Red de concesionarios"
                id="dealers-title"
                title="Concesionarios con RIF revisado"
                text={
                  dealers.length > 0
                    ? `${formatNumber(dealers.length)} ${dealers.length === 1 ? 'agencia' : 'agencias'} con sus documentos revisados por el equipo${dealerCountries > 1 ? `, en ${dealerCountries} países` : ''}.`
                    : 'Agencias con sus documentos revisados por el equipo, con inventario y reseñas a la vista.'
                }
              />
              {dealers.length > 4 && (
                <Link href="/concesionarios" className={buttonClasses({ variant: 'outline', className: 'self-start px-5 lg:self-auto' })}>
                  Ver todos <ArrowRight className="size-4" />
                </Link>
              )}
            </div>

            {topDealers.length > 0 && (
              <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {topDealers.map((dealer, index) => (
                  <DealerCard key={dealer.id} dealer={dealer} index={index} />
                ))}
              </div>
            )}

            <div className="mt-6 flex flex-col items-start justify-between gap-6 rounded-3xl border border-line bg-surface p-6 sm:p-8 md:flex-row md:items-center">
              <div className="flex items-start gap-4">
                <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gold-soft text-gold-fg">
                  <Building2 className="size-6" strokeWidth={1.8} />
                </div>
                <div>
                  <h3 className="font-display text-xl font-bold">¿Eres concesionario?</h3>
                  <p className="mt-1 max-w-xl text-sm text-muted">Publica tu inventario, atiende a los compradores desde un panel y mira cuántas vistas y contactos tiene cada auto.</p>
                </div>
              </div>
              <Link href="/registro?tipo=concesionario" className={buttonClasses({ variant: 'gold', className: 'px-6' })}>
                Unirme como concesionario
              </Link>
            </div>
          </div>
        </section>

        {plans.length > 0 && (
          <section id="planes" aria-labelledby="planes-title" className="scroll-mt-20 bg-sunken py-20 sm:py-28">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <SectionIntro eyebrow="Planes" id="planes-title" title="Publicar es gratis" text="Con un plan publicas más autos, duran más y pagas menos comisión al vender." />
              <div className="mt-12">
                <PricingSection plans={plans} />
              </div>
            </div>
          </section>
        )}

        <section id="opiniones" aria-labelledby="opiniones-title" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <SectionIntro
                eyebrow="Opiniones"
                id="opiniones-title"
                title="Lo que dicen quienes ya la usan"
                text={
                  reviews.average !== null
                    ? `${reviews.average.toLocaleString('es', { maximumFractionDigits: 1 })} de 5, según ${formatNumber(reviews.total)} ${reviews.total === 1 ? 'reseña verificada' : 'reseñas verificadas'}.`
                    : 'Las reseñas las escriben usuarios con cuenta y el equipo las revisa antes de publicarlas.'
                }
              />
              <Link href="/cuenta/perfil#opinion" className={buttonClasses({ variant: 'outline', className: 'self-start px-5 lg:self-auto' })}>
                Escribir una reseña
              </Link>
            </div>
            {reviews.items.length > 0 ? (
              <div className="mt-12">
                <ScrollRow label="Opiniones de usuarios" count={reviews.items.length}>
                  {reviews.items.map(review => (
                    <figure key={review.id} className="flex w-[82cqw] max-w-[26rem] shrink-0 snap-start flex-col rounded-3xl border border-line bg-surface p-6 sm:w-[46cqw] sm:max-w-none lg:w-[31cqw]">
                      <div className="flex gap-0.5 text-gold" role="img" aria-label={`${review.rating} de 5 estrellas`}>
                        {[1, 2, 3, 4, 5].map(value => (
                          <Star key={value} className={cn('size-4', value <= review.rating ? 'fill-current' : 'text-line')} strokeWidth={1.5} />
                        ))}
                      </div>
                      <blockquote className="mt-4 flex-1 text-[17px] leading-snug text-pretty">«{review.comment}»</blockquote>
                      <figcaption className="mt-5 flex items-center gap-3 text-sm">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-soft text-xs font-bold text-brand-fg">{initialsOf(review.author)}</span>
                        <span>
                          <span className="block font-semibold">{review.author}</span>
                          <span className="text-xs text-muted">
                            {review.city ? `${review.city} · ` : ''}
                            {formatDate(review.createdAt)}
                          </span>
                        </span>
                      </figcaption>
                    </figure>
                  ))}
                </ScrollRow>
              </div>
            ) : (
              <div className="mt-12 rounded-3xl border border-dashed border-line bg-surface px-6 py-12 text-center">
                <p className="font-display text-lg font-bold">Todavía no hay opiniones</p>
                <p className="mt-1 text-sm text-muted">Si ya compraste o vendiste por aquí, cuéntanos cómo te fue.</p>
              </div>
            )}
          </div>
        </section>

        <section id="contacto" aria-labelledby="contacto-title" className="scroll-mt-20 bg-sunken py-20 sm:py-28">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:px-8">
            <div>
              <SectionIntro eyebrow="Contacto" id="contacto-title" title="Escríbenos" text="Agencias, alianzas o algo con tu cuenta. Respondemos en un día hábil." />
              <div className="mt-10 rounded-3xl border border-line bg-surface p-6">
                <p className="font-display text-lg font-bold">¿Vendes autos todos los meses?</p>
                <p className="mt-1 text-sm text-muted">El plan Pro para concesionarios no tiene límite de anuncios ni comisión por venta.</p>
                <a href="#planes" className="link mt-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                  Ver el plan Pro <ArrowRight className="size-4" />
                </a>
              </div>
            </div>
            <div className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
              <ContactForm />
            </div>
          </div>
        </section>

        {/* Cierre: reservar con abono directo al vendedor (sustituye el adelanto 3D, que ya no existe). */}
        <section aria-labelledby="cta-title" className="py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="relative isolate overflow-hidden rounded-[2rem] border border-line bg-surface px-6 py-14 sm:px-12 lg:py-20">
              {closing?.coverUrl && (
                <div aria-hidden className="absolute inset-y-0 right-0 -z-10 hidden w-3/5 [mask-image:linear-gradient(90deg,transparent,#000_45%)] md:block">
                  <MediaImage src={closing.coverUrl} alt="" fill sizes="60vw" className="object-cover opacity-90" />
                </div>
              )}
              <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-surface via-surface/85 to-transparent" />
              <div className="max-w-xl">
                <span className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold-soft px-3 py-1 text-xs font-semibold text-gold-fg">
                  <ShieldCheck className="size-4" /> Reserva segura
                </span>
                <h2 id="cta-title" className="mt-5 font-display text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
                  Aparta tu próximo auto con un abono que va directo al vendedor
                </h2>
                <p className="mt-4 text-pretty text-muted sm:text-lg">
                  El abono se descuenta del precio y, si la venta no se da, el vendedor te lo devuelve. Mientras dure la reserva, nadie más puede apartarlo.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link href="/registro" className={buttonClasses({ size: 'lg', className: 'px-7' })}>
                    Crear cuenta gratis
                  </Link>
                  <Link href="/vehiculos" className={buttonClasses({ variant: 'outline', size: 'lg', className: 'px-7' })}>
                    Ver autos en venta
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer aria-labelledby="footer-title" className="border-t border-line bg-sunken">
        <h2 id="footer-title" className="sr-only">
          Pie de página
        </h2>
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <Logo href="/" />
              <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted">Autos de particulares y concesionarios que mostraron su cédula antes de publicar.</p>
              <SocialIcons links={social} className="mt-6" />
            </div>
            <nav aria-label="Enlaces del pie de página" className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:col-span-8">
              {FOOTER_LINKS.map(column => (
                <div key={column.title}>
                  <h3 className="text-sm font-semibold">{column.title}</h3>
                  <ul className="mt-4 space-y-3 text-sm text-muted">
                    {column.links.map(link => (
                      <li key={link.href}>
                        <Link href={link.href} className="transition-colors hover:text-ink">
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
          <div className="mt-14 flex flex-col gap-4 border-t border-line pt-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
            <p>{COPYRIGHT_NOTICE}</p>
            <p className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-success-fg" />
              Los abonos se pagan directo al vendedor
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
