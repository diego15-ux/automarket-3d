import { NextResponse, type NextRequest } from 'next/server';

/**
 * Filtro rápido de rutas privadas: sin cookie de acceso, al login con `next`.
 * La autorización real la hace la API. Si la cookie de acceso caducó pero la de refresh
 * sigue viva, el login recupera la sesión en silencio y devuelve al usuario a `next`.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // El catálogo es público; las fichas y las áreas de cuenta requieren iniciar sesión.
  const isPrivate = /^\/vehiculos\/.+/.test(pathname) || /^\/(mensajes|cuenta|admin|pagos|vender|destacar)(\/|$)/.test(pathname);
  if (!isPrivate || request.cookies.has('am_at')) return NextResponse.next();

  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/vehiculos', '/vehiculos/:slug', '/mensajes/:path*', '/cuenta/:path*', '/admin/:path*', '/pagos/:path*', '/vender', '/destacar'],
};
