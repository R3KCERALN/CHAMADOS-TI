import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { stockItemDetail } from '@/lib/stock-service';
import { AppError } from '@/lib/errors';
import { db } from '@/lib/db';
import { teamOptions } from '@/lib/teams';
import { formatDate } from '@/lib/labels';
import { formatQuantity, movementLabels } from '@/lib/stock-labels';
import { ActionForm, Submit } from '@/components/form';
import { StockHidden, ItemFields } from '@/components/stock/fields';
import { stockAction } from '@/app/actions';
import { Pagination } from '@/components/pagination';
import type { SearchParams } from '@/lib/period';
export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const search = await searchParams;
  const detail = await stockItemDetail(user.id, id, Number(search.pagina) || 1).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const { item, keeper } = detail;
  const teams = keeper ? await teamOptions(db, user.organizationId) : [];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{item.team.name}</span>
          <h1>{item.name}</h1>
          <p>
            {item.kind === 'MATERIAL'
              ? formatQuantity(item.balance, item.unit)
              : item.holder
                ? `Com ${item.holder.name} desde ${formatDate(item.heldSince!)}`
                : 'Guardada'}
            {!item.active && ' · Desativado'}
          </p>
          {item.needsCount && <p>Conferir saldo</p>}
          {detail.alert && <p>Acabando</p>}
        </div>
        <Link href="/estoque">Voltar ao estoque</Link>
      </div>
      {keeper && item.active && (
        <div className="stock-grid">
          {item.kind === 'MATERIAL' && (
            <>
              <section className="panel padded">
                <h2>Entrada</h2>
                <ActionForm action={stockAction}>
                  <StockHidden intent="entrada" itemId={id} />
                  <label>
                    Quantidade
                    <input name="quantity" inputMode="decimal" required />
                  </label>
                  <label>
                    Observação
                    <textarea name="note" maxLength={500} />
                  </label>
                  <Submit>Registrar entrada</Submit>
                </ActionForm>
              </section>
              <section className="panel padded">
                <h2>Ajuste</h2>
                <ActionForm action={stockAction}>
                  <StockHidden intent="ajuste" itemId={id} />
                  <label>
                    Quantidade contada
                    <input name="counted" inputMode="decimal" required />
                  </label>
                  <label>
                    Motivo
                    <textarea name="reason" minLength={3} maxLength={500} required />
                  </label>
                  <Submit>Ajustar contagem</Submit>
                </ActionForm>
              </section>
            </>
          )}
          <section className="panel padded">
            <h2>Editar cadastro</h2>
            <ActionForm action={stockAction}>
              <StockHidden intent="editar" itemId={id} />
              <ItemFields teams={teams} item={item} />
              <Submit>Salvar cadastro</Submit>
            </ActionForm>
          </section>
          <section className="panel padded">
            <h2>Desativar item</h2>
            <ActionForm action={stockAction}>
              <StockHidden intent="desativar" itemId={id} />
              <label>
                Motivo
                <textarea name="reason" minLength={3} maxLength={500} required />
              </label>
              <Submit>Desativar</Submit>
            </ActionForm>
          </section>
        </div>
      )}
      <h2>Histórico</h2>
      {detail.movements.map((m) => (
        <article className="panel padded" key={m.id}>
          <h3>
            {movementLabels[m.type]}
            {m.reversed && ' · Estornado'}
          </h3>
          <p>
            {formatDate(m.createdAt)} · {m.actor.name}
            {m.targetUser && ` · de ${m.targetUser.name}`}
          </p>
          {m.quantity !== null && (
            <p>
              {formatQuantity(m.quantity, item.unit)} · Saldo após:{' '}
              {formatQuantity(m.balanceAfter!, item.unit)}
            </p>
          )}
          <p>{m.reason || m.note}</p>
          {m.canReverse && (
            <ActionForm action={stockAction}>
              <StockHidden intent="estornar" itemId={id} />
              <input type="hidden" name="movementId" value={m.id} />
              <label>
                Motivo do estorno
                <textarea name="reason" required minLength={3} maxLength={500} />
              </label>
              <Submit>Estornar</Submit>
            </ActionForm>
          )}
        </article>
      ))}
      <Pagination
        page={detail.page}
        total={detail.total}
        size={30}
        path={`/estoque/itens/${id}`}
        params={search}
      />
    </>
  );
}
