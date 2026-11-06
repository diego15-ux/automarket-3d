'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { SocialLogin } from './SocialLogin';

/** Pestañas «Entrar / Crear cuenta» de los diseños: una píldora gris con la activa en blanco. */
function AccessTabs({ active }: { active: 'login' | 'register' }) {
  const params = useSearchParams();
  const next = params.get('next');
  const suffix = next ? `?next=${encodeURIComponent(next)}` : '';
  const tab = (key: 'login' | 'register', href: string, label: string) => (
    <Link
      href={`${href}${suffix}`}
      role="tab"
      aria-selected={active === key}
      className={cn('relative grid h-11 place-items-center rounded-full text-[15px] font-bold transition-colors', active === key ? 'bg-surface text-ink shadow-tab dark:bg-[#2a2e34]' : 'text-muted hover:text-ink')}
    >
      {label}
    </Link>
  );
  return (
    <div role="tablist" aria-label="Acceso a tu cuenta" className="mt-[22px] grid grid-cols-2 rounded-full bg-sunken p-1 dark:bg-[#121316]">
      {tab('login', '/login', 'Entrar')}
      {tab('register', '/registro', 'Crear cuenta')}
    </div>
  );
}

/** Marco común de las pantallas de acceso: título, pestañas, acceso con Google (opcional) y formulario. */
export function AuthCard({
  title,
  description,
  children,
  footer,
  social = true,
  tab,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  social?: boolean;
  tab?: 'login' | 'register';
}) {
  return (
    <div className="w-full max-w-[440px]">
      <h1 className="text-[30px] leading-[1.08] font-extrabold tracking-[-0.03em] sm:text-4xl">{title}</h1>
      <p className="mt-2 text-[15px] leading-normal text-pretty text-muted">{description}</p>
      {tab && <AccessTabs active={tab} />}
      {social && (
        <>
          <div className="mt-[22px]">
            <SocialLogin />
          </div>
          <div className="my-4 flex items-center gap-3 text-[13px] text-muted">
            <span className="h-px flex-1 bg-line" />o con tu correo<span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      {!social && <div className="mt-[22px]" />}
      {children}
      {footer && <div className="mt-[18px] text-center text-sm text-muted">{footer}</div>}
    </div>
  );
}

export function FormAlert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'success' }) {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={tone === 'error' ? 'rounded-[14px] bg-danger-soft px-4 py-3 text-sm text-danger-fg' : 'rounded-[14px] bg-success-soft px-4 py-3 text-sm text-success-fg'}>
      {children}
    </p>
  );
}
