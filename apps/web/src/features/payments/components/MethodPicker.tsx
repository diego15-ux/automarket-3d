'use client';

import type { PaymentMethod } from '@automarket/contracts';
import { useQuery } from '@tanstack/react-query';
import { QrCode, Wallet } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '@/shared/lib/cn';
import { paymentKeys, paymentsApi } from '../api';

const OPTIONS: Record<PaymentMethod, { title: string; text: string; icon: typeof QrCode }> = {
  MERCHANT: { title: 'Binance Pay', text: 'Escanea el QR o abre Binance: se confirma al instante.', icon: QrCode },
  MANUAL: { title: 'Pay ID de Binance', text: 'Envías el pago a nuestro Pay ID y el equipo lo verifica.', icon: Wallet },
};

/** Elige cómo pagar con Binance (solo muestra los métodos configurados en el servidor). */
export function MethodPicker({ value, onChange }: { value: PaymentMethod | null; onChange: (method: PaymentMethod) => void }) {
  const methods = useQuery({ queryKey: paymentKeys.methods, queryFn: paymentsApi.methods, staleTime: 5 * 60_000 });
  const available: PaymentMethod[] = methods.data ? [...(methods.data.merchant ? (['MERCHANT'] as const) : []), ...(methods.data.manual ? (['MANUAL'] as const) : [])] : [];

  // Si solo hay un método, se selecciona solo.
  useEffect(() => {
    if (available.length > 0 && (value === null || !available.includes(value))) onChange(available[0]!);
  }, [available.join(','), value, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  if (methods.isPending) return <div className="h-16 animate-pulse rounded-md bg-sunken" />;
  if (available.length === 0) return <p className="rounded-md bg-gold/[0.07] px-4 py-3 text-xs">Los pagos con Binance aún no están configurados.</p>;
  if (available.length === 1) {
    const option = OPTIONS[available[0]!];
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        <option.icon className="size-4 text-gold-fg" /> Pago con {option.title} en {methods.data?.currency}.
      </p>
    );
  }
  return (
    <div role="radiogroup" aria-label="Método de pago" className="grid gap-2 sm:grid-cols-2">
      {available.map(method => {
        const option = OPTIONS[method];
        const selected = value === method;
        return (
          <button
            key={method}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(method)}
            className={cn('flex items-start gap-3 rounded-md border p-3 text-left transition', selected ? 'border-gold bg-gold/[0.07]' : 'border-line bg-sunken hover:border-ink/30')}
          >
            <option.icon className={cn('mt-0.5 size-5 shrink-0', selected ? 'text-gold-fg' : 'text-muted')} />
            <span>
              <span className="block text-sm font-semibold">{option.title}</span>
              <span className="block text-xs text-muted">{option.text}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
