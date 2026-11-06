'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Clock, FileText, Upload } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { formatBytes } from '@/shared/lib/format';
import { ApiError } from '@/shared/lib/http';
import { uploadToStorage } from '@/shared/lib/upload';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Label, Select } from '@/shared/ui/field';
import { useToast } from '@/shared/ui/toaster';
import { DOCUMENT_LABELS, KYC_ACCEPTED_TYPES, KYC_MAX_BYTES, kycApi, kycKeys, sha256Hex, type KycDocumentType } from '../api';

export type RequirementState = 'approved' | 'pending' | 'rejected' | 'missing';

interface Props {
  title: string;
  description: string;
  icon: ReactNode;
  types: KycDocumentType[];
  state: RequirementState;
  rejectionReason?: string | null;
  allowRenewal?: boolean;
  expiredAt?: string | null;
  /** Solo imágenes (la selfie no admite PDF). */
  imagesOnly?: boolean;
}

/** Un requisito KYC: elige archivo → huella SHA-256 → subida directa a S3 → registro. */
export function DocumentUploadCard({ title, description, icon, types, state, rejectionReason, allowRenewal = false, expiredAt, imagesOnly = false }: Props) {
  const inputId = useId();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [type, setType] = useState<KycDocumentType>(types[0] ?? 'PASSPORT');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
  const requiresExpiration = ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE'].includes(type);

  // Libera la URL local de la vista previa.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const upload = useMutation({
    mutationFn: async (selected: File) => {
      setProgress(0);
      const sha256 = await sha256Hex(selected);
      const presigned = await kycApi.requestUpload({ type, mimeType: selected.type, sizeBytes: selected.size });
      await uploadToStorage(presigned, selected, setProgress);
      return kycApi.submit({ type, key: presigned.key, sha256, ...(expiresAt ? { expiresAt } : {}) });
    },
    onSuccess: () => {
      toast({ tone: 'success', title: 'Documento enviado', description: 'Lo revisaremos en menos de 24 horas.' });
      setFile(null);
      setPreview(null);
      setExpiresAt('');
      void queryClient.invalidateQueries({ queryKey: kycKeys.status });
    },
    onError: err => setError(err instanceof ApiError ? err.message : err.message),
  });

  function choose(selected: File | undefined) {
    setError(null);
    if (!selected) return;
    const allowed = imagesOnly ? KYC_ACCEPTED_TYPES.filter(mime => mime.startsWith('image/')) : KYC_ACCEPTED_TYPES;
    if (!allowed.includes(selected.type)) return setError(imagesOnly ? 'Sube una foto (JPG, PNG o WEBP).' : 'Sube una foto (JPG, PNG, WEBP) o un PDF.');
    if (selected.size > KYC_MAX_BYTES) return setError('El archivo supera el máximo de 10 MB.');
    setFile(selected);
    setPreview(selected.type.startsWith('image/') ? URL.createObjectURL(selected) : null);
  }

  return (
    <Card className="flex flex-col p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
          <div>
            <h2 className="font-display text-lg">{title}</h2>
            <p className="mt-1 text-sm text-muted">{description}</p>
          </div>
        </div>
        <StateBadge state={state} />
      </div>

      {state === 'approved' && !allowRenewal && <p className="mt-5 text-sm text-success-fg">Documento aprobado.</p>}
      {expiredAt && <p className="mt-4 text-sm text-danger-fg">Documento vencido el {new Date(expiredAt).toLocaleDateString()}.</p>}
      {allowRenewal && <p className="mt-4 text-sm text-gold-fg">Tu documento vence pronto. Puedes enviar el nuevo antes de que venza.</p>}
      {state === 'pending' && <p className="mt-5 text-sm text-muted">Nuestro equipo de cumplimiento lo está revisando.</p>}

      {(state === 'missing' || state === 'rejected' || allowRenewal) && (
        <div className="mt-5 flex flex-1 flex-col gap-4">
          {state === 'rejected' && rejectionReason && (
            <p className="rounded-sm border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger-fg">Rechazado: {rejectionReason}</p>
          )}
          {types.length > 1 && (
            <div>
              <Label htmlFor={`${inputId}-type`}>Tipo de documento</Label>
              <Select id={`${inputId}-type`} value={type} onChange={event => setType(event.target.value as KycDocumentType)}>
                {types.map(option => (
                  <option key={option} value={option}>
                    {DOCUMENT_LABELS[option]}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {requiresExpiration && (
            <div>
              <Label htmlFor={`${inputId}-expiresAt`}>Vence el</Label>
              <input
                id={`${inputId}-expiresAt`}
                type="date"
                required
                min={new Date().toISOString().slice(0, 10)}
                value={expiresAt}
                onChange={event => setExpiresAt(event.target.value)}
                className="mt-1 h-11 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink"
              />
            </div>
          )}

          <label htmlFor={inputId} className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line bg-sunken px-4 py-8 text-center transition hover:border-brand/60">
            {preview ? (
              // <img> nativo: vista previa local (blob:)
              <img src={preview} alt="Vista previa del documento" className="max-h-44 rounded-sm object-contain" />
            ) : file ? (
              <span className="flex items-center gap-2 text-sm">
                <FileText className="size-5 text-brand-fg" /> {file.name}
              </span>
            ) : (
              <>
                <Upload className="size-6 text-muted" />
                <span className="text-sm font-medium">Elige un archivo o haz una foto</span>
                <span className="text-xs text-muted">{imagesOnly ? 'JPG, PNG o WEBP' : 'JPG, PNG, WEBP o PDF'} · máx. 10 MB</span>
              </>
            )}
            {file && <span className="text-xs text-muted">{formatBytes(file.size)} · toca para cambiarlo</span>}
          </label>
          <input
            id={inputId}
            type="file"
            className="sr-only"
            accept={imagesOnly ? 'image/jpeg,image/png,image/webp' : KYC_ACCEPTED_TYPES.join(',')}
            capture={imagesOnly ? 'user' : undefined}
            onChange={event => choose(event.target.files?.[0])}
          />

          {upload.isPending && (
            <div className="h-1 overflow-hidden bg-line" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-ink transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          {error && <p className="text-sm text-danger-fg">{error}</p>}

          <Button className="mt-auto w-full" disabled={!file || (requiresExpiration && !expiresAt)} loading={upload.isPending} onClick={() => file && upload.mutate(file)}>
            {allowRenewal ? 'Enviar documento nuevo' : 'Enviar para revisión'}
          </Button>
        </div>
      )}
    </Card>
  );
}

function StateBadge({ state }: { state: RequirementState }) {
  if (state === 'approved')
    return (
      <Badge tone="success">
        <CircleCheck className="size-3.5" /> Aprobado
      </Badge>
    );
  if (state === 'pending')
    return (
      <Badge tone="gold">
        <Clock className="size-3.5" /> En revisión
      </Badge>
    );
  if (state === 'rejected') return <Badge tone="danger">Rechazado</Badge>;
  return <Badge>Pendiente</Badge>;
}
