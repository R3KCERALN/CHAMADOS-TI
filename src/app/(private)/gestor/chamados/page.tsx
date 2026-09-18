import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { analyticsOptions, managementTickets } from '@/lib/analytics-service';
import { ManagementFilters } from '@/components/management/filters';
import { ManagementTicketTable } from '@/components/management/ticket-table';
import { Pagination } from '@/components/pagination';
import { queryString, type SearchParams } from '@/lib/period';
export default async function ReportTickets({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  if (!['ADMIN', 'GESTOR'].includes(user.role)) notFound();
  const params = await searchParams;
  const [data, options] = await Promise.all([
    managementTickets(user.id, params),
    analyticsOptions(user.id),
  ]);
  const values = Object.fromEntries(
    Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
  return (
    <>
      <Link
        className="back-link"
        href={`/gestor/filiais${values.company ? '/' + values.company : ''}?${queryString(params, { pagina: '', carteira: '' })}`}
      >
        ← Localizações
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">GESTÃO · CONSULTA</span>
          <h1>{values.carteira === 'pendentes' ? 'Pendências atuais' : 'Chamados do período'}</h1>
          <p>
            {values.carteira === 'pendentes'
              ? 'Todos os pendentes, sem limite de data de abertura.'
              : 'Abertos ou resolvidos no período, uma linha por chamado.'}
          </p>
        </div>
        <a className="button secondary" href={`/gestor/exportar?${queryString(params)}`}>
          Exportar período CSV
        </a>
      </div>
      <ManagementFilters options={options} values={values} />
      <section className="panel">
        <ManagementTicketTable rows={data.tickets} canOpen={user.role === 'ADMIN'} dates />
      </section>
      <Pagination path="/gestor/chamados" params={params} page={data.page} total={data.total} />
    </>
  );
}
