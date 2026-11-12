import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { stockOverview } from '@/lib/stock-service';
import { teamOptions } from '@/lib/teams';
import { db } from '@/lib/db';
import { formatDate } from '@/lib/labels';
import { formatQuantity } from '@/lib/stock-labels';
import { ActionForm, Submit } from '@/components/form';
import { StockHidden } from '@/components/stock/fields';
import { stockAction } from '@/app/actions';
import { Pagination } from '@/components/pagination';
import type { SearchParams } from '@/lib/period';
export default async function StockPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  if (user.role === 'FUNCIONARIO') notFound();
  const params = await searchParams;
  const aba = params.aba === 'materiais' || params.aba === 'acabando' ? params.aba : 'ferramentas';
  const result = await stockOverview(user.id, {
    aba,
    team: typeof params.team === 'string' ? params.team : undefined,
    q: typeof params.q === 'string' ? params.q : undefined,
    page: Number(params.pagina) || 1,
  });
  const teams = await teamOptions(db, user.organizationId);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">FERRAMENTAS E MATERIAIS</span>
          <h1>Estoque</h1>
          <p>Veja o que está guardado, em uso e precisando de reposição.</p>
        </div>
        <div className="stock-links">
          {result.keeper && (
            <Link className="button primary" href="/estoque/itens/novo">
              Novo item
            </Link>
          )}
          {['ADMIN', 'GESTOR'].includes(user.role) && (
            <>
              <Link href="/estoque/autorizacoes">Conferir autorizações</Link>
              <Link href="/gestor/estoque">Relatórios de estoque</Link>
            </>
          )}
        </div>
      </div>
      <nav className="admin-section-nav" aria-label="Tipos de estoque">
        {(['ferramentas', 'materiais', 'acabando'] as const).map((a) => (
          <Link
            key={a}
            className={aba === a ? 'active' : ''}
            aria-current={aba === a ? 'page' : undefined}
            href={`?aba=${a}`}
          >
            {a === 'ferramentas' ? 'Ferramentas' : a === 'materiais' ? 'Materiais' : 'Acabando'} (
            {result.counts[a]})
          </Link>
        ))}
      </nav>
      <form className="filters">
        <input type="hidden" name="aba" value={aba} />
        <label>
          Equipe
          <select name="team" defaultValue={String(params.team || '')}>
            <option value="">Todas</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Buscar item
          <input name="q" defaultValue={String(params.q || '')} maxLength={100} />
        </label>
        <button className="button secondary">Buscar</button>
      </form>
      <div className="stock-grid">
        {result.items.map((i) => (
          <article className="panel padded" key={i.id}>
            <span className="eyebrow">{i.team.name}</span>
            <h2>
              <Link href={`/estoque/itens/${i.id}`}>{i.name}</Link>
            </h2>
            {i.kind === 'FERRAMENTA' ? (
              <>
                <p>
                  {i.holder ? `Com ${i.holder.name} desde ${formatDate(i.heldSince!)}` : 'Guardada'}
                </p>
                {result.canOperate && (!i.holder || i.holder.id === user.id || result.keeper) && (
                  <ActionForm action={stockAction}>
                    <StockHidden intent={i.holder ? 'devolver' : 'pegar'} itemId={i.id} />
                    <Submit>{i.holder ? 'Devolvi' : 'Peguei'}</Submit>
                  </ActionForm>
                )}
              </>
            ) : (
              <>
                <p className="stock-balance">{formatQuantity(i.balance, i.unit)}</p>
                <p>
                  Mínimo: {i.minimum === null ? 'Não definido' : formatQuantity(i.minimum, i.unit)}
                </p>
                {i.needsCount && <p className="notice">Conferir saldo</p>}
                {i.alerts.length > 0 && <p className="notice">Acabando</p>}
                {result.canOperate && (
                  <Link className="button secondary" href={`/estoque/uso-avulso?item=${i.id}`}>
                    Usar fora de chamado
                  </Link>
                )}
                {i.alerts.map((a) => (
                  <div key={a.id}>
                    {a.requestedBy ? (
                      <p>
                        Pedido feito por {a.requestedBy.name} em {formatDate(a.requestedAt!)}
                      </p>
                    ) : (
                      <ActionForm action={stockAction}>
                        <StockHidden intent="pedido-feito" />
                        <input type="hidden" name="alertId" value={a.id} />
                        <Submit>Pedido já feito ao financeiro</Submit>
                      </ActionForm>
                    )}
                  </div>
                ))}
              </>
            )}
          </article>
        ))}
      </div>
      {!result.items.length && <p>Nenhum item encontrado.</p>}
      <Pagination page={result.page} total={result.total} path="/estoque" params={params} />
    </>
  );
}
