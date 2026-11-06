import { COPYRIGHT_NOTICE } from '@automarket/contracts';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LoginShowcase } from '@/features/landing/components/LoginShowcase';
import { LOGIN_BG_DEFAULT } from '@/features/landing/hero';
import { getPublicSettings } from '@/features/landing/server';
import { Logo } from '@/shared/ui/logo';
import { SocialLinks } from '@/shared/ui/social-links';
import { ThemeToggle } from '@/shared/ui/theme-toggle';

// El fondo y las redes los cambia el panel: se leen en cada petición.
export const dynamic = 'force-dynamic';

/**
 * Acceso (login, registro, recuperación) como en los diseños: en PC, a la izquierda el panel
 * oscuro con el titular y las redes; a la derecha el formulario
 * sobre blanco. En el teléfono, solo el formulario (claro u oscuro) con las redes debajo.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const settings = await getPublicSettings();
  const socialLinks = settings?.socialLinks ?? [];

  return (
    <div className="flex min-h-dvh bg-surface text-ink">
      <div className="hidden shrink-0 basis-[44%] lg:block">
        <div className="sticky top-0">
          <LoginShowcase socialLinks={socialLinks} background={settings?.loginBackgroundUrl ?? LOGIN_BG_DEFAULT} />
        </div>
      </div>

      <main className="flex min-h-dvh min-w-0 flex-1 flex-col px-5 py-6 sm:px-[clamp(20px,5vw,72px)] sm:py-7">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="hidden min-h-11 items-center gap-1.5 text-sm font-bold text-ink hover:underline lg:inline-flex">
            <ArrowLeft className="size-4" strokeWidth={2.4} />
            Volver al inicio
          </Link>
          <Logo href="/" className="lg:hidden" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/#contacto" className="hidden min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold text-ink hover:border-edge sm:inline-flex">
              ¿Necesitas ayuda?
            </Link>
          </div>
        </div>
        <div className="grid flex-1 place-items-center py-7">{children}</div>
        <footer className="mx-auto flex w-full max-w-[440px] flex-col gap-3 text-xs text-muted">
          <SocialLinks links={socialLinks} className="lg:hidden" />
          <p>
            {COPYRIGHT_NOTICE} ·{' '}
            <Link href="/terminos" className="underline underline-offset-2 hover:text-ink">
              Términos y Condiciones
            </Link>
          </p>
        </footer>
      </main>
    </div>
  );
}
