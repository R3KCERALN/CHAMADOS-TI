import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { analyticsOptions, technicianDetail, describeFilters } from '@/lib/analytics-service';
import { AppError } from '@/lib/errors';
import { queryString, type SearchParams } from '@/lib/period';
import { ManagementFilters } from '@/components/management/filters';
import { Pagination } from '@/components/pagination';
import { MetricCard, TimeCard } from '@/components/management/summary';
import { Bars } from '@/components/management/charts';
import { ManagementTicketTable } from '@/components/management/ticket-table';
import { complexityLabels } from '@/lib/labels';
export default async function TechnicianPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  if (!['GESTOR', 'ADMIN'].includes(user.role)) notFound();
  const { id } = await params;
  const search = await searchParams;
  const [data, options] = await Promise.all([
    technicianDetail(user.id, id, search).catch((error) => {
      if (error instanceof AppError && error.status === 404) notFound();
      throw error;
    }),
    analyticsOptions(user.id),
  ]);
  const values = Object.fromEntries(
    Object.entries(search).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
  const s = data.summary;
  return (
    <>
      <Link
        className="back-link"
        href={`/gestor/equipe?${queryString(search, { pagina: '', technician: '' })}`}
      >
        ← Equipe de TI
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">GESTÃO · EQUIPE · DETALHE</span>
          <h1>{data.user.name}</h1>
          <p>{data.user.active ? 'Pessoa ativa' : 'Pessoa inativa · histórico preservado'}</p>
        </div>
      </div>
      <ManagementFilters options={options} values={values} lockedTechnician={id} />
      <p className="report-caption">
        {describeFilters(data.filters)} · Participações no período e carteira atual/final.
      </p>
      <div className="metric-grid">
        <MetricCard
          label="Participou como principal"
          value={s?.principal || 0}
          hint="Chamados com responsabilidade que cruzou o período."
        />
        <MetricCard
          label="Participou como apoio"
          value={s?.support || 0}
          hint="Apoios históricos distintos; não são resoluções principais."
        />
        <MetricCard
          label="Resolveu como final"
          value={s?.resolved || 0}
          hint="Resoluções no período com esta pessoa como responsável final."
        />
        <MetricCard
          label="Backlog atual"
          value={s?.pending || 0}
          hint={`${s?.attending || 0} em atendimento · ${s?.waiting || 0} aguardando.`}
        />
      </div>
      {s && (
        <section className="metric-grid time-grid">
          <TimeCard
            label="Mediana até primeira resposta"
            stats={s.response}
            hint="Chamados criados no período da carteira atual/final; ciclo integral."
          />
          <TimeCard
            label="Mediana total até resolução"
            stats={s.total}
            hint="Chamados resolvidos no período como responsável final; ciclo integral."
          />
          <TimeCard
            label="Mediana ativa de ciclo"
            stats={s.cycle}
            hint="Ciclo integral, sem espera. Não são horas individuais trabalhadas."
          />
        </section>
      )}
      <div className="analytics-grid">
        <Bars
          title="Categorias em que participou"
          subtitle="Principal ou apoio no período; cada chamado aparece uma vez."
          rows={data.categories}
        />
        <Bars
          title="Setores atendidos"
          subtitle="Participações principais ou de apoio no período."
          rows={data.departments}
        />
        <Bars
          title="Complexidade atendida"
          subtitle="Classificação atual dos chamados em que participou."
          rows={data.complexities.map((r) => ({
            ...r,
            name: complexityLabels[r.name as keyof typeof complexityLabels] || r.name,
          }))}
        />
      </div>
      <section className="panel list-panel">
        <div className="section-heading">
          <h2>Chamados recentes</h2>
          <span className="muted small">Participação histórica no período</span>
        </div>
        <ManagementTicketTable rows={data.tickets} canOpen={user.role === 'ADMIN'} participation />
      </section>
      <Pagination
        path={`/gestor/equipe/${id}`}
        params={search}
        page={data.page}
        total={data.total}
      />
    </>
  );
}
