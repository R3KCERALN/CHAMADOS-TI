import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import {
  analyticsOptions,
  teamReport,
  formatDuration,
  describeFilters,
} from '@/lib/analytics-service';
import { queryString, type SearchParams } from '@/lib/period';
import { ManagementFilters } from '@/components/management/filters';
import { PdfLink } from '@/components/management/pdf-link';
import { Pagination } from '@/components/pagination';
import { complexityLabels } from '@/lib/labels';
export default async function TeamPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  if (!['GESTOR', 'ADMIN'].includes(user.role)) notFound();
  const params = await searchParams;
  const [data, options] = await Promise.all([
    teamReport(user.id, params),
    analyticsOptions(user.id),
  ]);
  const values = Object.fromEntries(
    Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
  return (
    <>
      <Link className="back-link" href={`/gestor?${queryString(params, { pagina: '' })}`}>
        ← Visão geral
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">GESTÃO · EQUIPE</span>
          <h1>Equipe técnica</h1>
          <p>Responsabilidades, apoios e carga atual. Sem pontuação ou comparação competitiva.</p>
        </div>
        <PdfLink screen="equipe" params={params} />
      </div>
      <ManagementFilters options={options} values={values} />
      <p className="report-caption">
        {describeFilters(data.filters, options.teams.find((t) => t.id === data.filters.team)?.name)}{' '}
        · Ordem alfabética. Técnicos ativos e pessoas com atuação histórica ou pendências.
      </p>
      <section className="panel list-panel">
        <div className="table-scroll">
          <table className="team-table">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Principal no período</th>
                <th>Apoios no período</th>
                <th>Resolveu como final</th>
                <th>Backlog atual</th>
                <th>Em atendimento</th>
                <th>Aguardando</th>
                <th>Complexidade como principal</th>
                <th>Mediana 1ª resposta</th>
                <th>Mediana resolução</th>
                <th>Mediana ativa de ciclo</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link
                      className="text-link"
                      href={`/gestor/equipe/${t.id}?${queryString(params, { pagina: '', technician: t.id })}`}
                    >
                      {t.name}
                    </Link>
                    <small>{t.active ? 'Ativo' : 'Inativo · histórico preservado'}</small>
                  </td>
                  <td>{t.principal}</td>
                  <td>{t.support}</td>
                  <td>{t.resolved}</td>
                  <td>{t.pending}</td>
                  <td>{t.attending}</td>
                  <td>{t.waiting}</td>
                  <td className="complexity-cell">
                    {Object.entries(t.complexities).map(([key, n]) => (
                      <span key={key}>
                        {complexityLabels[key as keyof typeof complexityLabels] || key}: {n}
                      </span>
                    ))}
                  </td>
                  <td>
                    {formatDuration(t.response.median)}
                    <small>n={t.response.count}</small>
                  </td>
                  <td>
                    {formatDuration(t.total.median)}
                    <small>n={t.total.count}</small>
                  </td>
                  <td>
                    {formatDuration(t.cycle.median)}
                    <small>n={t.cycle.count}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.rows.length && (
          <p className="chart-empty">Nenhuma pessoa com atuação para estes filtros.</p>
        )}
      </section>
      <Pagination path="/gestor/equipe" params={params} page={data.page} total={data.total} />
      <section className="panel padded metric-explanation">
        <h2>Como ler estes números</h2>
        <p>
          Principal e apoio contam chamados distintos com participação que cruzou o período, mesmo
          se a pessoa saiu depois. Uma transferência pode fazer o mesmo chamado aparecer na
          participação de duas pessoas, mas a resolução é creditada somente ao responsável final.
        </p>
        <p>
          As medianas descrevem o ciclo inteiro da carteira atual/final, inclusive etapas com outros
          técnicos. Não são tempo individual de trabalho. Carga e complexidade ajudam a investigar
          sobrecarga; o sistema não define automaticamente quem está sobrecarregado.
        </p>
      </section>
    </>
  );
}
