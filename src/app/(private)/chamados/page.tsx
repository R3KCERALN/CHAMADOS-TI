import { LiveUpdates } from '@/components/live-updates';
import { operationalRevision } from '@/lib/live-updates';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { listTickets } from '@/lib/services';
import { resetInvalidFilters } from '@/lib/invalid-filters';
import { InvalidFilterNotice } from '@/components/invalid-filter-notice';
import { TicketList } from '@/components/tickets';
import { Pagination } from '@/components/pagination';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { locationOptions } from '@/lib/organization-service';
import { LocationFilter } from '@/components/location-fields';
import { queryString, param, type SearchParams } from '@/lib/period';
import { complexityLabels, impactLabels } from '@/lib/labels';
import { teamOptions } from '@/lib/teams';
export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  if (user.role === 'GESTOR') redirect('/gestor');
  const revision = await operationalRevision(user.id);
  const params = await searchParams,
    employee = user.role === 'FUNCIONARIO';
  const filter = [
    'novos',
    'meus',
    'aguardando',
    'atendimento',
    'minha-espera',
    'resolvidos-hoje',
    'apoio',
  ].includes(param(params, 'filtro'))
    ? param(params, 'filtro')
    : 'todos';
  const fields = Object.fromEntries(
    [
      'companyId',
      'unitId',
      'categoryId',
      'departmentId',
      'impact',
      'complexity',
      'q',
      ...(user.role === 'ADMIN' ? ['teamId'] : []),
    ].map((k) => [k, param(params, k)]),
  );
  const { tickets, total, page } = await listTickets(
    user.id,
    filter,
    Number(params.pagina || 1),
    fields,
  ).catch((error) => resetInvalidFilters(error, params, '/chamados'));
  const options = employee
    ? null
    : await Promise.all([
        db.category.findMany({
          where: {
            organizationId: user.organizationId,
            ...(user.role === 'TI' && { teamId: user.teamId ?? '' }),
          },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
        db.department.findMany({
          where: { organizationId: user.organizationId },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
      ]);
  const companies = employee ? [] : await locationOptions(user.id, false);
  const teams = user.role === 'ADMIN' ? await teamOptions(db, user.organizationId) : [];
  const additionalFilterCount = Object.entries(fields).filter(
    ([key, current]) => key !== 'q' && Boolean(current),
  ).length;
  return (
    <>
      <LiveUpdates initialRevision={revision} />
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACOMPANHAMENTO</span>
          <h1>{employee ? 'Meus chamados' : 'Chamados'}</h1>
          <p>
            {employee
              ? 'Veja como está cada solicitação.'
              : 'Uma fila organizada, um próximo passo claro.'}
          </p>
        </div>
        <Link href={employee ? '/chamados/novo' : '/atendimento-rapido'} className="button primary">
          <Plus size={18} />
          {employee ? 'Abrir chamado' : 'Atendimento rápido'}
        </Link>
      </div>
      <InvalidFilterNotice aviso={params.aviso} />
      {!employee && (
        <>
          <nav className="tabs" aria-label="Filtrar chamados">
            {[
              ['todos', 'Todos'],
              ['novos', 'Novos na fila'],
              ['meus', 'Meus atendimentos'],
              ['aguardando', 'Aguardando'],
            ].map(([key, label]) => (
              <Link
                key={key}
                href={`/chamados?${queryString(params, { filtro: key, pagina: '' })}`}
                className={filter === key ? 'active' : ''}
                aria-current={filter === key ? 'page' : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <form className="panel queue-filters" method="get">
            <input type="hidden" name="filtro" value={filter} />
            <div className="field queue-search">
              <label htmlFor="q">Buscar chamado</label>
              <input
                id="q"
                name="q"
                type="search"
                maxLength={200}
                placeholder="Número, solicitante ou descrição"
                defaultValue={fields.q}
              />
            </div>
            <details className="queue-more-filters" open={additionalFilterCount > 0}>
              <summary>
                Mais filtros
                {additionalFilterCount > 0 && (
                  <span className="filter-count">{additionalFilterCount} ativos</span>
                )}
              </summary>
              <div className="filter-grid queue-more-content">
                {user.role === 'ADMIN' && (
                  <div className="field">
                    <label htmlFor="teamId">Equipe</label>
                    <select id="teamId" name="teamId" defaultValue={fields.teamId}>
                      <option value="">Todas</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <LocationFilter
                  companies={companies}
                  company={fields.companyId}
                  unit={fields.unitId}
                  companyName="companyId"
                  unitName="unitId"
                />
                <div className="field">
                  <label htmlFor="categoryId">Categoria</label>
                  <select id="categoryId" name="categoryId" defaultValue={fields.categoryId}>
                    <option value="">Todas</option>
                    <option value="none">Sem categoria</option>
                    {options![0].map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="departmentId">Setor</label>
                  <select id="departmentId" name="departmentId" defaultValue={fields.departmentId}>
                    <option value="">Todos</option>
                    {options![1].map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="impact">Impacto</label>
                  <select id="impact" name="impact" defaultValue={fields.impact}>
                    <option value="">Todos</option>
                    {Object.entries(impactLabels).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="complexity">Complexidade</label>
                  <select id="complexity" name="complexity" defaultValue={fields.complexity}>
                    <option value="">Todas</option>
                    <option value="none">Não classificada</option>
                    {Object.entries(complexityLabels).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </details>
            <div className="filter-actions">
              <Link className="text-link" href="/chamados">
                Limpar filtros
              </Link>
              <button className="button secondary">Filtrar fila</button>
            </div>
          </form>
        </>
      )}
      <section className="panel list-panel">
        <div className="section-heading">
          <h2>
            {total} {total === 1 ? 'chamado' : 'chamados'}
          </h2>
          <span className="muted small">
            {!employee && filter === 'novos' ? 'Mais antigos primeiro' : 'Mais recentes primeiro'}
          </span>
        </div>
        <TicketList tickets={tickets} employee={employee} />
      </section>
      <Pagination path="/chamados" params={params} page={page} total={total} />
    </>
  );
}
