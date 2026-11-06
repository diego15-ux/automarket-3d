'use client';

import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/shared/lib/http';
import { useSession } from '@/shared/lib/use-session';
import { Button } from '@/shared/ui/button';
import { Field, FieldError, Input } from '@/shared/ui/field';
import { Honeypot, Turnstile, turnstileRequired, type TurnstileHandle } from '@/shared/ui/turnstile';
import { authApi } from '../api';
import { LoginSchema, fieldErrors, humanFields, safeNext, type FieldErrors } from '../schemas';
import { AuthCard, FormAlert } from './AuthCard';

interface LoginState {
  email: string;
  errors: FieldErrors;
  formError?: string;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const session = useSession();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  // Sesión ya activa (login correcto o recuperada con la cookie de refresh) → a `next`.
  // «?vista=previa» (panel «Pantalla de entrada»): el equipo ve la pantalla sin que lo redirija.
  const preview = params.get('vista') === 'previa';
  useEffect(() => {
    if (session.status === 'authenticated' && !preview) router.replace(next);
  }, [session.status, next, router, preview]);

  const [state, submit, pending] = useActionState(async (_previous: LoginState, formData: FormData): Promise<LoginState> => {
    const email = String(formData.get('email') ?? '');
    const parsed = LoginSchema.safeParse({ email, password: formData.get('password'), ...humanFields(formData, captcha) });
    if (!parsed.success) return { email, errors: fieldErrors(parsed.error) };
    if (turnstileRequired() && !captcha) return { email, errors: {}, formError: 'Completa la verificación anti-bot.' };
    try {
      await authApi.login(parsed.data);
      return { email, errors: {} };
    } catch (err) {
      turnstile.current?.reset(); // cada token de Turnstile es de un solo uso
      return { email, errors: {}, formError: err instanceof ApiError ? err.message : 'No pudimos conectar con el servidor.' };
    }
  }, { email: '', errors: {} });

  return (
    <AuthCard
      title="Entra a tu cuenta"
      description="Sigue con tus favoritos, chats y reservas."
      tab="login"
      footer={
        <>
          <p>
            ¿Primera vez aquí?{' '}
            <Link href={`/registro?next=${encodeURIComponent(next)}`} className="font-bold text-brand-fg underline underline-offset-[3px]">
              Crea tu cuenta gratis
            </Link>
          </p>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[13px]">
            <ShieldCheck className="size-4 shrink-0" aria-hidden />
            Nunca te pediremos tu contraseña por chat, WhatsApp ni llamada.
          </p>
        </>
      }
    >
      {params.get('restablecida') && <div className="mb-4"><FormAlert tone="success">Contraseña actualizada. Inicia sesión con la nueva.</FormAlert></div>}
      <form action={submit} noValidate className="relative grid gap-4">
        <Honeypot />
        <Field label="Correo electrónico" htmlFor="email" error={state.errors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="tu@correo.com" defaultValue={state.email} aria-invalid={Boolean(state.errors.email)} aria-describedby="email-error" className="h-[50px] rounded-[14px]" />
        </Field>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2.5">
            <label htmlFor="password" className="text-sm font-semibold">
              Contraseña
            </label>
            <Link href="/recuperar" className="text-[13px] font-bold text-brand-fg underline underline-offset-[3px]">
              ¿La olvidaste?
            </Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" placeholder="Tu contraseña" aria-invalid={Boolean(state.errors.password)} aria-describedby="password-error" className="h-[50px] rounded-[14px]" />
          <FieldError id="password-error">{state.errors.password}</FieldError>
        </div>
        <Turnstile ref={turnstile} action="login" onToken={setCaptcha} />
        {state.formError && <FormAlert>{state.formError}</FormAlert>}
        <Button type="submit" size="lg" className="h-[52px] w-full text-base" loading={pending} disabled={turnstileRequired() && !captcha}>
          Entrar
        </Button>
      </form>
    </AuthCard>
  );
}
