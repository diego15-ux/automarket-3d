import type { NextConfig } from 'next';

/** CDN de las fotos de los anuncios (MEDIA_PUBLIC_BASE_URL de la API), p. ej. cdn.automarket.com */
const mediaHost = process.env.NEXT_PUBLIC_MEDIA_HOST;

/**
 * Con la API en esta PC (o en la red local) el navegador la usa por el mismo origen de la web:
 * Next pasa /api y /socket.io a la API y /s3 al almacén de fotos local. Así basta abrir el puerto
 * 3000 (teléfono, navegador de la app de Claude o un enlace público temporal con un túnel).
 * 127.0.0.1 y no la IP de la red: una VPN o el firewall pueden bloquear la IP propia.
 */
const apiTarget = (process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
const storageTarget = (process.env.LOCAL_STORAGE_PROXY_TARGET ?? 'http://127.0.0.1:9000').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  // socket.io pide /socket.io/?EIO=…: sin esto Next la redirige a /socket.io y el puente falla.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiTarget}/api/:path*` },
      { source: '/socket.io/', destination: `${apiTarget}/socket.io/` },
      { source: '/s3/:path*', destination: `${storageTarget}/:path*` },
    ];
  },
  allowedDevOrigins: ['192.168.0.173'],
  // Sin el botón «N» ni el aviso «Rendering…» de Next.js en desarrollo (los errores siguen saliendo en pantalla).
  devIndicators: false,
  reactStrictMode: true,
  // Código propietario: sin mapas de código fuente en producción ni cabecera X-Powered-By.
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  // El paquete compartido del monorepo se publica compilado (dist/): no hace falta transpilarlo.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      ...(mediaHost ? [{ protocol: 'https' as const, hostname: mediaHost }] : []),
    ],
  },
};

export default nextConfig;
