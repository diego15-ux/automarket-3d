import { Router } from 'express';
import { authenticate, currentUser, requireCompliance } from '../../shared/http/middlewares/auth.middleware.js';
import { validateBody } from '../../shared/http/middlewares/validate.js';
import {
  DocumentIdParamsSchema,
  KycQueueQuerySchema,
  KycReviewSchema,
  KycSubmitSchema,
  KycUploadSchema,
  type KycReviewInput,
  type KycSubmitInput,
  type KycUploadInput,
} from './kyc.schemas.js';
import { kycService } from './kyc.service.js';

/** /api/kyc — el propio usuario gestiona su verificación. */
export const kycRouter = Router();
kycRouter.use(authenticate);

kycRouter.get('/status', async (req, res) => {
  res.json({ data: await kycService.getStatus(currentUser(req).id) });
});

kycRouter.post('/uploads', validateBody(KycUploadSchema), async (req, res) => {
  res.status(201).json({ data: await kycService.requestUpload(currentUser(req).id, req.body as KycUploadInput) });
});

kycRouter.post('/documents', validateBody(KycSubmitSchema), async (req, res) => {
  res.status(201).json({ data: await kycService.submitDocument(currentUser(req).id, req.body as KycSubmitInput, req.ip ?? null) });
});

/** /api/admin/kyc — cola de revisión para administradores y supervisores. */
export const adminKycRouter = Router();
adminKycRouter.use(authenticate, requireCompliance);

adminKycRouter.get('/', async (req, res) => {
  const query = KycQueueQuerySchema.parse(req.query);
  const actor = currentUser(req);
  res.json(await kycService.listQueue(query, { actorId: actor.id, role: actor.role, ip: req.ip ?? null }));
});

adminKycRouter.get('/counts', async (_req, res) => {
  res.json({ data: await kycService.counts() });
});

adminKycRouter.patch('/:id', validateBody(KycReviewSchema), async (req, res) => {
  const { id } = DocumentIdParamsSchema.parse(req.params);
  const actor = currentUser(req);
  res.json({ data: await kycService.review(id, req.body as KycReviewInput, { actorId: actor.id, role: actor.role, ip: req.ip ?? null }) });
});
