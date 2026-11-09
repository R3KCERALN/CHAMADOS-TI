import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { analyticsOptions, overview } from '@/lib/analytics-service';
import { ManagementFilters } from '@/components/management/filters';
import { MetricCard, TimeCard } from '@/components/management/summary';
import { Bars } from '@/components/management/charts';
import { organizationLabels as labels } from '@/lib/organization-labels';
import { complexityLabels } from '@/lib/labels';
import { queryString, type SearchParams } from '@/lib/period';
import { resetInvalidFilters } from '@/lib/invalid-filters';
import { InvalidFilterNotice } from '@/components/invalid-filter-notice';
export default async function CompanyDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  if (!['ADMIN', 'GESTOR'].includes(user.role)) notFound();
  const { id } = await params;
  const company =
    id === 'none'
      ? null
      : await db.company.findFirst({
          where: { id, organizationId: user.organizationId },
          include: { units: true },
        });
  if (id !== 'none' && !company) notFound();
  const query = await searchParams;
  const search = { ...query, company: id };
  const [data, options] = await Promise.all([
    overview(user.id, search),
    analyticsOptions(user.id),
  ]).catch((error) => resetInvalidFilters(error, query, `/gestor/filiais/${id}`));
  const values = Object.fromEntries(
    Object.entries(search).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
  return (
    <>
      <Link
        className="back-link"
        href={`/gestor/filiais?${queryString(search, { company: '', unit: '', pagina: '' })}`}
      >
        ← {labels.companies}
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">GESTÃO · {labels.company.toUpperCase()}</span>
          <h1>{company?.displayName || labels.noCompany}</h1>
          <p>{company?.legalName || 'Demanda e ciclo operacional deste local.'}</p>
        </div>
        <Link
          className="button primary"
          href={`/gestor/chamados?${queryString(search, { pagina: '' })}`}
        >
          Consultar chamados
        </Link>
      </div>
      <InvalidFilterNotice aviso={query.aviso} />
      <ManagementFilters options={options} values={values} lockedCompany={id} />
      <section className="metric-grid">
        <MetricCard
          label="Abertos no período"
          value={data.summary.opened}
          hint="Data de criação no intervalo."
        />
        <MetricCard
          label="Resolvidos no período"
          value={data.summary.resolved}
          hint="Inclui chamados abertos antes do intervalo."
        />
        <MetricCard
          label="Backlog atual"
          value={
            <Link
              href={`/gestor/chamados?${queryString(search, { carteira: 'pendentes', pagina: '' })}`}
            >
              {data.summary.pending}
            </Link>
          }
          hint="Clique para consultar pendências de qualquer idade."
        />
      </section>
      <section className="metric-grid time-grid">
        <TimeCard
          label="Mediana resolução"
          stats={data.summary.total}
          hint="Ciclo completo dos resolvidos no período."
        />
        <TimeCard
          label="Mediana ativa de ciclo"
          stats={data.summary.active}
          hint="Exclui fila e espera; não são horas trabalhadas."
        />
      </section>
      <div className="analytics-grid">
        <Bars
          title="Categorias"
          subtitle={`Mais frequente: ${data.categories[0]?.name || '—'}. Clique para consultar.`}
          rows={data.categories}
          links={Object.fromEntries(
            data.categories.map((c) => [
              c.id!,
              `/gestor/chamados?${queryString(search, { category: c.id!, pagina: '' })}`,
            ]),
          )}
        />
        <Bars
          title="Complexidade"
          subtitle="Classificação atual dos abertos no período."
          rows={data.complexities.map((r) => ({
            ...r,
            name: complexityLabels[r.name as keyof typeof complexityLabels] || r.name,
          }))}
        />
        {!!company?.units.length && (
          <Bars
            title={labels.units}
            subtitle="Selecione para filtrar este local e suas categorias."
            rows={data.units}
            links={Object.fromEntries(
              data.units.map((u) => [
                u.id!,
                `/gestor/filiais/${id}?${queryString(search, { unit: u.id!, pagina: '' })}`,
              ]),
            )}
          />
        )}
      </div>
    </>
  );
}
