import Link from 'next/link';
import { organizationLabels as labels } from '@/lib/organization-labels';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { analyticsOptions, overview, describeFilters } from '@/lib/analytics-service';
import { type SearchParams, queryString } from '@/lib/period';
import { ManagementFilters } from '@/components/management/filters';
import { MetricCard, TimeCard } from '@/components/management/summary';
import { Bars, Evolution } from '@/components/management/charts';
import { ManagementTicketTable } from '@/components/management/ticket-table';
import { complexityLabels, statusLabels, waitingLabels } from '@/lib/labels';
export default async function ManagementPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  if (!['GESTOR', 'ADMIN'].includes(user.role)) notFound();
  const params = await searchParams;
  const [data, options] = await Promise.all([overview(user.id, params), analyticsOptions(user.id)]);
  const values = Object.fromEntries(
    Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
  const optionName = <T extends { id: string; name?: string; displayName?: string }>(
    items: T[],
    id: string | undefined,
  ) =>
    items.find((item) => item.id === id)?.name || items.find((item) => item.id === id)?.displayName;
  const units = options.companies.flatMap((company) => company.units);
  const activeFilters: { label: string; value: string }[] = [
    { label: 'Período', value: describeFilters(data.filters) },
  ];
  const addFilter = (label: string, value: string | undefined) => {
    if (value) activeFilters.push({ label, value });
  };
  if (values.company)
    addFilter(
      labels.company,
      values.company === 'none' ? labels.noCompany : optionName(options.companies, values.company),
    );
  if (values.unit)
    addFilter(labels.unit, values.unit === 'none' ? labels.noUnit : optionName(units, values.unit));
  if (values.department) addFilter('Setor', optionName(options.departments, values.department));
  if (values.technician) addFilter('Técnico', optionName(options.technicians, values.technician));
  if (values.category)
    addFilter(
      'Categoria',
      values.category === 'none'
        ? 'Sem categoria'
        : optionName(options.categories, values.category),
    );
  if (values.complexity)
    addFilter(
      'Complexidade',
      values.complexity === 'none'
        ? 'Não classificada'
        : complexityLabels[values.complexity as keyof typeof complexityLabels],
    );
  if (values.status) addFilter('Status', statusLabels[values.status as keyof typeof statusLabels]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">GESTÃO · VISÃO GERAL</span>
          <h1>Panorama do suporte</h1>
          <p>Demanda, fluxo e contexto para decidir o próximo passo.</p>
        </div>
        <div className="management-links">
          <Link className="button secondary" href={`/gestor/filiais?${queryString(params)}`}>
            {labels.companies}
          </Link>
          <Link href={`/gestor/equipe?${queryString(params)}`} className="button secondary">
            Equipe de TI
          </Link>
          <a href={`/gestor/exportar?${queryString(params)}`} className="button primary">
            Exportar CSV
          </a>
        </div>
      </div>
      <nav className="management-section-nav" aria-label="Seções do panorama">
        <a href="#resumo">Resumo</a>
        <a href="#demanda">Demanda</a>
        <a href="#backlog">Backlog</a>
      </nav>
      <ManagementFilters options={options} values={values} />
      <div className="active-filter-summary" aria-label="Filtros ativos">
        <strong>Filtros ativos</strong>
        <ul>
          {activeFilters.map((filter) => (
            <li key={filter.label}>
              <span>{filter.label}</span>
              {filter.value}
            </li>
          ))}
        </ul>
        <small>
          Técnico considera o responsável atual/final; classificação e status usam a posição atual.
        </small>
      </div>

      <section id="resumo" className="management-block" aria-labelledby="resumo-title">
        <header className="management-block-heading">
          <span className="eyebrow">VISÃO GERAL</span>
          <h2 id="resumo-title">Resumo</h2>
          <p>Volume, situação atual e tempos centrais da operação.</p>
        </header>
        <div className="metric-grid summary-volume-grid">
          <MetricCard
            label="Abertos no período"
            value={data.summary.opened}
            hint="Chamados criados dentro do intervalo."
          />
          <MetricCard
            label="Resolvidos no período"
            value={data.summary.resolved}
            hint="Resoluções no intervalo, inclusive de chamados antigos."
          />
          <MetricCard
            label="Pendentes agora"
            value={data.summary.pending}
            hint="Todo o backlog atual; sem corte pela data de abertura."
          />
        </div>
        <div className="metric-grid compact-metric-grid">
          <MetricCard
            label="Novos agora"
            value={data.summary.new}
            hint="Aguardam o início do atendimento."
          />
          <MetricCard
            label="Em atendimento agora"
            value={data.summary.attending}
            hint="Atendimentos em curso neste momento."
          />
          <MetricCard
            label="Aguardando agora"
            value={data.summary.waiting}
            hint="Atendimentos em espera neste momento."
          />
        </div>
        <div className="metric-grid time-grid">
          <TimeCard
            label="Mediana até primeira resposta"
            stats={data.summary.response}
            hint="Da criação ao primeiro ASSUMIDO, nos chamados abertos no período e já assumidos."
          />
          <TimeCard
            label="Mediana até resolução"
            stats={data.summary.total}
            hint="Ciclo completo dos resolvidos no período, incluindo fila e espera."
          />
          <TimeCard
            label="Mediana ativa de ciclo"
            stats={data.summary.active}
            hint="Períodos EM_ATENDIMENTO dos resolvidos no período. Não são horas trabalhadas."
          />
        </div>
        {data.summary.incomplete > 0 && (
          <p className="notice error">
            {data.summary.incomplete} chamado(s) com histórico incompleto. Tempos derivados sem
            evidência suficiente aparecem como indisponíveis.
          </p>
        )}
      </section>

      <section id="demanda" className="management-block" aria-labelledby="demanda-title">
        <header className="management-block-heading">
          <span className="eyebrow">COMPORTAMENTO DA OPERAÇÃO</span>
          <h2 id="demanda-title">Demanda</h2>
          <p>Evolução, origem e perfil dos chamados recebidos.</p>
        </header>
        <Evolution rows={data.series} />
        <div className="analytics-grid">
          <Bars
            title={`Chamados por ${labels.company.toLowerCase()}`}
            subtitle="Abertos no período, incluindo dados históricos sem localização."
            rows={data.companies}
            links={Object.fromEntries(
              data.companies.map((c) => [
                c.id!,
                `/gestor/filiais/${c.id}?${queryString(params, { company: c.id!, unit: '', pagina: '' })}`,
              ]),
            )}
          />
          {options.companies.some((c) => c.units.length) && (
            <Bars
              title={`Chamados por ${labels.unit.toLowerCase()}`}
              subtitle="Abertos no período. Clique para consultar os chamados."
              rows={data.units}
              links={Object.fromEntries(
                data.units.map((u) => [
                  u.id!,
                  `/gestor/chamados?${queryString(params, { unit: u.id!, pagina: '' })}`,
                ]),
              )}
            />
          )}
          <Bars
            title="Demanda por setor"
            subtitle="Chamados abertos no período e participação no total."
            rows={data.departments}
          />
          <Bars
            title="Demanda por categoria"
            subtitle="Abertos no período. Tempo ativo acumulado e mediano apenas dos já resolvidos; ciclos podem ocorrer em paralelo."
            rows={data.categories}
            time
          />
          <Bars
            title="Complexidade da demanda"
            subtitle="Classificação atual dos chamados abertos no período."
            rows={['BAIXA', 'MEDIA', 'ALTA', 'CRITICA', 'Não classificada'].map((key) => ({
              name: complexityLabels[key as keyof typeof complexityLabels] || key,
              count: data.complexities.find((r) => r.name === key)?.count || 0,
            }))}
          />
          <Bars
            title="Por que aguardamos?"
            subtitle="Chamados distintos por motivo e espera que ocorreu no período. Um chamado pode ter vários motivos."
            rows={Object.entries(waitingLabels).map(([key, name]) => ({
              ...data.waits.find((r) => r.name === key),
              name,
              count: data.waits.find((r) => r.name === key)?.count || 0,
              seconds: data.waits.find((r) => r.name === key)?.seconds || 0,
            }))}
            time
          />
        </div>
      </section>

      <section
        id="backlog"
        className="management-block backlog-section"
        aria-labelledby="backlog-title"
      >
        <header className="management-block-heading">
          <span className="eyebrow">POSIÇÃO ATUAL</span>
          <h2 id="backlog-title">Backlog</h2>
          <p>Idade em tempo corrido desde a abertura; não representa trabalho do técnico.</p>
        </header>
        <Bars
          title="Idade dos pendentes"
          subtitle="Respeita os filtros de dimensão; o período não oculta pendências antigas."
          rows={['Menos de 1 dia', '1–3 dias', '4–7 dias', '8–15 dias', 'Mais de 15 dias'].map(
            (name) => ({ name, count: data.backlog.find((r) => r.name === name)?.count || 0 }),
          )}
        />
        <section className="panel list-panel oldest">
          <div className="section-heading">
            <h2>10 pendências mais antigas</h2>
            <span className="muted small">
              {user.role === 'GESTOR'
                ? 'Consulta gerencial; detalhe operacional reservado ao TI/ADMIN.'
                : 'Abra um chamado para acompanhar.'}
            </span>
          </div>
          <ManagementTicketTable rows={data.oldest} canOpen={user.role === 'ADMIN'} />
        </section>
      </section>
      <p className="report-caption">
        CSV: chamados abertos ou resolvidos no período, uma linha por chamado. Espera no gráfico é
        recortada ao período; os tempos do CSV são do ciclo completo.
      </p>
    </>
  );
}
