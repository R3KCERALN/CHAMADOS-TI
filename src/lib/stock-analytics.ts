import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { db } from './db';
import { stockActor } from './stock-access';
import { resolvePeriod, type SearchParams } from './period';
import type { ReviewState } from './stock-review';
export function stockFilters(input: SearchParams, now = new Date()) {
  const filters = z.object({ team: z.string().max(100).optional(), actorTeam: z.string().max(100).optional(), item: z.string().max(100).optional() }).parse(input);
  return { ...resolvePeriod(input, now), ...filters };
}
function movementWhere(organizationId: string, f: ReturnType<typeof stockFilters>) {
  return Prisma.sql`m."organizationId"=${organizationId} AND m."createdAt">=${f.start} AND m."createdAt"<${f.end}
    ${f.team ? Prisma.sql`AND m."itemTeamId"=${f.team}` : Prisma.empty}
    ${f.actorTeam ? Prisma.sql`AND m."actorTeamId"=${f.actorTeam}` : Prisma.empty}
    ${f.item ? Prisma.sql`AND m."itemId"=${f.item}` : Prisma.empty}`;
}
export type StockExportRow = { sequence: number; createdAt: Date; type: string; name: string; teamName: string;
  unit: string | null; quantity: string | null; balanceAfter: string | null; actorName: string; actorTeamName: string | null;
  ticketNumber: number | null; ticketTeamName: string | null; reversed: boolean; state: ReviewState | null };
export async function stockExportRows(actorId: string, input: SearchParams, now: Date, after: number, limit: number, tx: Prisma.TransactionClient): Promise<StockExportRow[]> {
  const user = await stockActor(tx, actorId, 'review'); const filters = stockFilters(input, now);
  return tx.$queryRaw<StockExportRow[]>(Prisma.sql`SELECT m.sequence, m."createdAt", m.type, i.name, it.name AS "teamName", i.unit,
    m.quantity::text, m."balanceAfter"::text, a.name AS "actorName", at.name AS "actorTeamName", t.number AS "ticketNumber", tt.name AS "ticketTeamName",
    EXISTS(SELECT 1 FROM "StockMovement" r WHERE r."reversesId"=m.id) AS reversed,
    CASE WHEN m.type='USO_AVULSO' THEN COALESCE(review.outcome::text, 'PENDENTE') ELSE NULL END AS state
    FROM "StockMovement" m JOIN "StockItem" i ON i.id=m."itemId" JOIN "User" a ON a.id=m."actorId"
    JOIN "Team" it ON it.id=m."itemTeamId" LEFT JOIN "Team" at ON at.id=m."actorTeamId"
    LEFT JOIN "Ticket" t ON t.id=m."ticketId" LEFT JOIN "Team" tt ON tt.id=m."ticketTeamId"
    LEFT JOIN LATERAL (SELECT outcome FROM "StockReview" WHERE "movementId"=m.id ORDER BY sequence DESC LIMIT 1) review ON true
    WHERE ${movementWhere(user.organizationId, filters)} AND m.sequence>${after} ORDER BY m.sequence LIMIT ${limit}`);
}
export async function stockReport(actorId: string, input: SearchParams, now = new Date(), options: { rowLimit?: number } = {}) {
  const user = await stockActor(db, actorId, 'review'); const filters = stockFilters(input, now);
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(input.pagina)) || 1));
  const rowLimit = options.rowLimit ?? 20;
  const where = movementWhere(user.organizationId, filters);
  const offCte = Prisma.sql`WITH off AS (SELECT m.id, m.sequence, m."createdAt", m.note, m.quantity::text, i.name,
    a.name AS "actorName", COALESCE(r.outcome::text, 'PENDENTE') AS state,
    EXISTS(SELECT 1 FROM "StockMovement" rev WHERE rev."reversesId"=m.id) AS reversed
    FROM "StockMovement" m JOIN "StockItem" i ON i.id=m."itemId" JOIN "User" a ON a.id=m."actorId"
    LEFT JOIN LATERAL (SELECT outcome FROM "StockReview" WHERE "movementId"=m.id ORDER BY sequence DESC LIMIT 1) r ON true
    WHERE ${where} AND m.type='USO_AVULSO')`;
  const [consumption, counts, rows, toolsOut] = await Promise.all([
    db.$queryRaw<{ itemId: string; name: string; teamName: string; unit: string; quantity: string }[]>(Prisma.sql`
      SELECT m."itemId", i.name, team.name AS "teamName", i.unit, SUM(m.quantity)::text AS quantity
      FROM "StockMovement" m JOIN "StockItem" i ON i.id=m."itemId" JOIN "Team" team ON team.id=m."itemTeamId"
      WHERE ${where} AND m.type IN ('USO_CHAMADO','USO_AVULSO') AND NOT EXISTS(SELECT 1 FROM "StockMovement" rev WHERE rev."reversesId"=m.id)
      GROUP BY m."itemId", i.name, team.id, team.name, i.unit ORDER BY SUM(m.quantity) DESC, i.name, team.name`),
    db.$queryRaw<{ state: ReviewState; count: number }[]>(Prisma.sql`${offCte} SELECT state, COUNT(*)::int AS count FROM off GROUP BY state`),
    db.$queryRaw<{ id: string; sequence: number; createdAt: Date; name: string; actorName: string; quantity: string; note: string | null; state: ReviewState; reversed: boolean }[]>(Prisma.sql`${offCte} SELECT * FROM off ORDER BY "createdAt", sequence OFFSET ${(page-1)*20} LIMIT ${rowLimit}`),
    db.$queryRaw<{ name: string; holderName: string; since: Date; seconds: number }[]>(Prisma.sql`
      SELECT i.name, h.name AS "holderName", i."heldSince" AS since, GREATEST(0, EXTRACT(EPOCH FROM (${now}::timestamptz-i."heldSince")))::float8 AS seconds
      FROM "StockItem" i JOIN "User" h ON h.id=i."holderId" WHERE i."organizationId"=${user.organizationId} AND i.kind='FERRAMENTA' AND i.active
      ${filters.team ? Prisma.sql`AND i."teamId"=${filters.team}` : Prisma.empty} ${filters.item ? Prisma.sql`AND i.id=${filters.item}` : Prisma.empty}
      ORDER BY i."heldSince", i.id`),
  ]);
  const stateCounts: Record<ReviewState, number> = { PENDENTE: 0, CONFERIDA: 0, QUESTIONADA: 0, ENCERRADA: 0 };
  for (const row of counts) stateCounts[row.state] = row.count;
  return { filters, consumption: consumption.map((r) => ({ ...r, quantity: new Prisma.Decimal(r.quantity).toString() })),
    offTicket: { counts: stateCounts, rows, total: counts.reduce((sum,r) => sum + r.count,0), page }, toolsOut };
}
