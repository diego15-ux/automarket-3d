'use client';

import type { PaymentMethod } from '@automarket/contracts';
import { useEffect, useState } from 'react';
import { formatMoney } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { Field, Input } from '@/shared/ui/field';
import { MethodPicker } from './MethodPicker';

interface Props {
  open: boolean;
  onClose: () => void;
  vehicleTitle: string;
  initialPrice: string;
  currency: string;
  commissionRate: number;
  fixedCommission?: string | null;
  priceEditable?: boolean;
  loading?: boolean;
  onSubmit: (input: { salePrice: string; method?: PaymentMethod }) => void;
}

const PRICE_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;

/** Revisión del precio final y comisión antes de abrir pago Binance. */
export function CommissionCheckoutDialog({
  open,
  onClose,
  vehicleTitle,
  initialPrice,
  currency,
  commissionRate,
  fixedCommission,
  priceEditable = true,
  loading = false,
  onSubmit,
}: Props) {
  const [salePrice, setSalePrice] = useState(initialPrice);
  const [method, setMethod] = useState<PaymentMethod | null>(null);

  useEffect(() => {
    if (open) {
      setSalePrice(initialPrice);
      setMethod(null);
    }
  }, [open, initialPrice]);

  const validPrice = PRICE_PATTERN.test(salePrice) && Number(salePrice) > 0;
  const commission = fixedCommission !== undefined && fixedCommission !== null
    ? Number(fixedCommission)
    : validPrice
      ? Number((Number(salePrice) * commissionRate).toFixed(2))
      : 0;
  const hasCommission = commission > 0;

  return (
    <Dialog open={open} onClose={onClose} title="Marcar vehículo como vendido">
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          if (!validPrice || (hasCommission && !method)) return;
          onSubmit({ salePrice: salePrice.trim(), ...(hasCommission && method ? { method } : {}) });
        }}
      >
        <p className="text-sm text-muted">{vehicleTitle}</p>
        <Field label="Precio final de venta" htmlFor="sale-price" hint="La comisión se calcula sobre este importe.">
          <Input
            id="sale-price"
            name="salePrice"
            type="number"
            min="0.01"
            max="9999999999.99"
            step="0.01"
            required
            value={salePrice}
            onChange={event => setSalePrice(event.target.value)}
            disabled={!priceEditable || loading}
            inputMode="decimal"
          />
        </Field>
        <div className="rounded-md bg-sunken p-4">
          <p className="text-xs text-muted">Comisión ({(commissionRate * 100).toLocaleString('es', { maximumFractionDigits: 2 })} %)</p>
          <p className="mt-1 font-display text-2xl">{formatMoney(commission, currency)}</p>
        </div>
        {hasCommission ? (
          <>
            <MethodPicker value={method} onChange={setMethod} />
            <p className="text-xs text-muted">
              Binance Pay confirma automáticamente. Con Pay ID, envía referencia y transacción; administrador revisará pago. Anuncio finalizará al aprobarse. Sin sanciones mientras revisión esté pendiente.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">Tu plan no cobra comisión. Anuncio finalizará al confirmar venta.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button type="submit" loading={loading} disabled={!validPrice || (hasCommission && !method)}>
            {hasCommission ? 'Continuar a pago Binance' : 'Finalizar venta'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
