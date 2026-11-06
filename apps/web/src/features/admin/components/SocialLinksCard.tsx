'use client';

import { SOCIAL_NETWORK_LABELS, SOCIAL_NETWORKS, SocialLinkSchema, type SocialLinkDTO, type SocialNetwork } from '@automarket/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field, Input } from '@/shared/ui/field';
import { useToast } from '@/shared/ui/toaster';
import { adminApi, adminKeys } from '../api';

const PLACEHOLDERS: Record<SocialNetwork, string> = {
  INSTAGRAM: 'https://www.instagram.com/tu_cuenta',
  TIKTOK: 'https://www.tiktok.com/@tu_cuenta',
  FACEBOOK: 'https://www.facebook.com/tu_pagina',
  WHATSAPP: 'https://wa.me/584141234567',
  YOUTUBE: 'https://www.youtube.com/@tu_canal',
  X: 'https://x.com/tu_cuenta',
  TELEGRAM: 'https://t.me/tu_canal',
  LINKEDIN: 'https://www.linkedin.com/company/tu_empresa',
};

/**
 * Redes que se muestran en el login, la landing y el pie. Solo aparecen las que tienen enlace,
 * y cada enlace debe ser de su red (la API lo vuelve a comprobar).
 */
export function SocialLinksCard({ links }: { links: SocialLinkDTO[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const current = new Map(links.map(link => [link.network, link.url]));
  const [errors, setErrors] = useState<Partial<Record<SocialNetwork, string>>>({});
  const save = useMutation({
    mutationFn: adminApi.updateSocialLinks,
    onSuccess: data => {
      queryClient.setQueryData(adminKeys.settings, data);
      void queryClient.invalidateQueries({ queryKey: adminKeys.history });
      toast({ tone: 'success', title: 'Redes guardadas', description: data.socialLinks.length ? 'Ya se ven en el login y en la landing.' : 'No se muestra ninguna red.' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudieron guardar', description: err.message }),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next: SocialLinkDTO[] = [];
    const found: Partial<Record<SocialNetwork, string>> = {};
    for (const network of SOCIAL_NETWORKS) {
      const url = String(data.get(network) ?? '').trim();
      if (!url) continue;
      const parsed = SocialLinkSchema.safeParse({ network, url });
      if (parsed.success) next.push(parsed.data);
      else found[network] = parsed.error.issues[0]?.message;
    }
    setErrors(found);
    if (Object.keys(found).length === 0) save.mutate(next);
  }

  return (
    <Card className="p-5">
      <h2 className="text-lg font-extrabold">Redes sociales</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">Se muestran en el login, la landing y el pie de página. Deja vacía la red que no uses.</p>
      <form onSubmit={onSubmit} className="mt-5 grid gap-4 sm:grid-cols-2" noValidate>
        {SOCIAL_NETWORKS.map(network => (
          <Field key={network} label={SOCIAL_NETWORK_LABELS[network]} htmlFor={`social-${network}`} error={errors[network]}>
            <Input id={`social-${network}`} name={network} type="url" inputMode="url" defaultValue={current.get(network) ?? ''} placeholder={PLACEHOLDERS[network]} aria-invalid={Boolean(errors[network])} />
          </Field>
        ))}
        <div className="sm:col-span-2">
          <Button type="submit" loading={save.isPending}>
            Guardar redes
          </Button>
        </div>
      </form>
    </Card>
  );
}
