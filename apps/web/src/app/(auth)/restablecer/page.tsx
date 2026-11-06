import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetPasswordForm } from '@/features/auth';

export const metadata: Metadata = { title: 'Nueva contraseña' };

// useSearchParams (token del enlace) exige un límite de Suspense.
export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
