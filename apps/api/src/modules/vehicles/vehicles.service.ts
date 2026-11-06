import { randomBytes, randomUUID } from 'node:crypto';
import {
  MAX_VEHICLE_IMAGE_BYTES,
  MAX_VEHICLE_MEDIA,
  MAX_VEHICLE_VIDEO_BYTES,
  MEDIA_KIND_OF,
  type VehicleDraftInput,
  type VehicleUpdateInput,
} from '@automarket/contracts';
import { env } from '../../config/env.js';
import { Prisma, type Vehicle } from '../../generated/prisma/client.js';
import type { ReportReason } from '../../generated/prisma/enums.js';
import { AppError } from '../../shared/errors/app-error.js';
import { catalogService } from '../catalog/catalog.service.js';
import { isUniqueViolation, prisma, runInTransaction, type Db } from '../../shared/infra/prisma.js';
import { deleteObject, presignUpload, publicMediaUrl, readObjectStart, statObject } from '../../shared/infra/storage.js';
import { assertCanTransact } from '../../shared/trust.js';
import { effectivePlan, addDays } from '../../shared/membership.js';
import { assertNoBlockedTerms } from '../../shared/moderation/blocklist.js';
import { realtime } from '../../shared/realtime.js';
import { baseMime, extensionFor, sniffImageType } from '../../shared/utils/mime.js';
import { getPlan } from '../memberships/plans.js';
import { cardSelect, detailInclude, toCardDTO, toDetailDTO, toMediaDTO } from './vehicles.mapper.js';
import { dealersService } from '../dealers/dealers.service.js';
import { recordVehicleView } from './vehicle-views.js';
import { notifyPriceDrop } from './vehicles.saved.js';
import { deliver } from '../../shared/notifications.js';

/** Estados con reservas abiertas: el anuncio no se puede editar, pausar ni retirar. */
const OPEN_RESERVE = { type: 'RESERVATION', openKey: { not: null } } satisfies Prisma.CartReserveWhereInput;
const ACTIVE_STATUSES = ['PUBLISHED', 'RESERVED'] as const;
const PUBLISH_LIMIT_STATUSES = ['PUBLISHED', 'RESERVED', 'PENDING_SALE'] as const;

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 140);

const newSlug = (input: { make: string; model: string; year: number }) => `${slugify(`${input.make} ${input.model} ${input.year}`)}-${randomBytes(3).toString('hex')}`;

const mediaPrefix = (vehicleId: string) => `vehiculos/${vehicleId}/`;

/** Bloquea la fila del vendedor: serializa publicaciones concurrentes (límite del plan). */
const lockUser = (tx: Db, userId: string) => tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
const lockVehicle = (tx: Db, vehicleId: string) => tx.$queryRaw`SELECT id FROM vehicles WHERE id = ${vehicleId} FOR UPDATE`;

async function ownVehicleOrThrow(vehicleId: string, userId: string, db: Db = prisma): Promise<Vehicle> {
  const vehicle = await db.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle || vehicle.deletedAt) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Anuncio no encontrado.');
  if (vehicle.sellerId !== userId) throw AppError.forbidden('NOT_OWNER', 'Este anuncio no es tuyo.');
  return vehicle;
}

async function assertNoOpenReservations(vehicleId: string, db: Db = prisma) {
  if ((await db.cartReserve.count({ where: { vehicleId, ...OPEN_RESERVE } })) > 0) {
    throw AppError.conflict('VEHICLE_HAS_OPEN_RESERVATIONS', 'Este anuncio tiene reservas en curso: resuélvelas antes de modificarlo.');
  }
}

/** Estados que ocupan cupo del plan al crear un anuncio nuevo (Free: 1). */
const SLOT_STATUSES = ['DRAFT', 'PUBLISHED', 'RESERVED', 'PENDING_SALE'] as const;

/**
 * Restricción estricta del plan: con el cupo lleno no se pueden CREAR anuncios nuevos
 * (borradores incluidos); hay que mejorar el plan o retirar/pausar uno. Bajo bloqueo del usuario.
 */
async function assertSlotAvailable(tx: Db, userId: string) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const plan = await getPlan(effectivePlan(user).code, tx);
  if (plan.maxActiveListings === null) return;
  const used = await tx.vehicle.count({ where: { sellerId: userId, deletedAt: null, status: { in: [...SLOT_STATUSES] } } });
  if (used >= plan.maxActiveListings) {
    throw AppError.forbidden(
      'PLAN_LIMIT_REACHED',
      `Tu plan ${plan.name} permite ${plan.maxActiveListings} ${plan.maxActiveListings === 1 ? 'publicación' : 'publicaciones'}. Mejora tu plan con Binance para publicar más.`,
      { planCode: plan.code, max: plan.maxActiveListings },
    );
  }
}

const textFields = (input: { make?: string; model?: string; version?: string | null; description?: string | null }) => ({ make: input.make, model: input.model, version: input.version, description: input.description });

export const vehiclesService = {
  // ───────────────────────────────────────────────────────── Lectura pública ──

  /** Ficha pública. Borradores, pausados o retirados solo los ve su dueño o un administrador. */
  async getBySlug(slug: string, viewer: { id: string; role: string } | null, ip: string | null = null) {
    const vehicle = await prisma.vehicle.findUnique({ where: { slug }, include: detailInclude });
    const isPublic = vehicle && !vehicle.deletedAt && (vehicle.status === 'PUBLISHED' || vehicle.status === 'RESERVED' || vehicle.status === 'SOLD');
    const canSee = vehicle && (isPublic || viewer?.id === vehicle.sellerId || viewer?.role === 'ADMIN' || viewer?.role === 'ADMIN_ONE');
    if (!vehicle || !canSee) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Vehículo no encontrado.');
    if (ip !== null) recordVehicleView(vehicle, { userId: viewer?.id ?? null, ip });
    const [rating, soldCount] = await Promise.all([
      prisma.sellerReview.aggregate({ where: { sellerId: vehicle.sellerId }, _avg: { rating: true }, _count: { _all: true } }),
      prisma.vehicle.count({ where: { sellerId: vehicle.sellerId, status: 'SOLD' } }),
    ]);
    return toDetailDTO(vehicle, { ratingAverage: rating._avg.rating, ratingCount: rating._count._all, soldCount });
  },

  /** «Avísame si vuelve»: ids de los autos en negociación que la persona está esperando. */
  async watching(userId: string) {
    const rows = await prisma.vehicleWatch.findMany({ where: { userId }, select: { vehicleId: true }, orderBy: { createdAt: 'desc' } });
    return rows.map(row => row.vehicleId);
  },

  async watch(vehicleId: string, userId: string) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null }, select: { status: true, sellerId: true } });
    if (!vehicle) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Vehículo no encontrado.');
    if (vehicle.sellerId === userId) throw AppError.badRequest('OWN_VEHICLE', 'Es tu propio anuncio.');
    if (vehicle.status !== 'RESERVED') throw AppError.conflict('NOT_IN_NEGOTIATION', 'Este auto no está en negociación: ya puedes verlo y reservarlo.');
    await prisma.vehicleWatch.upsert({ where: { userId_vehicleId: { userId, vehicleId } }, create: { userId, vehicleId }, update: {} });
  },

  async unwatch(vehicleId: string, userId: string) {
    await prisma.vehicleWatch.deleteMany({ where: { userId, vehicleId } });
  },

  async findForSimilar(slug: string) {
    const vehicle = await prisma.vehicle.findUnique({ where: { slug }, select: { id: true, make: true, category: true, price: true, country: true, city: true } });
    if (!vehicle) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Vehículo no encontrado.');
    return vehicle;
  },

  // ─────────────────────────────────────────────────────────── Mis anuncios ──

  async mine(userId: string) {
    const [vehicles, user] = await Promise.all([
      prisma.vehicle.findMany({
        where: { sellerId: userId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        select: {
          ...cardSelect,
          expiresAt: true,
          publishedAt: true,
          featuredUntil: true,
          _count: { select: { media: true } },
          sales: { where: { status: 'PENDING_PAYMENT' }, orderBy: { createdAt: 'desc' }, take: 1, select: { paymentId: true } },
        },
      }),
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    const plan = await getPlan(effectivePlan(user).code);
    const active = vehicles.filter(v => (ACTIVE_STATUSES as readonly string[]).includes(v.status)).length;
    const slotsUsed = vehicles.filter(v => (SLOT_STATUSES as readonly string[]).includes(v.status)).length;
    return {
      items: vehicles.map(v => ({
        ...toCardDTO(v),
        expiresAt: v.expiresAt?.toISOString() ?? null,
        publishedAt: v.publishedAt?.toISOString() ?? null,
        featuredUntil: v.featuredUntil?.toISOString() ?? null,
        mediaCount: v._count.media,
        pendingSalePaymentId: v.sales[0]?.paymentId ?? null,
      })),
      usage: { active, slotsUsed, max: plan.maxActiveListings, planCode: plan.code, commissionRate: plan.commissionRate.toNumber(), featuredSlots: plan.featuredSlots, monthlyFeaturedCredits: plan.monthlyFeaturedCredits, featureCreditMonth: user.featureCreditMonth },
    };
  },

  /** Datos completos para el asistente de edición (cualquier estado, solo el dueño). */
  async getForEdit(vehicleId: string, userId: string) {
    await ownVehicleOrThrow(vehicleId, userId);
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId }, include: detailInclude });
    return toDetailDTO(vehicle);
  },

  // ─────────────────────────────────────────────────────── Alta y edición ──

  /** Paso 1 del asistente: borrador con precio y ficha técnica que fija el vendedor. */
  async createDraft(userId: string, input: VehicleDraftInput) {
    input = { ...input, make: await catalogService.resolveMake(input.make) };
    await assertNoBlockedTerms(textFields(input));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const vehicle = await runInTransaction(async tx => {
          await lockUser(tx, userId);
          await assertSlotAvailable(tx, userId);
          return tx.vehicle.create({
            data: { ...input, sellerId: userId, slug: newSlug(input), status: 'DRAFT', version: input.version ?? null, description: input.description ?? null },
          });
        });
        return { id: vehicle.id, slug: vehicle.slug, status: vehicle.status };
      } catch (err) {
        if (!isUniqueViolation(err, 'slug')) throw err; // colisión de slug (improbable): reintenta
      }
    }
    throw new AppError(500, 'SLUG_GENERATION_FAILED', 'No se pudo crear el anuncio. Inténtalo de nuevo.');
  },

  async update(vehicleId: string, userId: string, input: VehicleUpdateInput) {
    const vehicle = await ownVehicleOrThrow(vehicleId, userId);
    if (vehicle.status === 'RESERVED' || vehicle.status === 'PENDING_SALE' || vehicle.status === 'SOLD' || vehicle.status === 'ARCHIVED') {
      throw AppError.conflict('VEHICLE_LOCKED', 'Un vehículo reservado, vendido o retirado no se puede editar.');
    }
    await assertNoOpenReservations(vehicleId);
    // Solo se valida contra el catálogo si cambia la marca: un anuncio antiguo se puede seguir editando.
    if (input.make !== undefined && input.make.trim().toLocaleLowerCase('es') !== vehicle.make.trim().toLocaleLowerCase('es')) {
      input = { ...input, make: await catalogService.resolveMake(input.make) };
    }

    // Coherencia NUEVO/USADO con los valores resultantes (parciales + actuales).
    const condition = input.condition ?? vehicle.condition;
    const owners = input.ownersCount ?? vehicle.ownersCount;
    if ((condition === 'NEW' && owners !== 0) || (condition === 'USED' && owners < 1)) {
      throw AppError.badRequest('INVALID_OWNERS', condition === 'NEW' ? 'Un vehículo nuevo no tiene dueños anteriores.' : 'Indica el número de dueños anteriores.');
    }
    const price = input.price ?? vehicle.price.toNumber();
    const reservationAmount = input.reservationAmount ?? vehicle.reservationAmount?.toNumber();
    if (reservationAmount !== undefined && reservationAmount > price) {
      throw AppError.badRequest('RESERVATION_AMOUNT_TOO_HIGH', 'El abono de reserva no puede superar el precio.');
    }
    await assertNoBlockedTerms(textFields(input));

    // Si baja el precio de un auto publicado, avisa a quienes lo guardaron (en la misma transacción).
    const before = vehicle.price.toNumber();
    const { updated, notices } = await runInTransaction(async tx => {
      const row = await tx.vehicle.update({ where: { id: vehicleId }, data: input });
      const drop = vehicle.status === 'PUBLISHED' && input.price !== undefined ? await notifyPriceDrop(tx, row, before, row.price.toNumber()) : [];
      return { updated: row, notices: drop };
    });
    deliver(notices);
    return { id: updated.id, slug: updated.slug, status: updated.status };
  },

  // ───────────────────────────────────────────── Galería (fotos y vídeos) ──

  /** URL prefirmada (PUT, 5 min): el archivo va directo del navegador a S3. */
  async presignMedia(vehicleId: string, userId: string, input: { mimeType: string; sizeBytes: number }) {
    await ownVehicleOrThrow(vehicleId, userId);
    const mimeType = baseMime(input.mimeType);
    const kind = MEDIA_KIND_OF(mimeType);
    if (!kind) throw AppError.badRequest('MEDIA_TYPE_NOT_ALLOWED', 'Formato no permitido. Usa JPG, PNG, WebP, MP4, WebM o MOV.');
    const maxBytes = kind === 'IMAGE' ? MAX_VEHICLE_IMAGE_BYTES : MAX_VEHICLE_VIDEO_BYTES;
    if (input.sizeBytes > maxBytes) throw AppError.badRequest('MEDIA_TOO_LARGE', `El archivo supera el máximo de ${maxBytes / 1024 / 1024} MB.`);
    if ((await prisma.vehicleMedia.count({ where: { vehicleId } })) >= MAX_VEHICLE_MEDIA) {
      throw AppError.conflict('MEDIA_LIMIT', `La galería admite como máximo ${MAX_VEHICLE_MEDIA} archivos.`);
    }

    const key = `${mediaPrefix(vehicleId)}${randomUUID()}.${extensionFor(mimeType)}`;
    const expiresIn = 300;
    const uploadUrl = await presignUpload({ bucket: env.S3_BUCKET_MEDIA, key, contentType: mimeType, contentLength: input.sizeBytes, expiresIn });
    return { key, uploadUrl, method: 'PUT' as const, headers: { 'Content-Type': mimeType }, expiresIn, kind };
  },

  /** Registra un archivo YA subido: se verifica en S3 (existe, tamaño y tipo reales). */
  async registerMedia(vehicleId: string, userId: string, input: { key: string; width?: number; height?: number; durationMs?: number }) {
    await ownVehicleOrThrow(vehicleId, userId);
    if (!input.key.startsWith(mediaPrefix(vehicleId)) || input.key.includes('..')) {
      throw AppError.forbidden('MEDIA_KEY_FORBIDDEN', 'El archivo no pertenece a este anuncio.');
    }
    const stored = await statObject(env.S3_BUCKET_MEDIA, input.key);
    if (!stored) throw AppError.badRequest('MEDIA_NOT_UPLOADED', 'El archivo aún no termina de subirse.');
    const mimeType = baseMime(stored.contentType);
    const kind = MEDIA_KIND_OF(mimeType);
    if (!kind) throw AppError.badRequest('MEDIA_TYPE_NOT_ALLOWED', 'Formato no permitido.');
    if (stored.sizeBytes > (kind === 'IMAGE' ? MAX_VEHICLE_IMAGE_BYTES : MAX_VEHICLE_VIDEO_BYTES)) {
      throw AppError.badRequest('MEDIA_TOO_LARGE', 'El archivo supera el tamaño permitido.');
    }
    // Foto real: la firma del archivo debe coincidir con el formato (no basta con la extensión).
    if (kind === 'IMAGE' && sniffImageType(await readObjectStart(env.S3_BUCKET_MEDIA, input.key)) !== mimeType) {
      await deleteObject(env.S3_BUCKET_MEDIA, input.key).catch(() => undefined);
      throw AppError.badRequest('MEDIA_NOT_A_PHOTO', 'El archivo no es una foto válida. Sube una imagen JPG, PNG o WebP.');
    }

    const media = await runInTransaction(async tx => {
      await lockVehicle(tx, vehicleId); // dos registros simultáneos no superan el máximo
      const existing = await tx.vehicleMedia.findMany({ where: { vehicleId }, select: { position: true, storageKey: true } });
      const duplicate = existing.find(item => item.storageKey === input.key);
      if (duplicate) throw AppError.conflict('MEDIA_ALREADY_REGISTERED', 'Ese archivo ya está en la galería.');
      if (existing.length >= MAX_VEHICLE_MEDIA) throw AppError.conflict('MEDIA_LIMIT', `La galería admite como máximo ${MAX_VEHICLE_MEDIA} archivos.`);
      return tx.vehicleMedia.create({
        data: {
          vehicleId,
          kind,
          storageKey: input.key,
          url: publicMediaUrl(input.key),
          mimeType,
          sizeBytes: stored.sizeBytes,
          width: input.width ?? null,
          height: input.height ?? null,
          durationMs: kind === 'VIDEO' ? (input.durationMs ?? null) : null,
          position: existing.reduce((max, item) => Math.max(max, item.position + 1), 0),
        },
      });
    });
    return toMediaDTO(media);
  },

  async removeMedia(vehicleId: string, userId: string, mediaId: string) {
    const vehicle = await ownVehicleOrThrow(vehicleId, userId);
    const media = await prisma.vehicleMedia.findFirst({ where: { id: mediaId, vehicleId } });
    if (!media) throw AppError.notFound('MEDIA_NOT_FOUND', 'Archivo no encontrado.');
    if (vehicle.status === 'PUBLISHED' || vehicle.status === 'RESERVED') {
      const images = await prisma.vehicleMedia.count({ where: { vehicleId, kind: 'IMAGE' } });
      if (media.kind === 'IMAGE' && images <= 1) throw AppError.conflict('COVER_REQUIRED', 'Un anuncio publicado necesita al menos una foto.');
    }
    await prisma.vehicleMedia.delete({ where: { id: media.id } });
    await deleteObject(env.S3_BUCKET_MEDIA, media.storageKey).catch(err => console.error('[media] no se pudo borrar de S3', media.storageKey, err));
  },

  /** Orden de la galería: la primera FOTO es la portada del catálogo. */
  async reorderMedia(vehicleId: string, userId: string, mediaIds: string[]) {
    await ownVehicleOrThrow(vehicleId, userId);
    const current = await prisma.vehicleMedia.findMany({ where: { vehicleId }, select: { id: true } });
    const sameSet = current.length === mediaIds.length && new Set(mediaIds).size === mediaIds.length && current.every(item => mediaIds.includes(item.id));
    if (!sameSet) throw AppError.badRequest('INVALID_ORDER', 'La lista debe contener exactamente los archivos de la galería.');
    await prisma.$transaction(mediaIds.map((id, position) => prisma.vehicleMedia.update({ where: { id }, data: { position } })));
  },

  // ─────────────────────────────────────────────────── Ciclo de vida ──

  /**
   * Publica un borrador, reanuda un pausado o renueva un vencido. Reglas: identidad verificada y
   * sin comisiones vencidas, ≥1 foto real, abono de reserva fijado, sin términos bloqueados y
   * dentro del límite de publicaciones activas del plan. La duración también la fija el plan
   * (Concesionario Pro: sin vencimiento).
   */
  async publish(vehicleId: string, userId: string) {
    const result = await runInTransaction(async tx => {
      await lockUser(tx, userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      await assertCanTransact(user, 'publish', tx);
      const vehicle = await ownVehicleOrThrow(vehicleId, userId, tx);
      if (!['DRAFT', 'PAUSED', 'EXPIRED'].includes(vehicle.status)) {
        throw AppError.conflict('INVALID_STATUS', 'Solo se pueden publicar borradores, anuncios en pausa o vencidos.');
      }
      if ((await tx.vehicleMedia.count({ where: { vehicleId, kind: 'IMAGE' } })) === 0) {
        throw AppError.badRequest('COVER_REQUIRED', 'Sube al menos una foto real del vehículo: será la portada del catálogo.');
      }
      if (!vehicle.reservationAmount) {
        throw AppError.badRequest('RESERVATION_AMOUNT_REQUIRED', 'Indica el abono de reserva (lo que te paga el comprador para reservarlo).');
      }
      await assertNoBlockedTerms(textFields(vehicle));

      const plan = await getPlan(effectivePlan(user).code, tx);
      if (plan.maxActiveListings !== null) {
        const active = await tx.vehicle.count({ where: { sellerId: userId, deletedAt: null, status: { in: [...PUBLISH_LIMIT_STATUSES] } } });
        if (active >= plan.maxActiveListings) {
          throw AppError.forbidden('PLAN_LIMIT_REACHED', `Tu plan ${plan.name} permite ${plan.maxActiveListings} ${plan.maxActiveListings === 1 ? 'publicación activa' : 'publicaciones activas'}. Mejora tu plan para publicar más.`, {
            planCode: plan.code,
            max: plan.maxActiveListings,
          });
        }
      }

      const now = new Date();
      // Reanudar un pausado conserva su vencimiento si sigue vigente.
      const keepExpiry = vehicle.status === 'PAUSED' && (vehicle.expiresAt === null ? plan.listingDurationDays === null : vehicle.expiresAt > now);
      const expiresAt = keepExpiry ? vehicle.expiresAt : plan.listingDurationDays === null ? null : addDays(now, plan.listingDurationDays);
      return tx.vehicle.update({
        where: { id: vehicleId },
        data: { status: 'PUBLISHED', publishedAt: now, expiresAt, searchBoost: plan.searchBoost },
      });
    });
    realtime.statsChanged();
    dealersService.notifyFollowers(result.id).catch(err => console.warn('[aliados] aviso a seguidores', result.id, err instanceof Error ? err.message : err));
    return { id: result.id, slug: result.slug, status: result.status, expiresAt: result.expiresAt?.toISOString() ?? null };
  },

  async pause(vehicleId: string, userId: string) {
    const vehicle = await ownVehicleOrThrow(vehicleId, userId);
    if (vehicle.status !== 'PUBLISHED') throw AppError.conflict('INVALID_STATUS', 'Solo se pueden pausar anuncios publicados.');
    await assertNoOpenReservations(vehicleId);
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { status: 'PAUSED', featuredUntil: null } });
    realtime.statsChanged();
  },

  /** Retira el anuncio (borrado lógico). No se permite con reservas en curso. */
  async archive(vehicleId: string, userId: string) {
    const vehicle = await ownVehicleOrThrow(vehicleId, userId);
    if (vehicle.status === 'RESERVED' || vehicle.status === 'PENDING_SALE') throw AppError.conflict('VEHICLE_LOCKED', 'El vehículo está reservado o espera aprobación del pago: resuelve el proceso primero.');
    await assertNoOpenReservations(vehicleId);
    await prisma.$transaction([
      prisma.vehicle.update({ where: { id: vehicleId }, data: { status: 'ARCHIVED', deletedAt: new Date(), featuredUntil: null } }),
      prisma.carouselItem.deleteMany({ where: { vehicleId } }),
    ]);
    realtime.statsChanged();
  },

  /**
   * Destacar (carrusel de la landing + prioridad en búsquedas):
   *   · Pro: hasta `featuredSlots` (3) a la vez, mientras dure la membresía.
   *   · Medio: 1 destacado por mes natural durante 30 días (si no lo elige, el job lo asigna).
   */
  async feature(vehicleId: string, userId: string) {
    await runInTransaction(async tx => {
      await lockUser(tx, userId);
      const vehicle = await ownVehicleOrThrow(vehicleId, userId, tx);
      if (vehicle.status !== 'PUBLISHED') throw AppError.conflict('INVALID_STATUS', 'Solo se pueden destacar anuncios publicados.');
      const now = new Date();
      if (vehicle.featuredUntil && vehicle.featuredUntil > now) throw AppError.conflict('ALREADY_FEATURED', 'Este anuncio ya está destacado.');

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const current = effectivePlan(user);
      const plan = await getPlan(current.code, tx);
      if (plan.featuredSlots === 0) throw AppError.forbidden('PLAN_REQUIRED', 'Los destacados están incluidos en los planes de concesionario.', { planCode: plan.code });

      const inUse = await tx.vehicle.count({ where: { sellerId: userId, deletedAt: null, featuredUntil: { gt: now } } });
      if (inUse >= plan.featuredSlots) throw AppError.conflict('FEATURE_SLOTS_FULL', `Tu plan permite ${plan.featuredSlots} ${plan.featuredSlots === 1 ? 'destacado' : 'destacados'} a la vez.`);

      const planEnd = current.expiresAt ? new Date(current.expiresAt) : null;
      let featuredUntil = planEnd ?? addDays(now, 30);
      if (plan.monthlyFeaturedCredits > 0) {
        const month = now.toISOString().slice(0, 7);
        if (user.featureCreditMonth === month) throw AppError.conflict('FEATURE_CREDIT_USED', 'Ya usaste el destacado de este mes. Se renueva el día 1.');
        await tx.user.update({ where: { id: userId }, data: { featureCreditMonth: month } });
        const thirtyDays = addDays(now, 30);
        featuredUntil = planEnd && planEnd < thirtyDays ? planEnd : thirtyDays;
      }
      await tx.vehicle.update({ where: { id: vehicleId }, data: { featuredAt: now, featuredUntil } });
    });
  },

  async unfeature(vehicleId: string, userId: string) {
    await ownVehicleOrThrow(vehicleId, userId);
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { featuredUntil: null } });
  },

  // ─────────────────────────────────────────────────────────── Denuncias ──

  async report(vehicleId: string, userId: string, input: { reason: ReportReason; details?: string }) {
    await assertNoBlockedTerms({ details: input.details });
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { sellerId: true, deletedAt: true } });
    if (!vehicle || vehicle.deletedAt) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Vehículo no encontrado.');
    if (vehicle.sellerId === userId) throw AppError.badRequest('OWN_VEHICLE', 'No puedes denunciar tu propio anuncio.');
    try {
      await prisma.report.create({ data: { kind: 'VEHICLE', vehicleId, reporterId: userId, dedupeKey: `V:${vehicleId}:${userId}`, reason: input.reason, details: input.details ?? null } });
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('ALREADY_REPORTED', 'Ya denunciaste este anuncio; el equipo lo está revisando.');
      throw err;
    }
  },
};
