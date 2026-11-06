import { env } from '../config/env.js';
import { runAlertJobs } from '../modules/alerts/alerts.jobs.js';
import { runBoostJobs } from '../modules/boosts/boosts.jobs.js';
import { runMembershipJobs } from '../modules/memberships/memberships.jobs.js';
import { runKycJobs } from '../modules/kyc/kyc.jobs.js';
import { runPaymentJobs } from '../modules/payments/payments.jobs.js';
import { runReservationJobs } from '../modules/reservations/reservations.jobs.js';
import { runListingJobs } from '../modules/vehicles/vehicles.jobs.js';
import { showcaseService } from '../modules/showcase/showcase.service.js';
import { withNamedLock } from '../shared/infra/prisma.js';
import { flushOutbox } from '../shared/mail/mailer.js';

const JOBS: Array<[string, (now: Date) => Promise<void>]> = [
  ['pagos', runPaymentJobs],
  ['reservas', runReservationJobs],
  ['anuncios', runListingJobs],
  ['membresías', runMembershipJobs],
  ['verificación de identidad', runKycJobs],
  ['alertas', runAlertJobs],
  ['destacados', runBoostJobs],
  ['influencia del mercado', runMarketInfluenceJob],
];

let lastInfluenceScanDay: string | null = null;
async function runMarketInfluenceJob(now: Date): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  if (lastInfluenceScanDay === day) return;
  await showcaseService.notifyMarketInfluence();
  lastInfluenceScanDay = day;
}

/** Ejecuta todas las tareas una vez. Con varias instancias, GET_LOCK garantiza una sola a la vez. */
export async function runJobsOnce(): Promise<void> {
  await withNamedLock('automarket:jobs', async () => {
    for (const [name, job] of JOBS) {
      try {
        await job(new Date());
      } catch (err) {
        console.error(`[jobs] ${name} falló:`, err);
      }
    }
  });
  await flushOutbox().catch(err => console.error('[jobs] correo:', err));
}

/** Planificador en proceso (cada JOBS_INTERVAL_MS). Devuelve la función para detenerlo. */
export function startScheduler(): () => void {
  if (!env.JOBS_ENABLED) return () => undefined;
  let running = false;
  const tick = async () => {
    if (running) return; // una ejecución lenta no se solapa con la siguiente
    running = true;
    try {
      await runJobsOnce();
    } catch (err) {
      console.error('[jobs]', err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), env.JOBS_INTERVAL_MS);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
