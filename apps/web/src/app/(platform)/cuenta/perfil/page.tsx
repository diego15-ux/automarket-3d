'use client';

import { Suspense } from 'react';
import { AuthGate } from '@/features/auth';
import { ProfileForm, ReviewForm } from '@/features/auth/components/ProfileForm';
import { useSession } from '@/shared/lib/use-session';
import { PageHeader } from '@/shared/ui/card';

function ProfileContent() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <ProfileForm key={session.user.id} user={session.user} />
      <div id="opinion" className="scroll-mt-28">
        <ReviewForm />
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <AuthGate>
      <PageHeader eyebrow="Cuenta" title="Tu perfil" description="Tu país y ciudad priorizan los autos cercanos en las búsquedas y sugerencias." />
      <Suspense>
        <ProfileContent />
      </Suspense>
    </AuthGate>
  );
}
