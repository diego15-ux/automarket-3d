'use client';

import { BinancePayeeUpdateSchema, LOGIN_BACKGROUND_TYPES, MAX_BINANCE_QR_BYTES, type BinancePayeeDTO } from '@automarket/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Lock, ShieldCheck, Trash2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { formatDate, formatTime } from '@/shared/lib/format';
import { uploadToStorage } from '@/shared/lib/upload';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';
import { useToast } from '@/shared/ui/toaster';
import { adminApi, adminKeys } from '../api';

const SOURCE: Record<BinancePayeeDTO['source'], { label: string; tone: 'success' | 'gold' | 'danger' }> = {
  PANEL: { label: 'Fijada en el panel', tone: 'success' },
  ENV: { label: 'Tomada del .env del servidor', tone: 'gold' },
  NONE: { label: 'Sin configurar', tone: 'danger' },
};

/**
 * Cuenta de cobro de la empresa (pago manual con Binance). La ve todo el equipo; solo el
 * administrador principal la cambia, y la API lo vuelve a comprobar. Usuarios y concesionarios
 * la ven bloqueada en la pantalla de pago: no existe forma de que indiquen otra.
 */
export function BinancePayeeCard({ payee }: { payee: BinancePayeeDTO }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<number | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.settings });
    void queryClient.invalidateQueries({ queryKey: adminKeys.history });
  };

  const save = useMutation({
    mutationFn: adminApi.updateBinancePayee,
    onSuccess: () => {
      refresh();
      toast({ tone: 'success', title: 'Cuenta de cobro guardada', description: 'Los pagos nuevos irán a este Pay ID. Todo el equipo recibió el aviso.' });
    },
    onError: err => setErrors({ form: err.message }),
  });
  const uploadQr = useMutation({
    mutationFn: async (image: File) => {
      if (!(LOGIN_BACKGROUND_TYPES as readonly string[]).includes(image.type)) throw new Error('Usa una imagen JPG, PNG o WebP.');
      if (image.size > MAX_BINANCE_QR_BYTES) throw new Error('El QR no puede superar 2 MB.');
      const presigned = await adminApi.presignBinanceQr({ mimeType: image.type, sizeBytes: image.size });
      await uploadToStorage(presigned, image, setProgress);
      return adminApi.setBinanceQr(presigned.key);
    },
    onSuccess: () => {
      refresh();
      toast({ tone: 'success', title: 'QR de cobro actualizado' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo subir el QR', description: err.message }),
    onSettled: () => setProgress(null),
  });
  const removeQr = useMutation({
    mutationFn: adminApi.removeBinanceQr,
    onSuccess: () => {
      refresh();
      toast({ tone: 'success', title: 'QR quitado' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo quitar', description: err.message }),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = BinancePayeeUpdateSchema.safeParse({ payId: data.get('payId'), payName: data.get('payName'), confirm: data.get('confirm') === 'on' ? true : undefined });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0] ?? 'form'), issue.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  const source = SOURCE[payee.source];
  const textField = 'box-border h-[46px] w-full rounded-[12px] border border-edge bg-surface px-3.5 text-[15px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/25 aria-[invalid=true]:border-danger';
  return (
    <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
      <section className="grid gap-3.5 rounded-[22px] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold">Cuenta de cobro en Binance</h2>
            <p className="mt-0.5 text-[13.5px] leading-[1.45] text-muted">Aquí llegan todos los pagos de planes y comisiones. Solo el administrador principal la cambia.</p>
          </div>
          <Badge tone={source.tone}>{source.label}</Badge>
        </div>

        {payee.canEdit ? (
          <form onSubmit={onSubmit} className="grid gap-3.5" noValidate>
            <div className="grid gap-1.5">
              <label htmlFor="payId" className="text-sm font-semibold">
                Binance Pay ID
              </label>
              <input id="payId" name="payId" inputMode="numeric" autoComplete="off" placeholder="Ej. 123456789" defaultValue={payee.payId ?? ''} aria-invalid={Boolean(errors.payId)} className={cn(textField, 'font-mono font-semibold')} />
              {errors.payId ? <p className="flex gap-1.5 text-[13px] text-danger-fg">{errors.payId}</p> : <p className="text-[13px] text-muted">Solo números, de 4 a 20 cifras. Está en tu app de Binance, en Pay.</p>}
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="payName" className="text-sm font-semibold">
                A nombre de
              </label>
              <input id="payName" name="payName" defaultValue={payee.payName ?? ''} aria-invalid={Boolean(errors.payName)} className={textField} />
              {errors.payName && <p className="text-[13px] text-danger-fg">{errors.payName}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input ref={file} type="file" accept={LOGIN_BACKGROUND_TYPES.join(',')} className="sr-only" onChange={event => event.target.files?.[0] && uploadQr.mutate(event.target.files[0])} />
              <Button variant="outline" size="sm" loading={uploadQr.isPending} disabled={payee.source !== 'PANEL'} onClick={() => file.current?.click()}>
                <ImagePlus className="size-4" aria-hidden />
                {progress !== null ? `Subiendo ${Math.round(progress * 100)} %` : payee.qrImageUrl ? 'Cambiar QR' : 'Subir QR'}
              </Button>
              {payee.qrImageUrl && (
                <Button variant="ghost" size="sm" loading={removeQr.isPending} onClick={() => removeQr.mutate()}>
                  <Trash2 className="size-4" aria-hidden />
                  Quitar QR
                </Button>
              )}
              <span className="text-[13px] text-muted">{payee.source === 'PANEL' ? 'PNG, JPG o WebP del QR de cobro, hasta 2 MB.' : 'Guarda primero el Pay ID para subir su QR.'}</span>
            </div>
            <label className="flex items-start gap-2.5 rounded-[14px] bg-gold-soft p-3 text-sm text-gold-fg">
              <input type="checkbox" name="confirm" className="mt-0.5 size-4 accent-brand" />
              <span>
                Confirmo que este Pay ID es de AutoMarket. Los pagos nuevos irán a esta cuenta y el cambio queda en el historial.{' '}
                {payee.openManualPayments === 1 ? 'El pago manual que está abierto conserva la cuenta con la que se creó.' : payee.openManualPayments > 1 ? `Los ${payee.openManualPayments} pagos manuales abiertos conservan la cuenta con la que se crearon.` : ''}
              </span>
            </label>
            {errors.confirm && <p className="text-[13px] text-danger-fg">{errors.confirm}</p>}
            {errors.form && <p className="text-[13px] text-danger-fg">{errors.form}</p>}
            <div>
              <Button type="submit" loading={save.isPending}>
                Guardar cuenta de cobro
              </Button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-[13px] text-muted">Binance Pay ID</dt>
              <dd className="mt-1 font-mono text-lg font-semibold">{payee.payId ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted">A nombre de</dt>
              <dd className="mt-1 font-semibold">{payee.payName ?? '—'}</dd>
            </div>
            <p className="flex items-start gap-2 text-sm text-muted sm:col-span-2">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              Solo el administrador principal puede cambiar esta cuenta.
            </p>
          </dl>
        )}
      </section>

      <section aria-label="Vista de quien paga" className="grid gap-3 rounded-[22px] border border-line bg-surface p-5">
        <div>
          <h2 className="text-lg font-extrabold">Así lo ve quien paga</h2>
          <p className="mt-0.5 text-[13.5px] leading-[1.45] text-muted">Personas y concesionarios ven esta caja bloqueada. No hay botón para cambiarla.</p>
        </div>
        <div className="flex gap-4 rounded-[16px] border border-line bg-canvas p-4">
          <div className="grid size-[120px] shrink-0 place-items-center overflow-hidden rounded-[12px] border border-line bg-surface">
            {payee.qrImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- QR servido por el CDN de medios
              <img src={payee.qrImageUrl} alt="QR del Pay ID" className="size-full object-contain" />
            ) : (
              <span className="px-2 text-center text-xs text-muted">Sin QR</span>
            )}
          </div>
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] content-start gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="text-muted">Pay ID</dt>
            <dd className="font-mono font-semibold">{payee.payId ?? 'Sin configurar'}</dd>
            <dt className="text-muted">A nombre de</dt>
            <dd className="truncate font-bold">{payee.payName ?? '—'}</dd>
            <dt className="text-muted">Moneda</dt>
            <dd>USDT</dd>
            <dt className="text-muted">Nota</dt>
            <dd>La referencia del pago</dd>
          </dl>
        </div>
        <p className="flex items-start gap-2 text-[13px] text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success-fg" aria-hidden />
          Esta cuenta la fija AutoMarket y nadie más puede cambiarla. Si alguien te pide pagar a otra cuenta, es una estafa: repórtalo.
        </p>
        {payee.updatedAt && (
          <p className="text-[13px] text-muted">
            Último cambio: {formatDate(payee.updatedAt)} · {formatTime(payee.updatedAt)}
            {payee.updatedBy ? ` por ${payee.updatedBy}` : ''}
          </p>
        )}
      </section>
    </div>
  );
}
