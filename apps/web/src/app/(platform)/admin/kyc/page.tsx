import type { Metadata } from 'next';
import { KycReviewQueue } from '@/features/kyc';
import { PageHeader } from '@/shared/ui/card';

export const metadata: Metadata = { title: 'Revisión KYC' };

export default function KycAdminPage() {
  return (
    <>
      <PageHeader eyebrow="Cumplimiento" title="Revisión de identidad" description="Documentos por orden de llegada. Cada consulta y decisión queda registrada en la auditoría." />
      <KycReviewQueue />
    </>
  );
}
