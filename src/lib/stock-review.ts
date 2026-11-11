import { z } from 'zod';
import { StockReviewOutcome } from '@/generated/prisma/client';
import { db } from './db';
import { stockActor } from './stock-access';
import { lockItem } from './stock-service';
import { AppError } from './errors';
import { APP_ORGANIZATION_ID } from './config';
export type ReviewState = 'PENDENTE' | StockReviewOutcome;
export async function reviewAuthorization(
  actorId: string,
  movementId: string,
  input: { outcome: StockReviewOutcome; note?: string },
) {
  return db.$transaction(async (tx) => {
    const user = await stockActor(tx, actorId, 'review');
    const outcome = z.enum(StockReviewOutcome).parse(input.outcome);
    const note = String(input.note ?? '').trim();
    if (note.length > 1000) throw new AppError('A observação pode ter até 1000 caracteres.');
    if (outcome !== 'CONFERIDA' && !note) throw new AppError('Escreva uma observação.');
    const movement = await tx.stockMovement.findFirst({
      where: { id: movementId, organizationId: user.organizationId, type: 'USO_AVULSO' },
    });
    if (!movement) throw new AppError('Autorização não encontrada.', 404);
    await lockItem(tx, movement.itemId, user.organizationId);
    const last = await tx.stockReview.findFirst({
      where: { movementId },
      orderBy: { sequence: 'desc' },
    });
    if (
      (!last && outcome === 'ENCERRADA') ||
      (last && !(last.outcome === 'QUESTIONADA' && outcome === 'ENCERRADA'))
    )
      throw new AppError('Esta autorização já foi conferida. Atualize a página.', 409);
    return tx.stockReview.create({
      data: {
        organizationId: user.organizationId,
        movementId,
        actorId,
        outcome,
        note: note || null,
      },
    });
  });
}
export async function authorizationList(
  actorId: string,
  input: { state?: ReviewState; page?: number },
) {
  const user = await stockActor(db, actorId, 'review');
  const state = z
    .enum(['PENDENTE', 'CONFERIDA', 'QUESTIONADA', 'ENCERRADA'])
    .optional()
    .parse(input.state);
  const page = Math.max(1, Math.min(100000, Math.trunc(input.page || 1)));
  // Latest state is selected by sequence, never by the mutable display timestamp.
  // Filter latest review with a scoped SQL subquery; older QUESTIONADA rows cannot match ENCERRADA.
  const ids = await db.$queryRaw<{ id: string; state: ReviewState }[]>`
    SELECT m.id, COALESCE(r.outcome::text, 'PENDENTE') AS state FROM "StockMovement" m
    LEFT JOIN LATERAL (SELECT outcome FROM "StockReview" WHERE "movementId"=m.id ORDER BY sequence DESC LIMIT 1) r ON true
    WHERE m."organizationId"=${user.organizationId} AND m.type='USO_AVULSO'
      AND (${state ?? null}::text IS NULL OR COALESCE(r.outcome::text, 'PENDENTE')=${state ?? null})
    ORDER BY (r.outcome IS NULL) DESC, m."createdAt", m.sequence
    OFFSET ${(page - 1) * 20} LIMIT 21`;
  const hasNext = ids.length > 20;
  const selected = ids.slice(0, 20);
  const rows = await db.stockMovement.findMany({
    where: { id: { in: selected.map((r) => r.id) }, organizationId: user.organizationId },
    include: {
      item: true,
      actor: { select: { name: true } },
      photo: { select: { movementId: true } },
      reviews: { include: { actor: { select: { name: true } } }, orderBy: { sequence: 'asc' } },
    },
  });
  return {
    rows: selected.map(({ id, state }) => {
      const row = rows.find((r) => r.id === id)!;
      return { ...row, state, hasPhoto: !!row.photo };
    }),
    page,
    hasNext,
  };
}
export async function purgeExpiredPhotos(now = new Date(), limit = 200): Promise<number> {
  return db.$executeRaw`DELETE FROM "StockPhoto" WHERE "movementId" IN (
    SELECT p."movementId" FROM "StockPhoto" p
    JOIN LATERAL (SELECT outcome, "createdAt" FROM "StockReview" r WHERE r."movementId"=p."movementId" ORDER BY sequence DESC LIMIT 1) r ON true
    WHERE p."organizationId"=${APP_ORGANIZATION_ID} AND r.outcome IN ('CONFERIDA', 'ENCERRADA')
      AND r."createdAt" <= ${now}::timestamptz - INTERVAL '1 year'
    ORDER BY r."createdAt", p."movementId" LIMIT ${Math.max(1, Math.min(2000, Math.trunc(limit) || 200))})`;
}
export function startStockMaintenance() {
  if (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.STOCK_MAINTENANCE_ENABLED === 'false'
  )
    return;
  const state = globalThis as unknown as { stockMaintenance?: ReturnType<typeof setInterval> };
  if (state.stockMaintenance) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await purgeExpiredPhotos();
    } catch {
      console.error('stock_photo_purge_failed');
    } finally {
      running = false;
    }
  };
  state.stockMaintenance = setInterval(() => {
    void tick();
  }, 3600000);
  state.stockMaintenance.unref();
  console.info('stock_maintenance_started');
}
