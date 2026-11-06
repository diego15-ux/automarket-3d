'use client';

import { LOGIN_BACKGROUND_TYPES, MAX_LOGIN_BACKGROUND_BYTES, TermsUpdateSchema } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, ImagePlus, PencilLine, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { HOME_HERO_DEFAULT, LOGIN_BG_DEFAULT } from '@/features/landing/hero';
import { formatDate } from '@/shared/lib/format';
import { uploadToStorage, type PresignedUpload } from '@/shared/lib/upload';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Textarea } from '@/shared/ui/field';
import { PageSpinner } from '@/shared/ui/spinner';
import { TermsContent } from '@/shared/ui/terms-content';
import { useToast } from '@/shared/ui/toaster';
import { adminApi, adminKeys } from '../api';

interface SiteImageEditorProps {
  title: string;
  description: string;
  /** Foto subida desde el panel (null: se usa la predeterminada o ninguna). */
  url: string | null;
  /** Foto que se ve cuando no hay una subida (la portada trae una de fábrica). */
  fallbackUrl?: string;
  emptyHint: string;
  resetLabel: string;
  savedTitle: string;
  resetTitle: string;
  viewHref: string;
  viewLabel: string;
  presign: (input: { mimeType: string; sizeBytes: number }) => Promise<PresignedUpload>;
  save: (key: string) => Promise<unknown>;
  reset: () => Promise<unknown>;
}

/**
 * Foto del sitio que cambia el panel (portada o fondo del login): se sube directa al bucket
 * público y su ruta queda guardada en MySQL; la web la lee en cada visita.
 */
function SiteImageEditor({ title, description, url, fallbackUrl, emptyHint, resetLabel, savedTitle, resetTitle, viewHref, viewLabel, presign, save, reset }: SiteImageEditorProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const done = (message: string) => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.settings });
    toast({ tone: 'success', title: message });
  };
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!(LOGIN_BACKGROUND_TYPES as readonly string[]).includes(file.type)) throw new Error('Usa una imagen JPG, PNG o WebP.');
      if (file.size > MAX_LOGIN_BACKGROUND_BYTES) throw new Error('La imagen no puede superar 8 MB.');
      const presigned = await presign({ mimeType: file.type, sizeBytes: file.size });
      await uploadToStorage(presigned, file, setProgress);
      return save(presigned.key);
    },
    onSuccess: () => done(savedTitle),
    onError: err => toast({ tone: 'error', title: 'No se pudo subir la imagen', description: err.message }),
    onSettled: () => setProgress(null),
  });
  const remove = useMutation({
    mutationFn: reset,
    onSuccess: () => done(resetTitle),
    onError: err => toast({ tone: 'error', title: 'No se pudo quitar', description: err.message }),
  });
  const shown = url ?? fallbackUrl ?? null;

  return (
    <Card className="p-5">
      <h2 className="text-lg font-extrabold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-[18rem_1fr] sm:items-start">
        <div className="relative aspect-video overflow-hidden rounded-md border border-line bg-sunken">
          {/* eslint-disable-next-line @next/next/no-img-element -- vista previa del archivo del CDN de medios */}
          {shown && <img src={shown} alt={`${title}: foto actual`} className="size-full object-cover" />}
          {!url && <span className="absolute bottom-2 left-2 rounded-sm bg-black/60 px-2 py-0.5 text-xs text-white">{emptyHint}</span>}
        </div>
        <div className="space-y-3">
          <input
            ref={input}
            type="file"
            accept={LOGIN_BACKGROUND_TYPES.join(',')}
            hidden
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
              event.target.value = '';
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button loading={upload.isPending} onClick={() => input.current?.click()}>
              <ImagePlus className="size-4" /> {url ? 'Cambiar imagen' : 'Subir imagen'}
            </Button>
            {url && (
              <Button variant="outline" loading={remove.isPending} onClick={() => remove.mutate()}>
                <Trash2 className="size-4" /> {resetLabel}
              </Button>
            )}
          </div>
          {progress !== null && (
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          <a href={viewHref} target="_blank" rel="noreferrer" className="inline-block text-sm font-semibold text-brand-fg hover:underline">
            {viewLabel}
          </a>
        </div>
      </div>
    </Card>
  );
}

/** Editor de Términos y Condiciones (texto simple con «#», «##» y «- »), con vista previa. */
function TermsEditor({ content, updatedAt }: { content: string; updatedAt: string | null }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(content);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: adminApi.updateTerms,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.settings });
      toast({ tone: 'success', title: 'Términos publicados', description: 'Ya se ven en /terminos.' });
    },
    onError: err => setError(err.message),
  });

  function publish() {
    const parsed = TermsUpdateSchema.safeParse({ content: draft });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    save.mutate(parsed.data.content);
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">Términos y Condiciones</h2>
          <p className="mt-1 text-sm text-muted">
            {updatedAt ? `Publicados el ${formatDate(updatedAt)}.` : 'Se muestran los Términos iniciales.'} Formato: cada «# Título» es un documento (Términos, Privacidad, Cookies…); el texto antes del primer «##» es su introducción; «## Sección» (se numeran solas), párrafos y listas con «- ».
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPreview(value => !value)} aria-pressed={preview}>
            {preview ? <PencilLine className="size-4" /> : <Eye className="size-4" />} {preview ? 'Editar' : 'Vista previa'}
          </Button>
          <a href="/terminos" target="_blank" rel="noreferrer" className="self-center text-sm font-semibold text-brand-fg hover:underline">
            Ver página
          </a>
        </div>
      </div>
      <div className="mt-4">
        {preview ? (
          <div className="max-h-[32rem] overflow-y-auto rounded-md border border-line p-5">
            <TermsContent content={draft} />
          </div>
        ) : (
          <Textarea value={draft} onChange={event => setDraft(event.target.value)} rows={20} className="font-mono text-xs leading-relaxed" aria-label="Contenido de los Términos y Condiciones" />
        )}
      </div>
      {error && <p className="mt-2 text-xs text-danger-fg">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button loading={save.isPending} disabled={draft === content} onClick={publish}>
          Publicar Términos
        </Button>
        {draft !== content && (
          <Button variant="ghost" size="sm" onClick={() => setDraft(content)}>
            Descartar cambios
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Ajustes del sitio: foto de la portada, fondo del login y Términos y Condiciones (todo en MySQL). */
export function AdminSiteSettings() {
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: adminApi.settings });
  if (settings.isPending) return <PageSpinner />;
  if (settings.isError) return <p className="text-danger-fg">{settings.error.message}</p>;
  return (
    // Trae su propia cabecera (data-own-header oculta la de la ruta, que en la PC no se puede cambiar).
    <div data-own-header className="space-y-8">
      <div className="mb-6">
        <p className="text-[13px] text-muted">Administración</p>
        <h1 className="mt-0.5 font-display text-[28px] leading-tight text-balance sm:text-[32px]">Portada, login y Términos</h1>
        <p className="mt-1 max-w-2xl text-[14.5px] text-pretty text-muted">La foto de la portada, el fondo del login y el editor de los Términos y políticas.</p>
      </div>
      <SiteImageEditor
        title="Foto de la portada"
        description="La foto grande de la página de inicio, detrás del titular. JPG, PNG o WebP de hasta 8 MB; mejor horizontal, de 1920 px o más, con el auto hacia la derecha."
        url={settings.data.homeHeroUrl}
        fallbackUrl={HOME_HERO_DEFAULT}
        emptyHint="Foto predeterminada"
        resetLabel="Usar la foto predeterminada"
        savedTitle="Foto de la portada actualizada"
        resetTitle="Portada con la foto predeterminada"
        viewHref="/"
        viewLabel="Ver la portada"
        presign={adminApi.presignHomeHero}
        save={adminApi.setHomeHero}
        reset={adminApi.removeHomeHero}
      />
      <SiteImageEditor
        title="Fondo del login"
        description="Imagen de fondo de las pantallas de acceso (login, registro y recuperación). JPG, PNG o WebP de hasta 8 MB; mejor horizontal, de 1920 px o más."
        url={settings.data.loginBackgroundUrl}
        fallbackUrl={LOGIN_BG_DEFAULT}
        emptyHint="Foto predeterminada"
        resetLabel="Usar la foto predeterminada"
        savedTitle="Fondo del login actualizado"
        resetTitle="Login con la foto predeterminada"
        viewHref="/login"
        viewLabel="Ver el login"
        presign={adminApi.presignLoginBackground}
        save={adminApi.setLoginBackground}
        reset={adminApi.removeLoginBackground}
      />
      <TermsEditor key={settings.data.terms.updatedAt ?? 'inicial'} content={settings.data.terms.content} updatedAt={settings.data.terms.updatedAt} />
    </div>
  );
}
