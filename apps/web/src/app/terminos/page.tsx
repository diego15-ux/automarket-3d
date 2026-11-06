import { COPYRIGHT_NOTICE } from '@automarket/contracts';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTerms } from '@/features/landing/server';
import { TermsCenter } from '@/features/legal/TermsCenter';
import { Logo } from '@/shared/ui/logo';
import { ThemeToggle } from '@/shared/ui/theme-toggle';

export const metadata: Metadata = { title: 'Términos y políticas' };

// Los Términos se editan desde el panel: siempre la versión vigente.
export const dynamic = 'force-dynamic';

export default async function TermsPage() {
  const terms = await getTerms();
  return (
    <div className="min-h-dvh bg-canvas print:bg-white">
      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-4 px-5 py-3.5 sm:px-[clamp(20px,3vw,40px)]">
          <Logo href="/" />
          <div className="flex items-center gap-2">
            <Link href="/vehiculos" className="hidden min-h-11 items-center gap-1.5 px-3 text-sm font-bold text-ink hover:underline sm:inline-flex">
              <ArrowLeft className="size-4" strokeWidth={2.4} />
              Ir al catálogo
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main>
        {terms ? (
          <TermsCenter terms={terms} />
        ) : (
          <div className="mx-auto max-w-[1180px] px-5 py-16 sm:px-[clamp(20px,3vw,40px)]">
            <h1 className="font-display text-3xl tracking-tight">Términos y políticas</h1>
            <p className="mt-3 max-w-lg text-muted">No pudimos traer los términos ahora. Suele pasar cuando la API todavía está arrancando.</p>
            <a href="/terminos" className="mt-6 inline-flex min-h-11 items-center rounded-sm border border-edge px-4 text-sm font-semibold hover:border-ink">
              Volver a intentar
            </a>
          </div>
        )}
      </main>
      <footer className="border-t border-line bg-surface py-6 print:hidden">
        <p className="mx-auto max-w-[1320px] px-5 text-xs text-muted sm:px-[clamp(20px,3vw,40px)]">{COPYRIGHT_NOTICE}</p>
      </footer>
    </div>
  );
}
