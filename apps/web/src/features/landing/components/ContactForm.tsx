'use client';

import { ContactSchema } from '@automarket/contracts';
import { useActionState, useRef, useState } from 'react';
import { fieldErrors, humanFields, type FieldErrors } from '@/features/auth/schemas';
import { FormAlert } from '@/features/auth/components/AuthCard';
import { ApiError, apiFetch } from '@/shared/lib/http';
import { Button } from '@/shared/ui/button';
import { Field, Input, Textarea } from '@/shared/ui/field';
import { Honeypot, Turnstile, turnstileRequired, type TurnstileHandle } from '@/shared/ui/turnstile';

interface ContactState {
  errors: FieldErrors;
  sent?: string;
  formError?: string;
}

/** Formulario de contacto protegido con Turnstile + honeypot + límite por IP en Redis. */
export function ContactForm() {
  const [captcha, setCaptcha] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const [state, submit, pending] = useActionState(async (_previous: ContactState, formData: FormData): Promise<ContactState> => {
    const parsed = ContactSchema.safeParse({
      name: formData.get('name'),
      email: formData.get('email'),
      subject: String(formData.get('subject') ?? '') || undefined,
      message: formData.get('message'),
      ...humanFields(formData, captcha),
    });
    if (!parsed.success) return { errors: fieldErrors(parsed.error) };
    if (turnstileRequired() && !captcha) return { errors: {}, formError: 'Completa la verificación anti-bot.' };
    try {
      const res = await apiFetch<{ data: { message: string } }>('/api/public/contact', { method: 'POST', body: parsed.data, skipRefresh: true });
      return { errors: {}, sent: res.data.message };
    } catch (err) {
      turnstile.current?.reset();
      return { errors: {}, formError: err instanceof ApiError ? err.message : 'No pudimos enviar tu mensaje.' };
    }
  }, { errors: {} });

  if (state.sent) return <FormAlert tone="success">{state.sent}</FormAlert>;

  return (
    <form action={submit} noValidate className="relative grid gap-4 sm:grid-cols-2">
      <Honeypot />
      <Field label="Nombre" htmlFor="contact-name" error={state.errors.name}>
        <Input id="contact-name" name="name" autoComplete="name" aria-invalid={Boolean(state.errors.name)} />
      </Field>
      <Field label="Correo" htmlFor="contact-email" error={state.errors.email}>
        <Input id="contact-email" name="email" type="email" autoComplete="email" aria-invalid={Boolean(state.errors.email)} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Asunto (opcional)" htmlFor="contact-subject" error={state.errors.subject}>
          <Input id="contact-subject" name="subject" />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Mensaje" htmlFor="contact-message" error={state.errors.message}>
          <Textarea id="contact-message" name="message" rows={4} aria-invalid={Boolean(state.errors.message)} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Turnstile ref={turnstile} action="contact" onToken={setCaptcha} />
      </div>
      {state.formError && (
        <div className="sm:col-span-2">
          <FormAlert>{state.formError}</FormAlert>
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" loading={pending} disabled={turnstileRequired() && !captcha}>
          Enviar mensaje
        </Button>
      </div>
    </form>
  );
}
