import { Prisma } from '@/generated/prisma/client';
import { db } from './db';
import { actor } from './services';
import { analyticsFilters, metricsCTE, type AnalyticsFilters } from './analytics-query';
import type { SearchParams } from './period';
import { AppError } from './errors';
export type TimeStats = { mean: number | null; median: number | null; count: number };
export type Distribution = {
  id?: string;
  name: string;
  count: number;
  seconds?: number | null;
  median?: number | null;
};
export type MetricTicket = {
  id: string;
  number: number;
  company: string | null;
  unit: string | null;
  requester: string;
  department: string;
  category: string | null;
  complexity: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  assignee: string | null;
  principal?: boolean;
  support?: boolean;
  age?: number;
};
export type Overview = {
  summary: {
    opened: number;
    resolved: number;
    pending: number;
    new: number;
    attending: number;
    waiting: number;
    incomplete: number;
    response: TimeStats;
    total: TimeStats;
    active: TimeStats;
  };
  series: { bucket: string; opened: number; resolved: number }[];
  companies: Distribution[];
  units: Distribution[];
  departments: Distribution[];
  categories: Distribution[];
  complexities: Distribution[];
  waits: Distribution[];
  backlog: Distribution[];
  oldest: MetricTicket[];
};
const stats = (column: Prisma.Sql, condition: Prisma.Sql) =>
  Prisma.sql`jsonb_build_object('mean',avg(${column}) FILTER (WHERE ${condition}), 'median',percentile_cont(0.5) WITHIN GROUP (ORDER BY ${column}) FILTER (WHERE ${condition}), 'count',count(${column}) FILTER (WHERE ${condition}))`;
export async function managementAccess(actorId: string) {
  return actor(db, actorId, ['ADMIN', 'GESTOR']);
}
export async function analyticsOptions(actorId: string) {
  const viewer = await managementAccess(actorId);
  const [departments, categories, technicians, companies] = await Promise.all([
    db.department.findMany({
      where: { organizationId: viewer.organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    db.category.findMany({
      where: { organizationId: viewer.organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, active: true },
    }),
    db.user.findMany({
      where: {
        organizationId: viewer.organizationId,
        OR: [
          { role: 'TI' },
          { assignments: { some: {} } },
          {
            targetedEvents: {
              some: { type: { in: ['ASSUMIDO', 'RESPONSAVEL_ALTERADO', 'APOIO_ADICIONADO'] } },
            },
          },
        ],
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, active: true },
    }),
    db.company.findMany({
      where: { organizationId: viewer.organizationId },
      orderBy: { displayName: 'asc' },
      select: {
        id: true,
        displayName: true,
        active: true,
        units: { orderBy: { name: 'asc' }, select: { id: true, name: true, active: true } },
      },
    }),
  ]);
  return { departments, categories, technicians, companies };
}
export async function overview(actorId: string, input: SearchParams, now = new Date()) {
  const viewer = await managementAccess(actorId);
  const filters = analyticsFilters(input, now);
  const f = filters;
  const result = await db.$queryRaw<
    { data: Overview }[]
  >(Prisma.sql`${metricsCTE(f, viewer.organizationId)},
    opened AS (SELECT * FROM m WHERE opened_period),
    volumes AS (
      SELECT date_trunc(${f.grouping}, "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${f.zone}) AS bucket,1 AS opened,0 AS resolved FROM m WHERE opened_period
      UNION ALL SELECT date_trunc(${f.grouping}, "resolvedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${f.zone}),0,1 FROM m WHERE resolved_period
    ), buckets AS (
      SELECT generate_series(date_trunc(${f.grouping},p.start_at AT TIME ZONE 'UTC' AT TIME ZONE ${f.zone}),
        date_trunc(${f.grouping},(LEAST(p.end_at,p.now_at)-interval '1 millisecond') AT TIME ZONE 'UTC' AT TIME ZONE ${f.zone}),
        ('1 ' || ${f.grouping})::interval) AS bucket FROM p
    ), aged AS (
      SELECT *, extract(epoch FROM (p.now_at-m."createdAt"))::float8 AS age,
        CASE WHEN p.now_at-m."createdAt"<interval '1 day' THEN 0 WHEN p.now_at-m."createdAt"<interval '4 days' THEN 1
          WHEN p.now_at-m."createdAt"<interval '8 days' THEN 2 WHEN p.now_at-m."createdAt"<interval '16 days' THEN 3 ELSE 4 END AS age_band
      FROM m,p WHERE status<>'RESOLVIDO'
    )
    SELECT jsonb_build_object(
      'summary',(SELECT jsonb_build_object('opened',count(*) FILTER(WHERE opened_period),'resolved',count(*) FILTER(WHERE resolved_period),
        'pending',count(*) FILTER(WHERE status<>'RESOLVIDO'),'new',count(*) FILTER(WHERE status='NOVO'),
        'attending',count(*) FILTER(WHERE status='EM_ATENDIMENTO'),'waiting',count(*) FILTER(WHERE status='AGUARDANDO'),
        'incomplete',count(*) FILTER(WHERE NOT reliable AND (opened_period OR resolved_period)),
        'response',${stats(Prisma.sql`response_seconds`, Prisma.sql`opened_period`)},
        'total',${stats(Prisma.sql`total_seconds`, Prisma.sql`resolved_period`)},
        'active',${stats(Prisma.sql`active_seconds`, Prisma.sql`resolved_period`)} ) FROM m),
      'series',coalesce((SELECT jsonb_agg(x ORDER BY x.bucket) FROM (SELECT to_char(b.bucket,'YYYY-MM-DD HH24:MI') AS bucket,coalesce(sum(v.opened),0) AS opened,coalesce(sum(v.resolved),0) AS resolved FROM buckets b LEFT JOIN volumes v ON v.bucket=b.bucket GROUP BY b.bucket) x),'[]'::jsonb),
      'companies',coalesce((SELECT jsonb_agg(x ORDER BY x.count DESC,x.name) FROM (SELECT coalesce("companyId",'none') AS id,coalesce(company,'Sem filial') AS name,count(*) AS count FROM opened GROUP BY "companyId",company) x),'[]'::jsonb),
      'units',coalesce((SELECT jsonb_agg(x ORDER BY x.count DESC,x.name) FROM (SELECT coalesce("unitId",'none') AS id,CASE WHEN unit IS NULL THEN 'Sem unidade' ELSE unit || ' — ' || company END AS name,count(*) AS count FROM opened GROUP BY "unitId",CASE WHEN unit IS NULL THEN 'Sem unidade' ELSE unit || ' — ' || company END) x),'[]'::jsonb),
      'departments',coalesce((SELECT jsonb_agg(x ORDER BY x.count DESC,x.name) FROM (SELECT department AS name,count(*) AS count FROM opened GROUP BY department) x),'[]'::jsonb),
      'categories',coalesce((SELECT jsonb_agg(x ORDER BY x.count DESC,x.name) FROM (SELECT coalesce("categoryId",'none') AS id,coalesce(category,'Sem categoria') AS name,count(*) AS count,sum(active_seconds) FILTER(WHERE status='RESOLVIDO') AS seconds,percentile_cont(0.5) WITHIN GROUP(ORDER BY active_seconds) FILTER(WHERE status='RESOLVIDO') AS median FROM opened GROUP BY "categoryId",category) x),'[]'::jsonb),
      'complexities',coalesce((SELECT jsonb_agg(x ORDER BY x.name) FROM (SELECT coalesce(complexity::text,'Não classificada') AS name,count(*) AS count FROM opened GROUP BY complexity) x),'[]'::jsonb),
      'waits',coalesce((SELECT jsonb_agg(x ORDER BY x.name) FROM (
        SELECT i."waitingReason"::text AS name,count(DISTINCT i."ticketId") AS count,
          sum(extract(epoch FROM (LEAST(i.until_at,p.end_at,p.now_at)-GREATEST(i."createdAt",p.start_at))))::float8 AS seconds
        FROM intervals i JOIN m ON m.id=i."ticketId",p WHERE i."toStatus"='AGUARDANDO' AND m.reliable
          AND i.until_at>p.start_at AND i."createdAt"<LEAST(p.end_at,p.now_at) GROUP BY i."waitingReason"
      ) x),'[]'::jsonb),
      'backlog',coalesce((SELECT jsonb_agg(x ORDER BY x.band) FROM (SELECT age_band AS band,
        (ARRAY['Menos de 1 dia','1–3 dias','4–7 dias','8–15 dias','Mais de 15 dias'])[age_band+1] AS name,count(*) AS count FROM aged GROUP BY age_band) x),'[]'::jsonb),
      'oldest',coalesce((SELECT jsonb_agg(x ORDER BY x."createdAt") FROM (SELECT id,number,requester,company,unit,department,category,complexity,status,to_char("createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",to_char("resolvedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "resolvedAt",assignee,age FROM aged ORDER BY "createdAt",id LIMIT 10) x),'[]'::jsonb)
    ) AS data`);
  return { ...result[0].data, filters };
}
export type Technician = {
  id: string;
  name: string;
  active: boolean;
  role: string;
  principal: number;
  support: number;
  resolved: number;
  pending: number;
  attending: number;
  waiting: number;
  response: TimeStats;
  total: TimeStats;
  cycle: TimeStats;
  complexities: Record<string, number>;
};
export async function teamReport(actorId: string, input: SearchParams, now = new Date()) {
  const viewer = await managementAccess(actorId);
  const filters = analyticsFilters(input, now);
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(input.pagina)) || 1));
  const rows = await db.$queryRaw<
    { data: { total: number; rows: Technician[] } }[]
  >(Prisma.sql`${metricsCTE(filters, viewer.organizationId, true)},
    eligible AS (
      SELECT u.id,u.name,u.active,u.role FROM "User" u WHERE u."organizationId"=${viewer.organizationId} AND
      ((u.role='TI' AND u.active) OR EXISTS(SELECT 1 FROM principal_period r WHERE r.user_id=u.id)
        OR EXISTS(SELECT 1 FROM support_period s WHERE s.user_id=u.id)
        OR EXISTS(SELECT 1 FROM m WHERE m."assigneeId"=u.id AND (m.resolved_period OR m.status<>'RESOLVIDO')))
      ${filters.technician ? Prisma.sql`AND u.id=${filters.technician}` : Prisma.empty}
    ), people AS (SELECT * FROM eligible ORDER BY name,id LIMIT 20 OFFSET ${(page - 1) * 20}),
    portfolios AS (
      SELECT u.id, count(m.id) FILTER(WHERE m.resolved_period) AS resolved,
        count(m.id) FILTER(WHERE m.status<>'RESOLVIDO') AS pending,
        count(m.id) FILTER(WHERE m.status='EM_ATENDIMENTO') AS attending,
        count(m.id) FILTER(WHERE m.status='AGUARDANDO') AS waiting,
        ${stats(Prisma.sql`m.response_seconds`, Prisma.sql`m.opened_period`)} AS response,
        ${stats(Prisma.sql`m.total_seconds`, Prisma.sql`m.resolved_period`)} AS total,
        ${stats(Prisma.sql`m.active_seconds`, Prisma.sql`m.resolved_period`)} AS cycle
      FROM people u LEFT JOIN m ON m."assigneeId"=u.id GROUP BY u.id
    ), principal_counts AS (SELECT r.user_id,count(*) AS count FROM principal_period r GROUP BY r.user_id),
    support_counts AS (SELECT r.user_id,count(*) AS count FROM support_period r GROUP BY r.user_id),
    complexity_counts AS (SELECT r.user_id,coalesce(m.complexity::text,'Não classificada') AS name,count(*) AS count FROM principal_period r JOIN m ON m.id=r."ticketId" GROUP BY r.user_id,m.complexity),
    complexities AS (SELECT user_id,jsonb_object_agg(name,count) AS values FROM complexity_counts GROUP BY user_id)
    SELECT jsonb_build_object('total',(SELECT count(*) FROM eligible),'rows',coalesce((SELECT jsonb_agg(x ORDER BY x.name,x.id) FROM (
      SELECT u.*,coalesce(pc.count,0) AS principal,coalesce(sc.count,0) AS support,p.resolved,p.pending,p.attending,p.waiting,p.response,p.total,p.cycle,coalesce(c.values,'{}'::jsonb) AS complexities
      FROM people u JOIN portfolios p ON p.id=u.id LEFT JOIN principal_counts pc ON pc.user_id=u.id LEFT JOIN support_counts sc ON sc.user_id=u.id LEFT JOIN complexities c ON c.user_id=u.id
    ) x),'[]'::jsonb)) AS data`);
  return { ...rows[0].data, filters, page };
}
export async function technicianDetail(
  actorId: string,
  userId: string,
  input: SearchParams,
  now = new Date(),
) {
  const viewer = await managementAccess(actorId);
  const user = await db.user.findUnique({
    where: { id: userId, organizationId: viewer.organizationId },
    select: { id: true, name: true, active: true },
  });
  if (!user) throw new AppError('Técnico não encontrado.', 404);
  const filters = analyticsFilters({ ...input, technician: userId }, now);
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(input.pagina)) || 1));
  const result = await db.$queryRaw<
    {
      data: {
        total: number;
        tickets: MetricTicket[];
        categories: Distribution[];
        departments: Distribution[];
        complexities: Distribution[];
      };
    }[]
  >(Prisma.sql`${metricsCTE(filters, viewer.organizationId, true)},
    involved AS (SELECT m.*,EXISTS(SELECT 1 FROM principal_period r WHERE r."ticketId"=m.id AND r.user_id=${userId}) AS principal,
      EXISTS(SELECT 1 FROM support_period s WHERE s."ticketId"=m.id AND s.user_id=${userId}) AS support FROM m),
    selected AS (SELECT * FROM involved WHERE principal OR support),
    recent AS (SELECT id,number,requester,company,unit,department,category,complexity,status,to_char("createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",to_char("resolvedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "resolvedAt",assignee,principal,support FROM selected ORDER BY "createdAt" DESC,id LIMIT 20 OFFSET ${(page - 1) * 20})
    SELECT jsonb_build_object('total',(SELECT count(*) FROM selected),'tickets',coalesce((SELECT jsonb_agg(recent ORDER BY "createdAt" DESC,id) FROM recent),'[]'::jsonb),
      'categories',coalesce((SELECT jsonb_agg(x ORDER BY x.count DESC,x.name) FROM (SELECT coalesce(category,'Sem categoria') AS name,count(*) AS count FROM selected GROUP BY category) x),'[]'::jsonb),
      'departments',coalesce((SELECT jsonb_agg(x ORDER BY x.count DESC,x.name) FROM (SELECT department AS name,count(*) AS count FROM selected GROUP BY department) x),'[]'::jsonb),
      'complexities',coalesce((SELECT jsonb_agg(x ORDER BY x.name) FROM (SELECT coalesce(complexity::text,'Não classificada') AS name,count(*) AS count FROM selected GROUP BY complexity) x),'[]'::jsonb)
    ) AS data`);
  const team = await teamReport(actorId, { ...input, technician: userId, pagina: '1' }, now);
  return { ...result[0].data, user, summary: team.rows[0], filters, page };
}
export type ExportRow = {
  cnpj: string | null;
  openedBy: string | null;
  registeredRequester: string | null;
  manualRequester: string | null;
  number: number;
  company: string | null;
  unit: string | null;
  requester: string;
  department: string;
  assignee: string | null;
  category: string | null;
  complexity: string | null;
  impact: string;
  status: string;
  origin: string;
  createdAt: Date;
  first_response: Date | null;
  resolvedAt: Date | null;
  total_seconds: number | null;
  waiting_seconds: number | null;
  active_seconds: number | null;
};
export async function exportRows(
  actorId: string,
  input: SearchParams,
  now = new Date(),
  afterNumber = 0,
  limit = 500,
  tx: Prisma.TransactionClient = db,
) {
  const viewer = await actor(tx, actorId, ['ADMIN', 'GESTOR']);
  const f = analyticsFilters(input, now);
  return tx.$queryRaw<ExportRow[]>(
    Prisma.sql`${metricsCTE(f, viewer.organizationId, false, { after: afterNumber, limit: Math.min(500, Math.max(1, limit)) })} SELECT number,requester,company,cnpj,unit,"openedBy","registeredRequester",CASE WHEN "requesterId" IS NULL THEN "requesterName" END AS "manualRequester",department,assignee,category,complexity,impact,status,origin,"createdAt",first_response,"resolvedAt",total_seconds,waiting_seconds,active_seconds FROM m ORDER BY number`,
  );
}
export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400)
    return `${(seconds / 3600).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
  return `${(seconds / 86400).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`;
}
export function describeFilters(f: AnalyticsFilters) {
  return `${f.from.split('-').reverse().join('/')} a ${f.to.split('-').reverse().join('/')} · ${f.zone}`;
}

export type CompanyMetrics = {
  id: string;
  name: string;
  active: boolean;
  opened: number;
  resolved: number;
  pending: number;
  totalMedian: number | null;
  activeMedian: number | null;
  topCategory: string | null;
};
export async function companiesReport(actorId: string, input: SearchParams, now = new Date()) {
  const viewer = await managementAccess(actorId);
  const filters = analyticsFilters(input, now);
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(input.pagina)) || 1));
  const result = await db.$queryRaw<
    { data: { total: number; rows: CompanyMetrics[] } }[]
  >(Prisma.sql`${metricsCTE(filters, viewer.organizationId)},
    locations AS (SELECT id,"displayName" AS name,active FROM "Company" WHERE "organizationId"=${viewer.organizationId}
      ${filters.company ? Prisma.sql`AND id=${filters.company}` : Prisma.empty}
      UNION ALL SELECT 'none','Sem filial',true WHERE EXISTS(SELECT 1 FROM m WHERE "companyId" IS NULL)),
    category_counts AS (SELECT coalesce("companyId",'none') AS company, coalesce(category,'Sem categoria') AS name,count(*) AS count FROM m WHERE opened_period GROUP BY "companyId",category),
    category_order AS (SELECT *,row_number() OVER(PARTITION BY company ORDER BY count DESC,name) AS position FROM category_counts),
    reports AS (SELECT c.*,count(m.id) FILTER(WHERE m.opened_period) AS opened,count(m.id) FILTER(WHERE m.resolved_period) AS resolved,
      count(m.id) FILTER(WHERE m.status<>'RESOLVIDO') AS pending,
      percentile_cont(0.5) WITHIN GROUP(ORDER BY m.total_seconds) FILTER(WHERE m.resolved_period) AS "totalMedian",
      percentile_cont(0.5) WITHIN GROUP(ORDER BY m.active_seconds) FILTER(WHERE m.resolved_period) AS "activeMedian",
      max(l.name) AS "topCategory"
      FROM locations c LEFT JOIN m ON coalesce(m."companyId",'none')=c.id LEFT JOIN category_order l ON l.company=c.id AND l.position=1 GROUP BY c.id,c.name,c.active)
    SELECT jsonb_build_object('total',(SELECT count(*) FROM reports),'rows',coalesce((SELECT jsonb_agg(r ORDER BY r.opened DESC,r.name) FROM (SELECT * FROM reports ORDER BY opened DESC,name LIMIT 20 OFFSET ${(page - 1) * 20}) r),'[]'::jsonb)) AS data`);
  return { ...result[0].data, page, filters };
}
export async function managementTickets(actorId: string, input: SearchParams, now = new Date()) {
  const viewer = await managementAccess(actorId);
  const filters = analyticsFilters(input, now);
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(input.pagina)) || 1));
  const result = await db.$queryRaw<
    { data: { total: number; tickets: MetricTicket[] } }[]
  >(Prisma.sql`${metricsCTE(filters, viewer.organizationId)},
    selected AS (SELECT * FROM m WHERE ${input.carteira === 'pendentes' ? Prisma.sql`status<>'RESOLVIDO'` : Prisma.sql`opened_period OR resolved_period`}),
    recent AS (SELECT id,number,requester,company,unit,department,category,complexity,status,to_char("createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",to_char("resolvedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "resolvedAt",assignee FROM selected ORDER BY "createdAt" DESC,id LIMIT 20 OFFSET ${(page - 1) * 20})
    SELECT jsonb_build_object('total',(SELECT count(*) FROM selected),'tickets',coalesce((SELECT jsonb_agg(recent ORDER BY "createdAt" DESC,id) FROM recent),'[]'::jsonb)) AS data`);
  return { ...result[0].data, page, filters };
}
