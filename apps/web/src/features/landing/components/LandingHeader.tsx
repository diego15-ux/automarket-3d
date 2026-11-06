'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { UserMenu } from '@/features/auth';
import { cn } from '@/shared/lib/cn';
import { useSession } from '@/shared/lib/use-session';
import { buttonClasses } from '@/shared/ui/button';
import { Logo } from '@/shared/ui/logo';
import { ThemeToggle } from '@/shared/ui/theme-toggle';

const NAV = [
  { id: 'inicio', label: 'Inicio' },
  { id: 'vehiculos', label: 'Vehículos' },
  { id: 'beneficios', label: 'Beneficios' },
  { id: 'concesionarios', label: 'Concesionarios' },
];

/** Cabecera fija de la portada: transparente sobre la foto y con fondo al bajar, como el index.html. */
export function LandingHeader() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState('inicio');

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Marca en el menú la sección que se está viendo.
  useEffect(() => {
    const sections = NAV.map(item => document.getElementById(item.id)).filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: [0, 0.25, 0.5] },
    );
    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const guest = session.status !== 'authenticated';

  return (
    <header className={cn('fixed inset-x-0 top-0 z-40 border-b transition-colors duration-300', scrolled || open ? 'border-line bg-canvas' : 'border-transparent bg-canvas/75')}>
      <nav aria-label="Principal" className="mx-auto flex h-[72px] max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Logo href="/" />

        <ul className="mx-auto hidden items-center gap-1 lg:flex">
          {NAV.map(item => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={active === item.id ? 'true' : undefined}
                className={cn(
                  'relative rounded-full px-3.5 py-2 text-sm font-medium transition-colors hover:bg-ink/5 hover:text-ink',
                  active === item.id ? 'text-ink after:absolute after:bottom-0.5 after:left-1/2 after:h-0.5 after:w-4 after:-translate-x-1/2 after:rounded-full after:bg-brand-fg' : 'text-muted',
                )}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2 lg:ml-0">
          <ThemeToggle className="size-10" />
          {guest ? (
            <div className="hidden items-center gap-2 sm:flex">
              <Link href="/login" className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'h-10 px-4' })}>
                Entrar
              </Link>
              <Link href="/registro" className={buttonClasses({ size: 'sm', className: 'h-10 px-5' })}>
                Crear cuenta
              </Link>
            </div>
          ) : (
            session.status === 'authenticated' && <UserMenu user={session.user} />
          )}
          <button
            type="button"
            className="grid size-10 place-items-center rounded-full border border-edge text-ink transition-colors hover:border-ink lg:hidden"
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={open}
            aria-controls="landing-menu"
            onClick={() => setOpen(value => !value)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </nav>

      {open && (
        <div id="landing-menu" className="border-t border-line bg-canvas lg:hidden" onClick={() => setOpen(false)}>
          <div className="mx-auto max-w-7xl space-y-1 px-4 py-4 sm:px-6">
            {NAV.map(item => (
              <a key={item.id} href={`#${item.id}`} className="block rounded-xl px-3 py-3 font-medium hover:bg-ink/5">
                {item.label}
              </a>
            ))}
            {guest && (
              <div className="grid grid-cols-2 gap-3 pt-3 sm:hidden">
                <Link href="/login" className={buttonClasses({ variant: 'outline', className: 'h-12' })}>
                  Entrar
                </Link>
                <Link href="/registro" className={buttonClasses({ className: 'h-12' })}>
                  Crear cuenta
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
