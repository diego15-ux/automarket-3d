'use client';

import { MAX_VEHICLE_IMAGE_BYTES, MAX_VEHICLE_MEDIA, MAX_VEHICLE_VIDEO_BYTES, VEHICLE_IMAGE_TYPES, VEHICLE_VIDEO_TYPES, type VehicleMediaDTO } from '@automarket/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ImagePlus, Play, Star, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatBytes } from '@/shared/lib/format';
import { uploadToStorage } from '@/shared/lib/upload';
import { MediaImage } from '@/shared/ui/media-image';
import { useToast } from '@/shared/ui/toaster';
import { vehicleKeys, vehiclesApi } from '../api';

const ACCEPT = [...VEHICLE_IMAGE_TYPES, ...VEHICLE_VIDEO_TYPES].join(',');

/** Metadatos que el servidor guarda: dimensiones de la foto o duración del vídeo. */
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
 * Galería del anuncio (máx. 10 fotos o vídeos): subida directa a S3 con URL prefirmada,
 * progreso, orden (la primera FOTO es la portada del catálogo) y borrado.
 */
export function MediaManager({ vehicleId, media }: { vehicleId: string; media: VehicleMediaDTO[] }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Array<{ name: string; progress: number }>>([]);
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: vehicleKeys.edit(vehicleId) });
  const free = MAX_VEHICLE_MEDIA - media.length;

  async function addFiles(files: File[]) {
    const accepted = files.slice(0, Math.max(0, free - uploads.length));
    if (files.length > accepted.length) toast({ tone: 'error', title: `Máximo ${MAX_VEHICLE_MEDIA} archivos por anuncio` });
    for (const file of accepted) {
      const isVideo = file.type.startsWith('video/');
      if (file.size > (isVideo ? MAX_VEHICLE_VIDEO_BYTES : MAX_VEHICLE_IMAGE_BYTES)) {
        toast({ tone: 'error', title: `${file.name} es demasiado grande`, description: `Máximo ${formatBytes(isVideo ? MAX_VEHICLE_VIDEO_BYTES : MAX_VEHICLE_IMAGE_BYTES)}.` });
        continue;
      }
      setUploads(list => [...list, { name: file.name, progress: 0 }]);
      try {
        const [presigned, metadata] = await Promise.all([vehiclesApi.presignMedia(vehicleId, file), readMetadata(file)]);
        await uploadToStorage(presigned, file, progress => setUploads(list => list.map(item => (item.name === file.name ? { ...item, progress } : item))));
        await vehiclesApi.registerMedia(vehicleId, { key: presigned.key, ...metadata });
        await refresh();
      } catch (err) {
        toast({ tone: 'error', title: `No se pudo subir ${file.name}`, description: err instanceof Error ? err.message : undefined });
      } finally {
        setUploads(list => list.filter(item => item.name !== file.name));
      }
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (err) {
      toast({ tone: 'error', title: 'No se pudo actualizar la galería', description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  const move = (index: number, delta: number) => {
    const order = media.map(item => item.id);
    const [moved] = order.splice(index, 1);
    order.splice(index + delta, 0, moved!);
    return run(() => vehiclesApi.reorderMedia(vehicleId, order));
  };
  const coverId = media.find(item => item.kind === 'IMAGE')?.id;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {media.map((item, index) => (
          <figure key={item.id} className="group relative aspect-[4/3] overflow-hidden rounded-md border border-line bg-sunken">
            {item.kind === 'VIDEO' ? (
              <video src={item.url} muted playsInline preload="metadata" className="size-full object-cover" />
            ) : (
              <MediaImage src={item.url} alt={`Archivo ${index + 1}`} fill sizes="200px" className="object-cover" />
            )}
            <div className="absolute top-2 left-2 flex gap-1">
              {item.id === coverId && (
                <span className="flex items-center gap-1 rounded-full bg-gold px-2 py-0.5 text-[10px] font-semibold text-ink">
                  <Star className="size-3" /> Portada
                </span>
              )}
              {item.kind === 'VIDEO' && (
                <span className="flex items-center gap-1 rounded-full bg-black/80 px-2 py-0.5 text-[10px] font-semibold text-white">
                  <Play className="size-3" /> Vídeo
                </span>
              )}
            </div>
            <div className="absolute inset-x-2 bottom-2 flex justify-between opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <div className="flex gap-1">
                <button type="button" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label="Mover antes" className="grid size-8 place-items-center rounded-full bg-black/60 text-white disabled:opacity-40">
                  <ChevronLeft className="size-4" />
                </button>
                <button type="button" disabled={busy || index === media.length - 1} onClick={() => move(index, 1)} aria-label="Mover después" className="grid size-8 place-items-center rounded-full bg-black/60 text-white disabled:opacity-40">
                  <ChevronRight className="size-4" />
                </button>
              </div>
              <button type="button" disabled={busy} onClick={() => run(() => vehiclesApi.removeMedia(vehicleId, item.id))} aria-label="Eliminar" className="grid size-8 place-items-center rounded-full bg-danger/85 text-white">
                <Trash2 className="size-4" />
              </button>
            </div>
          </figure>
        ))}
        {uploads.map(upload => (
          <div key={upload.name} className="grid aspect-[4/3] place-items-center rounded-md border border-dashed border-brand/50 bg-brand/[0.07] p-3 text-center">
            <div className="w-full">
              <p className="truncate text-xs">{upload.name}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
              </div>
            </div>
          </div>
        ))}
        {free - uploads.length > 0 && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault();
              void addFiles([...event.dataTransfer.files]);
            }}
            className="grid aspect-[4/3] place-items-center rounded-md border border-dashed border-line text-sm text-muted transition hover:border-brand hover:text-ink"
          >
            <span className="flex flex-col items-center gap-1.5">
              <ImagePlus className="size-6" /> Añadir fotos o vídeos
            </span>
          </button>
        )}
      </div>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={event => void addFiles([...(event.target.files ?? [])]).finally(() => (event.target.value = ''))} />
      <p className="mt-3 text-xs text-muted">
        {media.length}/{MAX_VEHICLE_MEDIA} archivos · Fotos JPG, PNG o WebP (máx. {formatBytes(MAX_VEHICLE_IMAGE_BYTES)}) y vídeos MP4, WebM o MOV (máx. {formatBytes(MAX_VEHICLE_VIDEO_BYTES)}). La primera foto es la portada del catálogo.
      </p>
      {media.length > 0 && media.every(item => item.kind === 'VIDEO') && <p className="mt-2 text-xs text-gold-fg">Añade al menos una foto: será la portada del anuncio.</p>}
    </div>
  );
}
