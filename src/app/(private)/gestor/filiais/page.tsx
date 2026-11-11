import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { analyticsOptions, companiesReport, formatDuration } from '@/lib/analytics-service';
import { ManagementFilters } from '@/components/management/filters';
import { PdfLink } from '@/components/management/pdf-link';
import { Pagination } from '@/components/pagination';
import { organizationLabels as labels } from '@/lib/organization-labels';
import { queryString, type SearchParams } from '@/lib/period';
export default async function CompaniesReport({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  if (!['ADMIN', 'GESTOR'].includes(user.role)) notFound();
  const params = await searchParams;
  const [data, options] = await Promise.all([
    companiesReport(user.id, params),
    analyticsOptions(user.id),
  ]);
  const values = Object.fromEntries(
    Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
  return (
    <>
      <Link href={`/gestor?${queryString(params)}`} className="back-link">
        ← Panorama
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">GESTÃO · LOCALIZAÇÕES</span>
          <h1>{labels.companies}</h1>
          <p>Volume, contexto e pendências. Selecione um local para detalhar.</p>
        </div>
        <PdfLink screen="filiais" params={params} />
      </div>
      <ManagementFilters options={options} values={values} />
      <section className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>{labels.company}</th>
              <th>Abertos no período</th>
              <th>Resolvidos no período</th>
              <th>Backlog atual</th>
              <th>Mediana resolução</th>
              <th>Mediana ativa de ciclo</th>
              <th>Categoria mais frequente</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link
                    className="text-link"
                    href={`/gestor/filiais/${c.id}?${queryString(params, { company: c.id, unit: '', pagina: '' })}`}
                  >
                    {c.name}
                  </Link>
                  {!c.active && <small>Inativa</small>}
                </td>
                <td>{c.opened}</td>
                <td>{c.resolved}</td>
                <td>{c.pending}</td>
                <td>{formatDuration(c.totalMedian)}</td>
                <td>{formatDuration(c.activeMedian)}</td>
                <td>{c.topCategory || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.rows.length && <p className="chart-empty">Nenhum local encontrado.</p>}
      </section>
      <Pagination path="/gestor/filiais" params={params} page={data.page} total={data.total} />
      <p className="report-caption">
        Tempos dos resolvidos no período. Backlog atual sem corte de abertura. Categoria mais
        frequente entre abertos no período; empate por nome.
      </p>
    </>
  );
}
