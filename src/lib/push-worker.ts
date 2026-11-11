import { randomUUID, createHash } from 'node:crypto';
import webPush from 'web-push';
import { db } from './db';
import { APP_ORGANIZATION_ID } from './config';
import { pushConfig, validPushEndpoint } from './push-config';
import { ticketNumber } from './labels';

export type PushSender = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  topic: string,
) => Promise<unknown>;
const send: PushSender = async (subscription, payload, topic) => {
  const config = pushConfig();
  if (!config) throw new Error('VAPID indisponível.');
  return webPush.sendNotification(subscription, payload, {
    vapidDetails: config,
    TTL: 3600,
    urgency: 'normal',
    topic,
    timeout: 10000,
  });
};
const titles: Record<string, string> = {
  CRIADO: 'Novo chamado',
  RESPONSAVEL_ALTERADO: 'Chamado transferido para você',
  APOIO_ADICIONADO: 'Você foi adicionado como apoio',
  EQUIPE_ALTERADA: 'Chamado recebido de outra equipe',
  COMENTARIO: 'Novo comentário',
  RESOLVIDO: 'Chamado resolvido',
};

export async function dispatchPushBatch(sender: PushSender = send) {
  const lease = randomUUID();
  const jobs = await db.$queryRaw<{ id: string }[]>`
    UPDATE "PushDelivery" d SET "leaseToken"=${lease}, attempts=attempts+1,
      "availableAt"=CURRENT_TIMESTAMP+INTERVAL '2 minutes'
    WHERE d.id IN (
      SELECT p.id FROM "PushDelivery" p JOIN "PushSubscription" s ON s.id=p."subscriptionId"
      WHERE p.status='PENDING' AND p."availableAt"<=CURRENT_TIMESTAMP AND s."organizationId"=${APP_ORGANIZATION_ID}
      ORDER BY p."availableAt",p.id FOR UPDATE OF p SKIP LOCKED LIMIT 20
    ) RETURNING d.id`;
  await Promise.all(
    jobs.map(async ({ id }) => {
      const job = await db.pushDelivery.findUnique({
        where: { id },
        include: {
          subscription: { include: { user: true, organization: true } },
          event: { include: { ticket: { include: { company: true, participants: true } } } },
        },
      });
      if (!job || job.leaseToken !== lease) return;
      const { subscription: sub, event } = job;
      const ticket = event.ticket;
      const user = sub.user;
      const canRead =
        user.role === 'ADMIN' ||
        (user.role === 'TI' &&
          (user.teamId === ticket.teamId ||
            ticket.participants.some((p) => p.userId === user.id))) ||
        (user.role === 'FUNCIONARIO' && ticket.requesterId === user.id);
      const stillRecipient =
        !['CRIADO', 'EQUIPE_ALTERADA'].includes(event.type) ||
        (user.role === 'TI' && user.teamId === ticket.teamId);
      const expired = job.createdAt.getTime() < Date.now() - 24 * 60 * 60 * 1000;
      const finish = (status: string, lastStatus?: number) =>
        db.pushDelivery.updateMany({
          where: { id, leaseToken: lease, status: 'PENDING' },
          data: { status, finishedAt: new Date(), leaseToken: null, lastStatus },
        });
      if (
        !sub.active ||
        !sub.organization.active ||
        !user.active ||
        user.mustChangePassword ||
        user.id === event.actorId ||
        user.organizationId !== ticket.organizationId ||
        sub.organizationId !== ticket.organizationId ||
        !canRead ||
        !stillRecipient ||
        expired ||
        !validPushEndpoint(sub.endpoint)
      ) {
        await finish('CANCELLED');
        return;
      }
      const payload = JSON.stringify({
        title: `${ticketNumber(ticket.number)} · ${titles[event.type] || 'Chamado atualizado'}`,
        body: ticket.company?.displayName || 'Central de Suporte',
        url: `/notificacoes/${ticket.id}`,
        tag: event.id,
      });
      try {
        await sender(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          createHash('sha256').update(event.id).digest('base64url').slice(0, 32),
        );
        await finish('SENT', 201);
      } catch (error) {
        const status = Number((error as { statusCode?: number }).statusCode) || 0;
        if (status === 404 || status === 410) {
          await db.pushSubscription.updateMany({ where: { id: sub.id }, data: { active: false } });
          await finish('CANCELLED', status);
        } else if (job.attempts >= 5 || (status >= 400 && status < 500 && status !== 429)) {
          await finish('FAILED', status);
          console.error('push_delivery_failed', { deliveryId: id, status });
        } else {
          const delay = Math.min(3600, 15 * 2 ** job.attempts) + Math.floor(Math.random() * 10);
          await db.pushDelivery.updateMany({
            where: { id, leaseToken: lease, status: 'PENDING' },
            data: {
              availableAt: new Date(Date.now() + delay * 1000),
              leaseToken: null,
              lastStatus: status,
            },
          });
        }
      }
    }),
  );
  return jobs.length;
}

export function startPushWorker() {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (!pushConfig() || process.env.PUSH_WORKER_ENABLED === 'false') return;
  const state = globalThis as unknown as { pushWorker?: ReturnType<typeof setInterval> };
  if (state.pushWorker) return;
  let running = false,
    lastCleanup = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await dispatchPushBatch();
      if (Date.now() - lastCleanup > 3600000) {
        // Delivery bookkeeping is short lived; ticket audit remains untouched.
        await db.$executeRaw`DELETE FROM "PushDelivery" WHERE id IN (
          SELECT d.id FROM "PushDelivery" d JOIN "PushSubscription" s ON s.id=d."subscriptionId"
          WHERE s."organizationId"=${APP_ORGANIZATION_ID} AND d."createdAt"<CURRENT_TIMESTAMP-INTERVAL '7 days' LIMIT 1000)`;
        await db.$executeRaw`DELETE FROM "PushSubscription" WHERE id IN (
          SELECT id FROM "PushSubscription" WHERE "organizationId"=${APP_ORGANIZATION_ID}
          AND NOT active AND "updatedAt"<CURRENT_TIMESTAMP-INTERVAL '7 days' LIMIT 1000)`;
        lastCleanup = Date.now();
      }
    } catch {
      console.error('push_worker_failed');
    } finally {
      running = false;
    }
  };
  state.pushWorker = setInterval(() => {
    void tick();
  }, 5000);
  state.pushWorker.unref();
  console.info('push_worker_started');
}
