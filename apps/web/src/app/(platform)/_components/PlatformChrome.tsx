'use client';

import { COPYRIGHT_NOTICE } from '@automarket/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppHeader } from './AppHeader';

/** Cabecera y pie del sitio. El panel de administración trae su propio marco (menú lateral). */
export function PlatformChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return <>{children}</>;
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[1320px] flex-1 px-5 py-6 sm:px-[clamp(20px,3vw,40px)] sm:py-8">{children}</main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-3 px-5 py-6 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-[clamp(20px,3vw,40px)]">
          <Link href="/" className="text-base font-extrabold tracking-[-0.03em] text-ink">
            AutoMarket
          </Link>
          <p className="sm:text-right">
            {COPYRIGHT_NOTICE} ·{' '}
            <Link href="/terminos" className="underline underline-offset-2 hover:text-ink">
              Términos y Condiciones
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
