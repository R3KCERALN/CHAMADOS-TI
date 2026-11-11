import { db } from './db';
import {
  analyticsOptions,
  companiesReport,
  describeFilters,
  exportRows,
  formatDuration,
  managementAccess,
  overview,
  teamReport,
  technicianDetail,
  type Distribution,
  type MetricTicket,
  type TimeStats,
} from './analytics-service';
import { analyticsFilters } from './analytics-query';
import { AppError } from './errors';
import { complexityLabels, formatDate, statusLabels, waitingLabels } from './labels';
import { organizationLabels as labels } from './organization-labels';
import type { PdfReport, PdfSection } from './pdf-report';
import type { SearchParams } from './period';
export type PdfScreen = 'panorama' | 'filiais' | 'filial' | 'equipe' | 'tecnico' | 'chamados';
export const pdfScreens: PdfScreen[] = [
  'panorama',
  'filiais',
  'filial',
  'equipe',
  'tecnico',
  'chamados',
];
const DEFAULT_MAX_ROWS = 2000;
const MAX_PAGES = 500;
const NONE = '—';
const timeCell = (stats: TimeStats) =>
  stats.median == null ? NONE : `${formatDuration(stats.median)} (n=${stats.count})`;
const complexityName = (key: string) =>
  complexityLabels[key as keyof typeof complexityLabels] || key;
const statusName = (key: string) => statusLabels[key as keyof typeof statusLabels] || key;
const date = (value: Date | string | null) => (value ? formatDate(new Date(value)) : NONE);
const distribution = (
  heading: string,
  rows: Distribution[],
  options: { time?: boolean; name?: string } = {},
): PdfSection => ({
  heading,
  table: {
    columns: [
      options.name ?? 'Item',
      'Chamados',
      ...(options.time ? ['Tempo ativo', 'Mediana'] : []),
    ],
    rows: rows.map((row) => [
      row.name,
      String(row.count),
      ...(options.time ? [formatDuration(row.seconds), formatDuration(row.median)] : []),
    ]),
  },
});
const ticketTable = (heading: string, rows: MetricTicket[]): PdfSection => ({
  heading,
  table: {
    columns: [
      'Nº',
      'Equipe',
      labels.company,
      'Solicitante',
      'Categoria',
      'Status',
      'Abertura',
      'Responsável',
    ],
    rows: rows.map((t) => [
      `CS-${String(t.number).padStart(4, '0')}`,
      t.team,
      t.company || labels.noCompany,
      t.requester,
      t.category || 'Sem categoria',
      statusName(t.status),
      date(t.createdAt),
      t.assignee || NONE,
    ]),
  },
});
async function pages<T>(
  load: (page: number) => Promise<{ rows: T[]; total: number }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { rows, total } = await load(page);
    all.push(...rows);
    if (!rows.length || all.length >= total) break;
  }
  return all;
}
async function describe(actorId: string, input: SearchParams, now: Date) {
  const filters = analyticsFilters(input, now);
  const options = await analyticsOptions(actorId);
  const lines = [`Período: ${describeFilters(filters)}`];
  const add = (label: string, value: string | undefined) => {
    if (value) lines.push(`${label}: ${value}`);
  };
  const units = options.companies.flatMap((c) => c.units);
  const name = (items: { id: string; name: string }[], id: string) =>
    items.find((item) => item.id === id)?.name;
  if (filters.company)
    add(
      labels.company,
      filters.company === 'none'
        ? labels.noCompany
        : options.companies.find((c) => c.id === filters.company)?.displayName,
    );
  if (filters.unit)
    add(labels.unit, filters.unit === 'none' ? labels.noUnit : name(units, filters.unit));
  if (filters.team) add('Equipe', name(options.teams, filters.team));
  if (filters.department) add('Setor', name(options.departments, filters.department));
  if (filters.technician) add('Técnico', name(options.technicians, filters.technician));
  if (filters.category)
    add(
      'Categoria',
      filters.category === 'none' ? 'Sem categoria' : name(options.categories, filters.category),
    );
  if (filters.complexity)
    add(
      'Complexidade',
      filters.complexity === 'none' ? 'Não classificada' : complexityName(filters.complexity),
    );
  if (filters.status) add('Status', statusName(filters.status));
  if (input.carteira === 'pendentes') add('Carteira', 'pendências atuais');
  return { filters, lines, options };
}
function overviewSections(data: Awaited<ReturnType<typeof overview>>, company: boolean) {
  const s = data.summary;
  const sections: PdfSection[] = [
    {
      heading: 'Resumo',
      kpis: [
        ['Abertos no período', String(s.opened)],
        ['Resolvidos no período', String(s.resolved)],
        ['Pendentes agora', String(s.pending)],
        ['Novos agora', String(s.new)],
        ['Em atendimento agora', String(s.attending)],
        ['Aguardando agora', String(s.waiting)],
        ['Mediana até primeira resposta', timeCell(s.response)],
        ['Mediana até resolução', timeCell(s.total)],
        ['Mediana ativa de ciclo', timeCell(s.active)],
      ],
    },
  ];
  if (s.incomplete > 0)
    sections[0].kpis!.push([
      'Chamados com histórico incompleto',
      `${s.incomplete} (tempos indisponíveis aparecem como —)`,
    ]);
  sections.push({
    heading: 'Evolução',
    table: {
      columns: ['Período', 'Abertos', 'Resolvidos'],
      rows: data.series.map((r) => [r.bucket, String(r.opened), String(r.resolved)]),
    },
  });
  if (!company)
    sections.push(
      distribution(`Chamados por ${labels.company.toLowerCase()}`, data.companies, {
        name: labels.company,
      }),
    );
  sections.push(
    distribution(`Chamados por ${labels.unit.toLowerCase()}`, data.units, { name: labels.unit }),
  );
  if (!company)
    sections.push(distribution('Demanda por setor', data.departments, { name: 'Setor' }));
  sections.push(
    distribution('Demanda por categoria', data.categories, { time: true, name: 'Categoria' }),
    distribution(
      'Complexidade da demanda',
      data.complexities.map((r) => ({ ...r, name: complexityName(r.name) })),
      { name: 'Complexidade' },
    ),
  );
  if (!company)
    sections.push({
      heading: 'Por que aguardamos?',
      table: {
        columns: ['Motivo', 'Chamados', 'Tempo em espera'],
        rows: data.waits.map((r) => [
          waitingLabels[r.name as keyof typeof waitingLabels] || r.name,
          String(r.count),
          formatDuration(r.seconds),
        ]),
      },
    });
  if (!company)
    sections.push(
      distribution('Idade dos pendentes', data.backlog, { name: 'Idade' }),
      ticketTable('10 pendências mais antigas', data.oldest),
    );
  return sections;
}
export async function buildManagementPdf(
  actorId: string,
  screen: PdfScreen,
  input: SearchParams,
  id?: string,
  options: { now?: Date; maxRows?: number } = {},
): Promise<PdfReport> {
  const now = options.now ?? new Date();
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const viewer = await managementAccess(actorId);
  const base = {
    organizationName: viewer.organization.name,
    generatedBy: viewer.name,
    generatedAt: now,
  };
  const report = (title: string, lines: string[], sections: PdfSection[], notice?: string) => ({
    ...base,
    title,
    filters: lines,
    sections,
    ...(notice ? { notice } : {}),
  });
  if (screen === 'panorama') {
    const [{ lines }, data] = await Promise.all([
      describe(actorId, input, now),
      overview(actorId, input, now),
    ]);
    return report('Panorama do suporte', lines, overviewSections(data, false));
  }
  if (screen === 'filiais') {
    const { lines } = await describe(actorId, input, now);
    const rows = await pages(async (pagina) => {
      const data = await companiesReport(actorId, { ...input, pagina: String(pagina) }, now);
      return { rows: data.rows, total: data.total };
    });
    return report(labels.companies, lines, [
      {
        heading: labels.companies,
        table: {
          columns: [
            labels.company,
            'Abertos no período',
            'Resolvidos no período',
            'Backlog atual',
            'Mediana resolução',
            'Mediana ativa de ciclo',
            'Categoria mais frequente',
          ],
          rows: rows.map((c) => [
            c.active ? c.name : `${c.name} (inativa)`,
            String(c.opened),
            String(c.resolved),
            String(c.pending),
            formatDuration(c.totalMedian),
            formatDuration(c.activeMedian),
            c.topCategory || NONE,
          ]),
        },
      },
    ]);
  }
  if (screen === 'filial') {
    const company =
      id === 'none'
        ? null
        : await db.company.findFirst({
            where: { id: id ?? '', organizationId: viewer.organizationId },
            select: { displayName: true, legalName: true },
          });
    if (!id || (id !== 'none' && !company)) throw new AppError('Local não encontrado.', 404);
    const scoped = { ...input, company: id };
    const [{ lines }, data] = await Promise.all([
      describe(actorId, scoped, now),
      overview(actorId, scoped, now),
    ]);
    return report(company?.displayName || labels.noCompany, lines, overviewSections(data, true));
  }
  if (screen === 'equipe') {
    const { lines } = await describe(actorId, input, now);
    const rows = await pages(async (pagina) => {
      const data = await teamReport(actorId, { ...input, pagina: String(pagina) }, now);
      return { rows: data.rows, total: data.total };
    });
    return report('Equipe', lines, [
      {
        heading: 'Responsabilidades, apoios e carga atual',
        table: {
          columns: [
            'Pessoa',
            'Principal no período',
            'Apoios no período',
            'Resolveu como final',
            'Backlog atual',
            'Em atendimento',
            'Aguardando',
            'Mediana 1ª resposta',
            'Mediana resolução',
            'Mediana ativa de ciclo',
          ],
          rows: rows.map((t) => [
            t.active ? t.name : `${t.name} (inativo)`,
            String(t.principal),
            String(t.support),
            String(t.resolved),
            String(t.pending),
            String(t.attending),
            String(t.waiting),
            timeCell(t.response),
            timeCell(t.total),
            timeCell(t.cycle),
          ]),
        },
      },
    ]);
  }
  if (screen === 'tecnico') {
    if (!id) throw new AppError('Técnico não encontrado.', 404);
    const [{ lines }, data] = await Promise.all([
      describe(actorId, { ...input, technician: id }, now),
      technicianDetail(actorId, id, input, now),
    ]);
    const s = data.summary;
    const none: TimeStats = { mean: null, median: null, count: 0 };
    return report(data.user.name, lines, [
      {
        heading: 'Resumo',
        kpis: [
          ['Participou como principal', String(s?.principal ?? 0)],
          ['Participou como apoio', String(s?.support ?? 0)],
          ['Resolveu como final', String(s?.resolved ?? 0)],
          ['Backlog atual', String(s?.pending ?? 0)],
          ['Em atendimento', String(s?.attending ?? 0)],
          ['Aguardando', String(s?.waiting ?? 0)],
          ['Mediana até primeira resposta', timeCell(s?.response ?? none)],
          ['Mediana total até resolução', timeCell(s?.total ?? none)],
          ['Mediana ativa de ciclo', timeCell(s?.cycle ?? none)],
        ],
      },
      distribution('Categorias em que participou', data.categories, { name: 'Categoria' }),
      distribution('Setores atendidos', data.departments, { name: 'Setor' }),
      distribution(
        'Complexidade atendida',
        data.complexities.map((r) => ({ ...r, name: complexityName(r.name) })),
        { name: 'Complexidade' },
      ),
      ticketTable(`Chamados recentes (${data.tickets.length} de ${data.total})`, data.tickets),
    ]);
  }
  if (screen === 'chamados') {
    const { lines } = await describe(actorId, input, now);
    const pending = input.carteira === 'pendentes';
    const rows = await db.$transaction(
      async (tx) => {
        const all: Awaited<ReturnType<typeof exportRows>> = [];
        let after = 0;
        while (all.length <= maxRows) {
          const batch = await exportRows(
            actorId,
            input,
            now,
            after,
            maxRows + 1 - all.length,
            tx,
            pending,
          );
          if (!batch.length) break;
          all.push(...batch);
          after = batch[batch.length - 1].number;
        }
        return all;
      },
      { isolationLevel: 'RepeatableRead', timeout: 120000 },
    );
    const cut = rows.length > maxRows;
    const shown = rows.slice(0, maxRows);
    return report(
      pending ? 'Pendências atuais' : 'Chamados do período',
      lines,
      [
        {
          heading: `${shown.length} chamado(s)`,
          table: {
            columns: [
              'Nº',
              'Equipe',
              labels.company,
              labels.unit,
              'Solicitante',
              'Setor',
              'Categoria',
              'Complexidade',
              'Status',
              'Abertura',
              'Resolução',
              'Responsável',
            ],
            rows: shown.map((r) => [
              `CS-${String(r.number).padStart(4, '0')}`,
              r.team,
              r.company || labels.noCompany,
              r.unit || labels.noUnit,
              r.requester,
              r.department,
              r.category || 'Sem categoria',
              r.complexity ? complexityName(r.complexity) : 'Não classificada',
              statusName(r.status),
              date(r.createdAt),
              date(r.resolvedAt),
              r.assignee || NONE,
            ]),
          },
        },
      ],
      cut
        ? `O relatório mostra os primeiros ${maxRows} chamados, por número. Há mais chamados nestes filtros: use o CSV para a lista completa ou reduza o período.`
        : undefined,
    );
  }
  throw new AppError('Tela de relatório inválida.', 400);
}
