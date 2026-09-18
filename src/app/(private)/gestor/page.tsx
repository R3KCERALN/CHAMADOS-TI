import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { analyticsOptions, overview, describeFilters } from '@/lib/analytics-service';
import { type SearchParams, queryString } from '@/lib/period';
import { ManagementFilters } from '@/components/management/filters';
import { MetricCard, TimeCard } from '@/components/management/summary';
import { Bars, Evolution } from '@/components/management/charts';
import { ManagementTicketTable } from '@/components/management/ticket-table';
import { complexityLabels, waitingLabels } from '@/lib/labels';
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
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">GESTÃO · VISÃO GERAL</span>
          <h1>Panorama do suporte</h1>
          <p>Demanda, fluxo e contexto para decidir o próximo passo.</p>
        </div>
        <div className="management-links">
          <Link href={`/gestor/equipe?${queryString(params)}`} className="button secondary">
            Equipe de TI
          </Link>
          <a href={`/gestor/exportar?${queryString(params)}`} className="button primary">
            Exportar CSV
          </a>
        </div>
      </div>
      <ManagementFilters options={options} values={values} />
      <p className="report-caption">
        {describeFilters(data.filters)} · Técnico: responsável atual/final. Classificações e status:
        posição atual.
      </p>
      <section className="metric-grid">
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
      </section>
      <section className="metric-grid time-grid">
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
      </section>
      {data.summary.incomplete > 0 && (
        <p className="notice error">
          {data.summary.incomplete} chamado(s) com histórico incompleto. Tempos derivados sem
          evidência suficiente aparecem como indisponíveis.
        </p>
      )}
      <Evolution rows={data.series} />
      <div className="analytics-grid">
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
      <section className="backlog-section">
        <div className="page-heading">
          <div>
            <span className="eyebrow">POSIÇÃO ATUAL</span>
            <h2>Backlog e envelhecimento</h2>
            <p>Idade em tempo corrido desde a abertura; não representa trabalho do técnico.</p>
          </div>
        </div>
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
