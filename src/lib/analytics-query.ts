import { Prisma } from '@/generated/prisma/client';
import { z } from 'zod';
import { resolvePeriod, type SearchParams, param } from './period';
export function analyticsFilters(input: SearchParams, now = new Date()) {
  const period = resolvePeriod(input, now);
  const dimensions = z
    .object({
      department: z.string().max(100).optional(),
      technician: z.string().max(100).optional(),
      category: z.string().max(100).optional(),
      complexity: z.enum(['BAIXA', 'MEDIA', 'ALTA', 'CRITICA', 'none']).optional(),
      status: z.enum(['NOVO', 'EM_ATENDIMENTO', 'AGUARDANDO', 'RESOLVIDO']).optional(),
    })
    .parse(
      Object.fromEntries(
        ['department', 'technician', 'category', 'complexity', 'status'].map((key) => [
          key,
          param(input, key) || undefined,
        ]),
      ),
    );
  return { ...period, ...dimensions };
}
export type AnalyticsFilters = ReturnType<typeof analyticsFilters>;
export function metricsCTE(
  f: AnalyticsFilters,
  team = false,
  exportPage?: { after: number; limit: number },
) {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.department) conditions.push(Prisma.sql`t."departmentId" = ${f.department}`);
  if (f.technician && !team) conditions.push(Prisma.sql`t."assigneeId" = ${f.technician}`);
  if (f.category)
    conditions.push(
      f.category === 'none'
        ? Prisma.sql`t."categoryId" IS NULL`
        : Prisma.sql`t."categoryId" = ${f.category}`,
    );
  if (f.complexity)
    conditions.push(
      f.complexity === 'none'
        ? Prisma.sql`t.complexity IS NULL`
        : Prisma.sql`t.complexity::text = ${f.complexity}`,
    );
  if (f.status) conditions.push(Prisma.sql`t.status::text = ${f.status}`);
  return Prisma.sql`WITH p AS (
    SELECT ${f.start.toISOString()}::timestamptz AT TIME ZONE 'UTC' AS start_at,
      ${f.end.toISOString()}::timestamptz AT TIME ZONE 'UTC' AS end_at,
      ${f.now.toISOString()}::timestamptz AT TIME ZONE 'UTC' AS now_at
  ), base AS MATERIALIZED (
    SELECT t.*, u.name AS requester, d.name AS department, a.name AS assignee, c.name AS category
    FROM "Ticket" t JOIN "User" u ON u.id=t."requesterId" JOIN "Department" d ON d.id=t."departmentId"
    LEFT JOIN "User" a ON a.id=t."assigneeId" LEFT JOIN "Category" c ON c.id=t."categoryId", p
    WHERE ${Prisma.join(conditions, ' AND ')} AND t."createdAt" <= p.now_at
      AND (t.status<>'RESOLVIDO' OR (t."createdAt"<p.end_at AND t."resolvedAt">=p.start_at))
      ${exportPage ? Prisma.sql`AND t.number>${exportPage.after} AND ((t."createdAt">=p.start_at AND t."createdAt"<p.end_at) OR (t."resolvedAt">=p.start_at AND t."resolvedAt"<p.end_at)) ORDER BY t.number LIMIT ${exportPage.limit}` : Prisma.empty}
  ), transitions AS (
    SELECT e.*, lead(e."createdAt") OVER (PARTITION BY e."ticketId" ORDER BY e.sequence) AS next_at,
      lead(e."fromStatus") OVER (PARTITION BY e."ticketId" ORDER BY e.sequence) AS next_from,
      row_number() OVER (PARTITION BY e."ticketId" ORDER BY e.sequence DESC) AS last_row
    FROM "TicketEvent" e JOIN base b ON b.id=e."ticketId"
    WHERE e."toStatus" IS NOT NULL AND e.type IN ('CRIADO','ASSUMIDO','AGUARDANDO','RETOMADO','RESOLVIDO','STATUS_ALTERADO')
  ), intervals AS (
    SELECT e.*, CASE WHEN e."toStatus"='RESOLVIDO' THEN e."createdAt"
      ELSE LEAST(COALESCE(e.next_at,b."resolvedAt",p.now_at),COALESCE(b."resolvedAt",p.now_at)) END AS until_at
    FROM transitions e JOIN base b ON b.id=e."ticketId", p
  ), durations AS (
    SELECT i."ticketId",
      min(i."createdAt") FILTER (WHERE i.type='ASSUMIDO') AS first_response,
      bool_or(i.type='CRIADO') AND bool_or(i.last_row=1 AND i."toStatus"=b.status)
        AND bool_and(i."createdAt">=b."createdAt" AND i.until_at>=i."createdAt" AND (i."toStatus"<>'AGUARDANDO' OR i."waitingReason" IS NOT NULL)
          AND (i.next_from IS NULL OR i.next_from=i."toStatus"))
        AND (b.status='NOVO' OR bool_or(i.type='ASSUMIDO')) AS reliable,
      coalesce(sum(extract(epoch FROM (i.until_at-i."createdAt"))) FILTER (WHERE i."toStatus"='AGUARDANDO'),0)::float8 AS waiting_seconds,
      coalesce(sum(extract(epoch FROM (i.until_at-i."createdAt"))) FILTER (WHERE i."toStatus"='EM_ATENDIMENTO'),0)::float8 AS active_seconds
    FROM intervals i JOIN base b ON b.id=i."ticketId" GROUP BY i."ticketId",b.status
  ), m AS MATERIALIZED (
    SELECT b.*, d.first_response,
      CASE WHEN d.first_response>=b."createdAt" THEN extract(epoch FROM (d.first_response-b."createdAt"))::float8 END AS response_seconds,
      CASE WHEN b."resolvedAt">=b."createdAt" THEN extract(epoch FROM (b."resolvedAt"-b."createdAt"))::float8 END AS total_seconds,
      CASE WHEN d.reliable THEN d.waiting_seconds END AS waiting_seconds,
      CASE WHEN d.reliable AND d.first_response IS NOT NULL THEN d.active_seconds END AS active_seconds,
      COALESCE(d.reliable,false) AS reliable,
      b."createdAt">=p.start_at AND b."createdAt"<p.end_at AS opened_period,
      b."resolvedAt">=p.start_at AND b."resolvedAt"<p.end_at AS resolved_period
    FROM base b LEFT JOIN durations d ON b.id=d."ticketId",p
  ), assignment_intervals AS (
    SELECT e."ticketId",e."targetUserId" AS user_id,e."createdAt" AS since_at,
      lead(e."createdAt") OVER (PARTITION BY e."ticketId" ORDER BY e.sequence) AS until_at
    FROM "TicketEvent" e JOIN base b ON b.id=e."ticketId"
    WHERE e.type IN ('ASSUMIDO','RESPONSAVEL_ALTERADO') AND e."targetUserId" IS NOT NULL
  ), principal_period AS (
    SELECT DISTINCT a."ticketId",a.user_id FROM assignment_intervals a JOIN base b ON b.id=a."ticketId",p
    WHERE a.since_at<p.end_at AND (COALESCE(a.until_at,b."resolvedAt",p.now_at)>p.start_at OR a.since_at>=p.start_at)
  ), support_intervals AS (
    SELECT e."ticketId",e."targetUserId" AS user_id,e.type,e."createdAt" AS since_at,
      lead(e."createdAt") OVER (PARTITION BY e."ticketId",e."targetUserId" ORDER BY e.sequence) AS until_at
    FROM "TicketEvent" e JOIN base b ON b.id=e."ticketId" WHERE e.type IN ('APOIO_ADICIONADO','APOIO_REMOVIDO')
  ), support_period AS (
    SELECT DISTINCT a."ticketId",a.user_id FROM support_intervals a JOIN base b ON b.id=a."ticketId",p
    WHERE a.type='APOIO_ADICIONADO' AND a.since_at<p.end_at
      AND (LEAST(COALESCE(a.until_at,b."resolvedAt",p.now_at),COALESCE(b."resolvedAt",p.now_at))>p.start_at OR a.since_at>=p.start_at)
  )`;
}
