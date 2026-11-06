'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, refreshSession } from '@/shared/lib/http';
import { sessionStore } from '@/shared/lib/session';
import { CopilotWidget } from '@/features/copilot/CopilotWidget';
import { ToastProvider } from '@/shared/ui/toaster';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 20_000,
            refetchOnWindowFocus: false,
            // Los 4xx son definitivos (no encontrado, sin permiso…): no se reintentan.
            retry: (failureCount, error) => !(error instanceof ApiError && error.status < 500) && failureCount < 2,
          },
        },
      }),
  );

  // Al cargar la app recuperamos la sesión (si hay cookie de refresh) para conocer al usuario.
  useEffect(() => {
    if (sessionStore.get().status === 'loading') void refreshSession();
  }, []);

  // Al cerrar sesión no deben quedar datos privados del usuario anterior en caché. Solo al pasar
  // de «con sesión» a «sin sesión»: si se borrara también al terminar de comprobar la sesión de un
  // visitante, las consultas que ya iban en camino quedarían colgadas en «Cargando…».
  useEffect(() => {
    let previous = sessionStore.get().status;
    return sessionStore.subscribe(() => {
      const status = sessionStore.get().status;
      if (status === 'anonymous' && previous === 'authenticated') queryClient.removeQueries();
      previous = status;
    });
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {children}
        {/* Copiloto del comprador: solo en las pantallas de compra (catálogo, ficha, portada…). */}
        <CopilotWidget />
      </ToastProvider>
    </QueryClientProvider>
  );
}
