'use client';

import { MAX_VEHICLE_IMAGE_BYTES, MAX_VEHICLE_MEDIA, MAX_VEHICLE_VIDEO_BYTES, VEHICLE_IMAGE_TYPES, VEHICLE_VIDEO_TYPES, type VehicleMediaDTO } from '@automarket/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, CircleAlert, Play, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatBytes } from '@/shared/lib/format';
import { uploadToStorage } from '@/shared/lib/upload';
import { MediaImage } from '@/shared/ui/media-image';
import { useToast } from '@/shared/ui/toaster';
import { vehicleKeys, vehiclesApi } from '../api';
import { SUGGESTED_SHOTS } from '../publish-form';

/** Foto o video elegido antes de que exista el borrador: se ve aquí y se sube al crearlo. */
export interface QueuedMedia {
  id: string;
  file: File;
  url: string;
  kind: 'IMAGE' | 'VIDEO';
}

interface Upload {
  id: string;
  name: string;
  progress: number;
}

const IMAGE_TYPES: readonly string[] = VEHICLE_IMAGE_TYPES;
const VIDEO_TYPES: readonly string[] = VEHICLE_VIDEO_TYPES;
const kindOf = (file: File): 'IMAGE' | 'VIDEO' | null => (IMAGE_TYPES.includes(file.type) ? 'IMAGE' : VIDEO_TYPES.includes(file.type) ? 'VIDEO' : null);

/** Metadatos que guarda el servidor: tamaño de la foto o duración del video. */
async function readMetadata(file: File): Promise<{ width?: number; height?: number; durationMs?: number }> {
  if (file.type.startsWith('image/')) {
    const bitmap = await createImageBitmap(file).catch(() => null);
    const size = bitmap ? { width: bitmap.width, height: bitmap.height } : {};
    bitmap?.close();
    return size;
  }
  return new Promise(resolve => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(video.duration) ? { durationMs: Math.round(video.duration * 1000), width: video.videoWidth, height: video.videoHeight } : {});
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({});
    };
    video.src = url;
  });
}

/**
 * Galería del asistente: antes del borrador guarda los archivos en la página; con borrador,
 * los sube directo al almacenamiento (URL prefirmada) y los registra en la API.
 */
export function usePublishMedia(vehicleId: string | null, media: VehicleMediaDTO[]) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [queued, setQueued] = useState<QueuedMedia[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const queuedRef = useRef(queued);
  useEffect(() => {
    queuedRef.current = queued;
  }, [queued]);
  useEffect(() => () => queuedRef.current.forEach(item => URL.revokeObjectURL(item.url)), []);

  const total = media.length + queued.length + uploads.length;
  const refresh = useCallback((id: string) => queryClient.invalidateQueries({ queryKey: vehicleKeys.edit(id) }), [queryClient]);

  /** Revisa tipo y tamaño; avisa de lo que no entra. */
  const accept = useCallback(
    (files: File[], room: number) => {
      const ok: Array<{ file: File; kind: 'IMAGE' | 'VIDEO' }> = [];
      for (const file of files) {
        const kind = kindOf(file);
        if (!kind) {
          toast({ tone: 'error', title: `${file.name} no es una foto o video válido`, description: 'Fotos JPG, PNG o WebP; videos MP4, WebM o MOV.' });
          continue;
        }
        const max = kind === 'VIDEO' ? MAX_VEHICLE_VIDEO_BYTES : MAX_VEHICLE_IMAGE_BYTES;
        if (file.size > max) {
          toast({ tone: 'error', title: `${file.name} pesa demasiado`, description: `Máximo ${formatBytes(max)}.` });
          continue;
        }
        if (ok.length >= room) {
          toast({ tone: 'error', title: `Máximo ${MAX_VEHICLE_MEDIA} fotos o videos por anuncio` });
          break;
        }
        ok.push({ file, kind });
      }
      return ok;
    },
    [toast],
  );

  const uploadAll = useCallback(
    async (id: string, files: File[]) => {
      for (const file of files) {
        const uploadId = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`;
        setUploads(list => [...list, { id: uploadId, name: file.name, progress: 0 }]);
        try {
          const [presigned, metadata] = await Promise.all([vehiclesApi.presignMedia(id, file), readMetadata(file)]);
          await uploadToStorage(presigned, file, progress => setUploads(list => list.map(item => (item.id === uploadId ? { ...item, progress } : item))));
          await vehiclesApi.registerMedia(id, { key: presigned.key, ...metadata });
          await refresh(id);
        } catch (err) {
          toast({ tone: 'error', title: `No se pudo subir ${file.name}`, description: err instanceof Error ? err.message : undefined });
        } finally {
          setUploads(list => list.filter(item => item.id !== uploadId));
        }
      }
    },
    [refresh, toast],
  );

  const add = useCallback(
    (files: File[]) => {
      const ok = accept(files, MAX_VEHICLE_MEDIA - total);
      if (!ok.length) return;
      if (vehicleId) void uploadAll(vehicleId, ok.map(item => item.file));
      else setQueued(list => [...list, ...ok.map(({ file, kind }) => ({ id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`, file, kind, url: URL.createObjectURL(file) }))]);
    },
    [accept, total, uploadAll, vehicleId],
  );

  /** Al crear el borrador: sube lo que estaba en espera, en el mismo orden. */
  const flush = useCallback(
    async (id: string) => {
      const pending = queuedRef.current;
      if (!pending.length) return;
      setQueued([]);
      await uploadAll(id, pending.map(item => item.file));
      pending.forEach(item => URL.revokeObjectURL(item.url));
    },
    [uploadAll],
  );

  const run = useCallback(
    async (id: string, action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
        await refresh(id);
      } catch (err) {
        toast({ tone: 'error', title: 'No se pudo actualizar la galería', description: err instanceof Error ? err.message : undefined });
      } finally {
        setBusy(false);
      }
    },
    [refresh, toast],
  );

  const remove = (mediaId: string) => vehicleId && run(vehicleId, () => vehiclesApi.removeMedia(vehicleId, mediaId));
  const makeCover = (mediaId: string) => vehicleId && run(vehicleId, () => vehiclesApi.reorderMedia(vehicleId, [mediaId, ...media.filter(item => item.id !== mediaId).map(item => item.id)]));
  const removeQueued = (id: string) =>
    setQueued(list => {
      const item = list.find(entry => entry.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return list.filter(entry => entry.id !== id);
    });
  const coverQueued = (id: string) => setQueued(list => [...list.filter(entry => entry.id === id), ...list.filter(entry => entry.id !== id)]);

  const images = media.filter(item => item.kind === 'IMAGE').length + queued.filter(item => item.kind === 'IMAGE').length;
  const coverUrl = media.find(item => item.kind === 'IMAGE')?.url ?? queued.find(item => item.kind === 'IMAGE')?.url ?? null;
  const hasVideo = media.some(item => item.kind === 'VIDEO') || queued.some(item => item.kind === 'VIDEO');

  return { queued, uploads, busy, total, images, coverUrl, hasVideo, add, flush, remove, makeCover, removeQueued, coverQueued };
}

export type PublishMedia = ReturnType<typeof usePublishMedia>;

const chip = 'inline-flex h-6 items-center rounded-full px-[9px] text-xs font-semibold';
const dark = 'bg-[rgb(10_11_11/0.72)] text-white';

export function PublishPhotos({ gallery, media, error, disabled }: { gallery: PublishMedia; media: VehicleMediaDTO[]; error: string; disabled?: boolean }) {
  const images = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLInputElement>(null);
  const count = gallery.total;
  const coverId = media.find(item => item.kind === 'IMAGE')?.id ?? null;
  const localCoverId = coverId ? null : (gallery.queued.find(item => item.kind === 'IMAGE')?.id ?? null);
  const emptySlots = SUGGESTED_SHOTS.slice(Math.min(count, SUGGESTED_SHOTS.length));
  const room = MAX_VEHICLE_MEDIA - count;
  const missing = Math.max(0, SUGGESTED_SHOTS.length - gallery.images);
  const hint = gallery.images === 0 ? 'Necesitas al menos una foto real para publicar.' : missing > 0 ? `Vas bien. Te faltan ${missing} de las tomas sugeridas.` : '¡Excelente! Tienes las tomas que más miran los compradores.';
  const nextLabel = room <= 0 ? `Llegaste a ${MAX_VEHICLE_MEDIA} archivos` : emptySlots[0] ? `Agregar foto: ${emptySlots[0]}` : `Agregar más fotos (te quedan ${room})`;
  const pickImages = () => images.current?.click();

  return (
    <div className="am-step-in grid gap-[18px]">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p aria-live="polite" className={`text-sm font-semibold ${gallery.images === 0 ? 'text-gold-fg' : 'text-brand-fg'}`}>
          {hint}
        </p>
        <span className="font-mono text-[13px] font-semibold text-muted">
          {count} de {MAX_VEHICLE_MEDIA}
        </span>
      </div>

      <ul
        aria-label="Fotos del anuncio y tomas sugeridas"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        onDragOver={event => event.preventDefault()}
        onDrop={event => {
          event.preventDefault();
          if (!disabled) gallery.add([...event.dataTransfer.files]);
        }}
      >
        {media.map(item => (
          <li key={item.id} className="am-step-in relative aspect-[4/3] overflow-hidden rounded-[16px] bg-card-tile">
            {item.kind === 'VIDEO' ? (
              <video src={item.url} muted playsInline preload="metadata" className="size-full object-cover" />
            ) : (
              <MediaImage src={item.url} alt="" fill sizes="(min-width: 640px) 220px, 45vw" className="object-cover" />
            )}
            <Badges isCover={item.id === coverId} isVideo={item.kind === 'VIDEO'} canCover={item.kind === 'IMAGE' && item.id !== coverId && !disabled} busy={gallery.busy} onCover={() => gallery.makeCover(item.id)} />
            {!disabled && <RemoveButton label={item.kind === 'VIDEO' ? 'Quitar el video' : 'Quitar esta foto'} busy={gallery.busy} onClick={() => gallery.remove(item.id)} />}
          </li>
        ))}
        {gallery.queued.map(item => (
          <li key={item.id} className="am-step-in relative aspect-[4/3] overflow-hidden rounded-[16px] bg-card-tile">
            {item.kind === 'VIDEO' ? (
              <video src={item.url} muted playsInline preload="metadata" className="size-full object-cover" />
            ) : (
              // Vista previa local (blob:) antes de subir; next/image no optimiza estas URL.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.url} alt="" className="size-full object-cover" />
            )}
            <Badges isCover={item.id === localCoverId} isVideo={item.kind === 'VIDEO'} canCover={item.kind === 'IMAGE' && item.id !== localCoverId && !disabled} busy={false} onCover={() => gallery.coverQueued(item.id)} />
            {!disabled && <RemoveButton label={item.kind === 'VIDEO' ? 'Quitar el video' : 'Quitar esta foto'} busy={false} onClick={() => gallery.removeQueued(item.id)} />}
          </li>
        ))}
        {gallery.uploads.map(upload => (
          <li key={upload.id} className="relative aspect-[4/3] overflow-hidden rounded-[16px] bg-card-tile">
            <div role="status" className="absolute inset-0 grid place-content-center justify-items-center gap-2.5 p-4 text-center text-[13px] text-muted">
              <span className="line-clamp-1 max-w-full break-all">Subiendo {upload.name}…</span>
              <span className="block h-[5px] w-[120px] overflow-hidden rounded-full bg-line">
                <span className="block h-full bg-brand transition-[width] duration-100 ease-linear" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
              </span>
            </div>
          </li>
        ))}
        {emptySlots.map(label => (
          <li key={label} className="relative aspect-[4/3] overflow-hidden rounded-[16px] bg-card-tile">
            <button
              type="button"
              disabled={disabled || room <= 0}
              aria-label={`Agregar foto: ${label}`}
              onClick={pickImages}
              className="absolute inset-0 grid w-full place-content-center justify-items-center gap-1.5 rounded-[16px] border-[1.5px] border-dashed border-field-line text-sm font-semibold text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Camera className="size-[22px]" strokeWidth={2} aria-hidden />
              {label}
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={pickImages}
        disabled={disabled || room <= 0}
        className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full border border-dashed border-field-line bg-field px-[18px] text-[14.5px] font-bold text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Camera className="size-[22px]" strokeWidth={2} aria-hidden />
        {nextLabel}
      </button>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="flex gap-1.5 text-[13px] leading-snug text-danger-fg">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.2} aria-hidden />
            <span>{error}</span>
          </p>
        )}
      </div>

      <button
        type="button"
        aria-pressed={gallery.hasVideo}
        disabled={disabled || (!gallery.hasVideo && room <= 0)}
        onClick={() => (gallery.hasVideo ? undefined : video.current?.click())}
        className="flex w-full cursor-pointer items-start gap-3 rounded-[16px] border border-line p-3.5 text-left disabled:cursor-default disabled:opacity-60 aria-pressed:cursor-default"
      >
        <span aria-hidden className={`mt-px grid size-5 shrink-0 place-items-center rounded-[5px] border-2 ${gallery.hasVideo ? 'border-brand bg-brand text-on-brand' : 'border-field-line bg-field'}`}>
          {gallery.hasVideo && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          )}
        </span>
        <span>
          <span className="block text-[15px] font-bold">{gallery.hasVideo ? 'Video agregado: el auto dando la vuelta' : 'Agregar un video dando la vuelta al auto'}</span>
          <span className="mt-[3px] block text-[13.5px] leading-[1.45] text-muted">
            {gallery.hasVideo ? 'Para cambiarlo, quítalo de la galería y agrega otro.' : `Opcional, unos 30 segundos (máx. ${Math.round(MAX_VEHICLE_VIDEO_BYTES / 1024 / 1024)} MB). Cuenta dentro de los ${MAX_VEHICLE_MEDIA} archivos.`}
          </span>
        </span>
      </button>

      <ul className="grid gap-1.5 text-[13.5px] text-muted">
        <li>· De día y con el auto limpio.</li>
        <li>· Sin filtros ni textos encima de la foto.</li>
        <li>· El tablero encendido, para que se vea el kilometraje.</li>
      </ul>

      <input ref={images} type="file" accept={VEHICLE_IMAGE_TYPES.join(',')} multiple hidden onChange={event => { gallery.add([...(event.target.files ?? [])]); event.target.value = ''; }} />
      <input ref={video} type="file" accept={VEHICLE_VIDEO_TYPES.join(',')} hidden onChange={event => { gallery.add([...(event.target.files ?? [])]); event.target.value = ''; }} />
    </div>
  );
}

function Badges({ isCover, isVideo, canCover, busy, onCover }: { isCover: boolean; isVideo: boolean; canCover: boolean; busy: boolean; onCover: () => void }) {
  return (
    <>
      {isCover && <span className={`${chip} absolute top-2 left-2 bg-brand font-bold text-on-brand`}>Portada</span>}
      {isVideo && (
        <span className={`${chip} ${dark} absolute bottom-2 left-2 gap-1`}>
          <Play className="size-3" aria-hidden /> Video
        </span>
      )}
      {canCover && (
        <button type="button" disabled={busy} onClick={onCover} className={`${chip} ${dark} absolute bottom-2 left-2 hover:bg-black/85 disabled:opacity-60`}>
          Usar de portada
        </button>
      )}
    </>
  );
}

function RemoveButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} disabled={busy} onClick={onClick} className={`absolute top-1.5 right-1.5 grid size-[34px] place-items-center rounded-full ${dark} hover:bg-black/85 disabled:opacity-60`}>
      <X className="size-3.5" strokeWidth={2.6} aria-hidden />
    </button>
  );
}
