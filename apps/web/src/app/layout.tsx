/*!
 * AutoMarket 3D
 * © Todos los derechos reservados. Sistema desarrollado bajo licencia exclusiva del propietario de la plataforma.
 * Prohibida su copia, modificación o distribución sin autorización expresa y por escrito (ver LICENSE).
 */
import { COPYRIGHT_NOTICE } from '@automarket/contracts';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { THEME_SCRIPT } from '@/shared/ui/theme-toggle';
import { Providers } from './providers';
import './globals.css';

// Letras de los diseños, servidas desde el propio sitio (sin depender de Google Fonts):
// Figtree en PC, Geist en el teléfono y Geist Mono para cifras y etiquetas (licencia OFL).
const figtree = localFont({ src: './fonts/figtree-latin-wght-normal.woff2', weight: '300 900', variable: '--font-figtree', display: 'swap' });
const geist = localFont({ src: './fonts/geist-latin-wght-normal.woff2', weight: '100 900', variable: '--font-geist', display: 'swap' });
const geistMono = localFont({ src: './fonts/geist-mono-latin-wght-normal.woff2', weight: '100 900', variable: '--font-geist-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'AutoMarket · Compra y vende autos sabiendo con quién tratas', template: '%s · AutoMarket' },
  description: 'Autos de particulares y concesionarios con identidad verificada. Ficha completa, chat directo y reserva con abono al vendedor.',
  other: { copyright: COPYRIGHT_NOTICE },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f4f6' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0f11' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // El script de tema cambia la clase de <html> antes de hidratar: se avisa a React.
    // data-scroll-behavior: Next quita el desplazamiento suave al cambiar de página (sin saltos raros).
    <html lang="es" data-scroll-behavior="smooth" className={`${figtree.variable} ${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Aplica el tema guardado antes del primer pintado (sin parpadeo). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
