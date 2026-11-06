'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Building2, Camera, Clock, IdCard, LockKeyhole, Phone, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { formatDate } from '@/shared/lib/format';
import { refreshSession } from '@/shared/lib/http';
import { useSession } from '@/shared/lib/use-session';
import { Badge } from '@/shared/ui/badge';
import { buttonClasses } from '@/shared/ui/button';
import { Card, EmptyState } from '@/shared/ui/card';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { ConfirmButton } from '@/features/reservations/components/ConfirmButton';
import { DOCUMENT_LABELS, kycApi, kycKeys, type KycDocument, type KycDocumentType, type KycStatus } from '../api';
import { DocumentUploadCard, type RequirementState } from './DocumentUploadCard';

const IDENTITY_TYPES: KycDocumentType[] = ['NATIONAL_ID', 'PASSPORT', 'DRIVER_LICENSE'];

/** Estado de un requisito a partir de los documentos (vienen del más reciente al más antiguo). */
function requirement(documents: KycDocument[], types: KycDocumentType[]): { state: RequirementState; reason?: string | null; expiredAt?: string | null } {
  const relevant = documents.filter(document => types.includes(document.type));
  if (relevant.some(document => document.status === 'PENDING')) return { state: 'pending' };
  if (relevant.some(document => document.status === 'APPROVED' && (!document.expiresAt || new Date(document.expiresAt) > new Date()))) return { state: 'approved' };
  const expired = relevant.find(document => document.status === 'APPROVED' && document.expiresAt && new Date(document.expiresAt) <= new Date());
  if (expired) return { state: 'missing', expiredAt: expired.expiresAt };
  if (relevant[0]?.status === 'REJECTED') return { state: 'rejected', reason: relevant[0].rejectionReason };
  return { state: 'missing' };
}

export function KycCenter() {
  const session = useSession();
  const status = useQuery({
    queryKey: kycKeys.status,
    queryFn: kycApi.status,
    // También puede haber una renovación pendiente mientras el documento anterior sigue vigente.
    refetchInterval: query => (query.state.data?.documents.some(document => document.status === 'PENDING') ? 15_000 : false),
  });

  // Sincroniza la sesión al aprobar documentos o al vencer una identificación.
  const apiVerified = status.data?.isVerified;
  useEffect(() => {
    if (apiVerified !== undefined && session.status === 'authenticated' && apiVerified !== session.user.isVerified) void refreshSession();
  }, [apiVerified, session.status, session.status === 'authenticated' ? session.user.isVerified : null]);

  if (status.isPending) return <PageSpinner />;
  if (status.isError) return <EmptyState title="No pudimos cargar tu verificación" description={status.error.message} />;

  const { documents, missing } = status.data;
  const identity = requirement(documents, IDENTITY_TYPES);
  const selfie = requirement(documents, ['SELFIE']);
  const business = requirement(documents, ['BUSINESS_REGISTRATION']);
  const dealer = session.status === 'authenticated' && session.user.accountType === 'DEALER';
  const phoneMissing = missing.includes('PHONE');

  return (
    <div className="space-y-8">
      {session.status === 'authenticated' && ['ADMIN', 'ADMIN_ONE'].includes(session.user.role) && (
        <div role="note" className="rounded-md border border-brand/30 bg-brand/[0.07] p-5 text-sm">
          <p className="font-semibold">Verificación de tu cuenta de administrador</p>
          <p className="mt-1 text-muted">
            Puedes enviar tus documentos desde aquí. {session.user.role === 'ADMIN_ONE' ? 'Puedes aprobar tus documentos pendientes desde esta página.' : 'Otro administrador debe revisarlos; no puedes aprobar los tuyos.'}
          </p>
        </div>
      )}
      {session.status === 'authenticated' && session.user.role === 'ADMIN_ONE' && documents.some(document => document.status === 'PENDING') && (
        <OwnerSelfReview documents={documents.filter(document => document.status === 'PENDING')} />
      )}
      <StatusBanner status={status.data} />

      {phoneMissing && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gold/35 bg-gold/[0.07] p-5 text-sm">
          <p className="flex items-center gap-2">
            <Phone className="size-5 text-gold-fg" /> Falta tu teléfono: es parte de la verificación y solo lo ve la otra parte de una reserva confirmada.
          </p>
          <Link href="/cuenta/perfil?next=/cuenta/verificacion" className={buttonClasses({ size: 'sm' })}>
            Añadir teléfono
          </Link>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <DocumentUploadCard
          title="Cédula de identidad"
          description="Cédula, pasaporte o licencia de conducir vigente. Foto nítida de frente o PDF."
          icon={<IdCard className="size-5" />}
          types={IDENTITY_TYPES}
          state={identity.state}
          rejectionReason={identity.reason}
          allowRenewal={status.data.canRenewIdentity && identity.state === 'approved'}
          expiredAt={identity.expiredAt}
        />
        <DocumentUploadCard
          title="Selfie"
          description="Una foto de tu cara bien iluminada, sin gafas de sol ni gorra."
          icon={<Camera className="size-5" />}
          types={['SELFIE']}
          state={selfie.state}
          rejectionReason={selfie.reason}
          imagesOnly
        />
        {dealer && (
          <DocumentUploadCard
            title="Documento del RIF"
            description="Comprobante del RIF del concesionario vigente (foto nítida o PDF). Debe coincidir con la razón social de tu perfil."
            icon={<Building2 className="size-5" />}
            types={['BUSINESS_REGISTRATION']}
            state={business.state}
            rejectionReason={business.reason}
          />
        )}
      </div>

      {documents.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-lg">Historial de envíos</h2>
          <Card className="divide-y divide-line">
            {documents.map(document => (
              <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
                <div>
                  <p className="font-medium">{DOCUMENT_LABELS[document.type]}</p>
                  <p className="text-xs text-muted">Enviado el {formatDate(document.createdAt)}{document.expiresAt && ` · vence el ${formatDate(document.expiresAt)}`}</p>
                </div>
                <Badge tone={document.status === 'APPROVED' ? 'success' : document.status === 'REJECTED' ? 'danger' : 'gold'}>
                  {document.status === 'APPROVED' ? 'Aprobado' : document.status === 'REJECTED' ? 'Rechazado' : 'En revisión'}
                </Badge>
              </div>
            ))}
          </Card>
        </section>
      )}

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
        <LockKeyhole className="mt-0.5 size-4 shrink-0" />
        Tus documentos se suben directamente a un almacenamiento privado y cifrado. Solo el equipo de cumplimiento puede verlos, con enlaces que caducan en 5 minutos y quedan registrados.
      </p>
    </div>
  );
}

function OwnerSelfReview({ documents }: { documents: KycDocument[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const approve = useMutation({
    mutationFn: (id: string) => kycApi.review(id, { decision: 'APPROVE' }),
    onSuccess: async result => {
      toast({ tone: 'success', title: 'Documento aprobado', description: result.userVerified ? 'Tu cuenta quedó verificada.' : undefined });
      await queryClient.invalidateQueries({ queryKey: kycKeys.status });
    },
    onError: error => toast({ tone: 'error', title: 'No se pudo aprobar el documento', description: error.message }),
  });
  return (
    <Card className="space-y-3 border-brand/30 p-5">
      <div>
        <h2 className="font-semibold">Revisión de Admin One</h2>
        <p className="mt-1 text-sm text-muted">Confirma cada documento tras verificarlo. La aprobación queda registrada en auditoría.</p>
      </div>
      {documents.map(document => (
        <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-sm">{DOCUMENT_LABELS[document.type]} · enviado {formatDate(document.createdAt)}</span>
          <ConfirmButton size="sm" loading={approve.isPending} onConfirm={() => approve.mutate(document.id)} confirmLabel="¿Aprobar documento?">
            Aprobar
          </ConfirmButton>
        </div>
      ))}
    </Card>
  );
}

function StatusBanner({ status }: { status: KycStatus }) {
  const content = {
    APPROVED: { icon: <BadgeCheck className="size-6 text-success-fg" />, title: 'Identidad verificada', text: 'Ya puedes publicar y reservar vehículos. Tus anuncios mostrarán la insignia «Verificado».', tone: 'border-success/35 bg-success/[0.06]' },
    PENDING: { icon: <Clock className="size-6 text-gold-fg" />, title: 'Documentos en revisión', text: 'Normalmente respondemos en menos de 24 horas. Esta página se actualiza sola.', tone: 'border-gold/35 bg-gold/[0.07]' },
    REJECTED: { icon: <ShieldAlert className="size-6 text-danger-fg" />, title: 'Necesitamos que vuelvas a enviar un documento', text: 'Revisa el motivo del rechazo y sube una nueva versión.', tone: 'border-danger/35 bg-danger/[0.06]' },
    INCOMPLETE: { icon: <ShieldAlert className="size-6 text-brand-fg" />, title: 'Te falta un paso', text: 'Completa los documentos pendientes para terminar la verificación.', tone: 'border-line bg-surface' },
    NOT_STARTED: { icon: <ShieldAlert className="size-6 text-brand-fg" />, title: 'Verifica tu identidad para publicar y reservar', text: 'Necesitamos tu cédula, una selfie y tu teléfono (y el RIF si eres concesionario). Se hace una sola vez.', tone: 'border-line bg-surface' },
  }[status.status];

  return (
    <div className={`flex items-start gap-4 rounded-md border p-5 ${content.tone}`}>
      {content.icon}
      <div>
        <p className="font-display text-lg">{content.title}</p>
        <p className="mt-1 text-sm text-muted">{content.text}</p>
      </div>
    </div>
  );
}
