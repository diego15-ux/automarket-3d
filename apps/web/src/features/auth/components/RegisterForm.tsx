'use client';

import { COUNTRIES, type AccountType } from '@automarket/contracts';
import { Building2, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { ApiError } from '@/shared/lib/http';
import { useSession } from '@/shared/lib/use-session';
import { Button } from '@/shared/ui/button';
import { Field, FieldError, Input, Select } from '@/shared/ui/field';
import { Honeypot, Turnstile, turnstileRequired, type TurnstileHandle } from '@/shared/ui/turnstile';
import { authApi } from '../api';
import { RegisterSchema, fieldErrors, humanFields, passwordStrength, safeNext, type FieldErrors } from '../schemas';
import { AuthCard, FormAlert } from './AuthCard';

type TextField = 'name' | 'email' | 'country' | 'city' | 'businessName' | 'taxId' | 'fiscalAddress' | 'businessPhone';
const TEXT_FIELDS: TextField[] = ['name', 'email', 'country', 'city', 'businessName', 'taxId', 'fiscalAddress', 'businessPhone'];
const EMPTY = Object.fromEntries(TEXT_FIELDS.map(field => [field, ''])) as Record<TextField, string>;

interface RegisterState {
  values: Record<TextField, string>;
  errors: FieldErrors;
  formError?: string;
}

const ACCOUNT_OPTIONS: Array<{ value: AccountType; title: string; text: string; icon: typeof User }> = [
  { value: 'INDIVIDUAL', title: 'Persona natural', text: 'Compras o vendes tus propios vehículos.', icon: User },
  { value: 'DEALER', title: 'Concesionario', text: 'Empresa con RIF: insignia y datos fiscales visibles.', icon: Building2 },
];

const STRENGTH = [
  { label: 'Usa 8+ caracteres con letras y números.', color: '' },
  { label: 'Seguridad: débil', color: 'bg-danger' },
  { label: 'Seguridad: aceptable', color: 'bg-gold' },
  { label: 'Seguridad: buena', color: 'bg-ink/70' },
  { label: 'Seguridad: excelente', color: 'bg-success' },
] as const;

/** País sugerido a partir del idioma del navegador (es-MX → MX); el usuario lo confirma. */
const guessCountry = () => {
  if (typeof navigator === 'undefined') return '';
  const region = navigator.language.split('-')[1]?.toUpperCase();
  return COUNTRIES.some(country => country.code === region) ? (region ?? '') : '';
};

export function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const session = useSession();
  // «Hazte aliado» (directorio de concesionarios) abre el registro con «Concesionario» elegido.
  const [accountType, setAccountType] = useState<AccountType>(params.get('tipo') === 'concesionario' ? 'DEALER' : 'INDIVIDUAL');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const strength = passwordStrength(password);
  const meter = STRENGTH[strength] ?? STRENGTH[0];

  useEffect(() => {
    if (session.status === 'authenticated') router.replace(next);
  }, [session.status, next, router]);

  const [state, submit, pending] = useActionState(
    async (_previous: RegisterState, formData: FormData): Promise<RegisterState> => {
      const values = Object.fromEntries(TEXT_FIELDS.map(field => [field, String(formData.get(field) ?? '')])) as Record<TextField, string>;
      const parsed = RegisterSchema.safeParse({
        ...values,
        accountType: formData.get('accountType'),
        password: formData.get('password'),
        acceptTerms: formData.get('acceptTerms') === 'on',
        ...humanFields(formData, captcha),
      });
      if (!parsed.success) return { values, errors: fieldErrors(parsed.error) };
      if (turnstileRequired() && !captcha) return { values, errors: {}, formError: 'Completa la verificación anti-bot.' };
      try {
        await authApi.register(parsed.data);
        return { values, errors: {} };
      } catch (err) {
        turnstile.current?.reset();
        if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') return { values, errors: { email: err.message } };
        if (err instanceof ApiError && err.code === 'TAX_ID_TAKEN') return { values, errors: { taxId: err.message } };
        return { values, errors: {}, formError: err instanceof ApiError ? err.message : 'No pudimos conectar con el servidor.' };
      }
    },
    { values: EMPTY, errors: {} },
  );
  const dealer = accountType === 'DEALER';

  return (
    <AuthCard
      title="Crea tu cuenta"
      description="Gratis. Con la misma cuenta compras, reservas y publicas."
      tab="register"
      footer={
        <>
          ¿Ya tienes cuenta?{' '}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-bold text-brand-fg underline underline-offset-[3px]">
            Entrar
          </Link>
        </>
      }
    >
      <form action={submit} noValidate className="relative grid gap-4">
        <Honeypot />
        <fieldset>
          <legend className="mb-1.5 text-sm font-bold">Tipo de cuenta</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ACCOUNT_OPTIONS.map(option => (
              <label
                key={option.value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-[14px] border p-3.5 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand',
                  accountType === option.value ? 'border-brand bg-soft ring-1 ring-brand' : 'border-edge hover:border-ink',
                )}
              >
                <input type="radio" name="accountType" value={option.value} checked={accountType === option.value} onChange={() => setAccountType(option.value)} className="sr-only" />
                <span aria-hidden className={cn('mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border-2', accountType === option.value ? 'border-brand' : 'border-edge')}>{accountType === option.value && <span className="size-2 rounded-full bg-brand" />}</span>
                <span>
                  <span className="block text-sm font-bold">{option.title}</span>
                  <span className="mt-0.5 block text-[13px] text-muted">{option.text}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={dealer ? 'Nombre del responsable' : 'Nombre completo'} htmlFor="name" error={state.errors.name}>
          <Input id="name" name="name" autoComplete="name" placeholder="Ej. Ana Martínez" defaultValue={state.values.name} aria-invalid={Boolean(state.errors.name)} aria-describedby="name-error" />
        </Field>
        <Field label="Correo electrónico" htmlFor="email" error={state.errors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="tu@correo.com" defaultValue={state.values.email} aria-invalid={Boolean(state.errors.email)} aria-describedby="email-error" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="País" htmlFor="country" error={state.errors.country}>
            <Select id="country" name="country" autoComplete="country" defaultValue={state.values.country || guessCountry()} aria-invalid={Boolean(state.errors.country)} aria-describedby="country-error">
              <option value="">Selecciona…</option>
              {COUNTRIES.map(country => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ciudad" htmlFor="city" error={state.errors.city}>
            <Input id="city" name="city" autoComplete="address-level2" placeholder="Ej. Caracas" defaultValue={state.values.city} aria-invalid={Boolean(state.errors.city)} aria-describedby="city-error" />
          </Field>
        </div>
        {dealer && (
          <fieldset className="space-y-4 border-t border-line pt-5">
            <legend className="pr-3 font-display text-lg">Datos fiscales del concesionario</legend>
            <Field label="Razón social" htmlFor="businessName" error={state.errors.businessName}>
              <Input id="businessName" name="businessName" autoComplete="organization" placeholder="Ej. Autos del Centro C.A." defaultValue={state.values.businessName} aria-invalid={Boolean(state.errors.businessName)} aria-describedby="businessName-error" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="RIF" htmlFor="taxId" error={state.errors.taxId} hint="Formato J-12345678-9">
                <Input id="taxId" name="taxId" placeholder="J-12345678-9" defaultValue={state.values.taxId} aria-invalid={Boolean(state.errors.taxId)} aria-describedby="taxId-error" className="" />
              </Field>
              <Field label="Teléfono corporativo" htmlFor="businessPhone" error={state.errors.businessPhone}>
                <Input id="businessPhone" name="businessPhone" type="tel" autoComplete="tel" placeholder="+58 212 555 0000" defaultValue={state.values.businessPhone} aria-invalid={Boolean(state.errors.businessPhone)} aria-describedby="businessPhone-error" />
              </Field>
            </div>
            <Field label="Dirección fiscal" htmlFor="fiscalAddress" error={state.errors.fiscalAddress}>
              <Input id="fiscalAddress" name="fiscalAddress" autoComplete="street-address" placeholder="Av., edificio, piso, ciudad" defaultValue={state.values.fiscalAddress} aria-invalid={Boolean(state.errors.fiscalAddress)} aria-describedby="fiscalAddress-error" />
            </Field>
          </fieldset>
        )}
        <Field label="Contraseña" htmlFor="password" error={state.errors.password}>
          <Input id="password" name="password" type="password" autoComplete="new-password" placeholder="Mínimo 8 caracteres" value={password} onChange={event => setPassword(event.target.value)} aria-invalid={Boolean(state.errors.password)} aria-describedby="password-error password-strength" />
        </Field>
        <div id="password-strength" aria-live="polite">
          <div className="grid grid-cols-4 gap-1.5" aria-hidden>
            {[0, 1, 2, 3].map(index => (
              <span key={index} className={`h-0.5 ${index < strength ? meter.color : 'bg-line'}`} />
            ))}
          </div>
          <p className="mt-1.5 text-[13px] text-muted">{meter.label}</p>
        </div>
        <div>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-muted">
            <input type="checkbox" name="acceptTerms" className="mt-0.5 size-4 accent-ink" aria-describedby="acceptTerms-error" />
            <span>
              Acepto los{' '}
              <a href="/terminos" target="_blank" rel="noreferrer" className="link text-ink">
                Términos y Condiciones
              </a>{' '}
              (reservas P2P, comisión post-venta y verificación de identidad).
            </span>
          </label>
          <FieldError id="acceptTerms-error">{state.errors.acceptTerms}</FieldError>
        </div>
        <Turnstile ref={turnstile} action="register" onToken={setCaptcha} />
        {state.formError && <FormAlert>{state.formError}</FormAlert>}
        <Button type="submit" size="lg" className="h-[52px] w-full text-base" loading={pending} disabled={turnstileRequired() && !captcha}>
          Crear cuenta
        </Button>
      </form>
    </AuthCard>
  );
}
