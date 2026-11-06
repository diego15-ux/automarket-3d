'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useActionState, useRef, useState } from 'react';
import { ApiError } from '@/shared/lib/http';
import { Button } from '@/shared/ui/button';
import { Field, Input } from '@/shared/ui/field';
import { Honeypot, Turnstile, turnstileRequired, type TurnstileHandle } from '@/shared/ui/turnstile';
import { authApi } from '../api';
import { ForgotPasswordSchema, ResetPasswordSchema, fieldErrors, humanFields, type FieldErrors } from '../schemas';
import { AuthCard, FormAlert } from './AuthCard';

const backToLogin = (
  <Link href="/login" className="link font-medium text-ink">
    Volver a iniciar sesión
  </Link>
);

interface ForgotState {
  errors: FieldErrors;
  message?: string;
  formError?: string;
}

interface ResetState {
  errors: FieldErrors;
  formError?: string;
}

/** Paso 1: pedir el enlace. La respuesta es la misma exista o no la cuenta. */
export function ForgotPasswordForm() {
  const [captcha, setCaptcha] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const [state, submit, pending] = useActionState(
    async (_previous: ForgotState, formData: FormData): Promise<ForgotState> => {
      const parsed = ForgotPasswordSchema.safeParse({ email: formData.get('email'), ...humanFields(formData, captcha) });
      if (!parsed.success) return { errors: fieldErrors(parsed.error) };
      if (turnstileRequired() && !captcha) return { errors: {}, formError: 'Completa la verificación anti-bot.' };
      try {
        return { errors: {}, message: await authApi.forgotPassword(parsed.data) };
      } catch (err) {
        turnstile.current?.reset();
        return { errors: {}, formError: err instanceof ApiError ? err.message : 'No pudimos conectar con el servidor.' };
      }
    },
    { errors: {} },
  );

  return (
    <AuthCard social={false} title="Recupera tu contraseña" description="Te enviaremos un enlace de un solo uso para elegir una contraseña nueva." footer={backToLogin}>
      {state.message ? (
        <FormAlert tone="success">{state.message} Revisa también la carpeta de spam.</FormAlert>
      ) : (
        <form action={submit} noValidate className="relative space-y-4">
          <Honeypot />
          <Field label="Correo de tu cuenta" htmlFor="email" error={state.errors.email}>
            <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="tu@correo.com" aria-invalid={Boolean(state.errors.email)} aria-describedby="email-error" />
          </Field>
          <Turnstile ref={turnstile} action="forgot_password" onToken={setCaptcha} />
          {state.formError && <FormAlert>{state.formError}</FormAlert>}
          <Button type="submit" size="lg" className="h-[52px] w-full text-base" loading={pending} disabled={turnstileRequired() && !captcha}>
            Enviar enlace
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

/** Paso 2: el enlace del correo trae ?token=…; tras cambiarla, todas las sesiones se cierran. */
export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [state, submit, pending] = useActionState(
    async (_previous: ResetState, formData: FormData): Promise<ResetState> => {
      const password = String(formData.get('password') ?? '');
      if (password !== String(formData.get('confirm') ?? '')) return { errors: { confirm: 'Las contraseñas no coinciden.' } };
      const parsed = ResetPasswordSchema.safeParse({ token, password });
      if (!parsed.success) return { errors: fieldErrors(parsed.error) };
      try {
        await authApi.resetPassword(parsed.data);
        router.replace('/login?restablecida=1');
        return { errors: {} };
      } catch (err) {
        return { errors: {}, formError: err instanceof ApiError ? err.message : 'No pudimos conectar con el servidor.' };
      }
    },
    { errors: {} },
  );

  if (token.length < 20) {
    return (
      <AuthCard social={false} title="Enlace no válido" description="El enlace está incompleto o ya caducó." footer={backToLogin}>
        <Link href="/recuperar" className="link block text-center text-sm font-medium text-ink">
          Solicitar un enlace nuevo
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard social={false} title="Elige una contraseña nueva" description="Por seguridad cerraremos la sesión en todos tus dispositivos." footer={backToLogin}>
      <form action={submit} noValidate className="space-y-4">
        <Field label="Contraseña nueva" htmlFor="password" error={state.errors.password ?? state.errors.token}>
          <Input id="password" name="password" type="password" autoComplete="new-password" placeholder="Mínimo 8 caracteres, letras y números" aria-invalid={Boolean(state.errors.password)} aria-describedby="password-error" />
        </Field>
        <Field label="Repite la contraseña" htmlFor="confirm" error={state.errors.confirm}>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" aria-invalid={Boolean(state.errors.confirm)} aria-describedby="confirm-error" />
        </Field>
        {state.formError && <FormAlert>{state.formError}</FormAlert>}
        <Button type="submit" size="lg" className="h-[52px] w-full text-base" loading={pending}>
          Guardar contraseña
        </Button>
      </form>
    </AuthCard>
  );
}
