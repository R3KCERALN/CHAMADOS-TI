import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { authorizationList, type ReviewState } from '@/lib/stock-review';
import { ActionForm, Submit } from '@/components/form';
import { stockAction } from '@/app/actions';
import { formatDate } from '@/lib/labels';
import { formatQuantity } from '@/lib/stock-labels';
import type { SearchParams } from '@/lib/period';
export default async function AuthorizationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  if (!['GESTOR', 'ADMIN'].includes(user.role)) notFound();
  const params = await searchParams;
  const state =
    typeof params.estado === 'string' &&
    ['PENDENTE', 'CONFERIDA', 'QUESTIONADA', 'ENCERRADA'].includes(params.estado)
      ? (params.estado as ReviewState)
      : undefined;
  const result = await authorizationList(user.id, { state, page: Number(params.pagina) || 1 });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ESTOQUE</span>
          <h1>Autorizações de uso</h1>
          <p>Confira os usos de material fora de chamado.</p>
        </div>
        <Link href="/estoque">Voltar ao estoque</Link>
      </div>
      <form className="filters">
        <label>
          Estado
          <select name="estado" defaultValue={state || ''}>
            <option value="">Todos</option>
            {['PENDENTE', 'CONFERIDA', 'QUESTIONADA', 'ENCERRADA'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button className="button secondary">Filtrar</button>
      </form>
      {result.rows.map((m) => (
        <section className="panel padded" key={m.id}>
          <h2>{m.item.name}</h2>
          <p>
            {formatQuantity(m.quantity!, m.item.unit)} · {m.actor.name} · {formatDate(m.createdAt)}
          </p>
          <p>{m.note}</p>
          <p>Estado: {m.state}</p>
          {m.hasPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="stock-authorization-photo"
              src={`/api/estoque/fotos/${m.id}`}
              alt={`Autorização de uso de ${m.item.name}`}
            />
          ) : (
            <p>foto removida após o prazo de guarda</p>
          )}
          {m.reviews.map((r) => (
            <p key={r.id}>
              {r.outcome} · {r.actor.name} · {formatDate(r.createdAt)} · {r.note}
            </p>
          ))}
          {['PENDENTE', 'QUESTIONADA'].includes(m.state) && (
            <ActionForm action={stockAction}>
              <input type="hidden" name="intent" value="conferir" />
              <input type="hidden" name="movementId" value={m.id} />
              <label>
                Conferência
                <select name="outcome">
                  {m.state === 'QUESTIONADA' ? (
                    <option value="ENCERRADA">Encerrar questão</option>
                  ) : (
                    <>
                      <option value="CONFERIDA">Conferida</option>
                      <option value="QUESTIONADA">Questionada</option>
                    </>
                  )}
                </select>
              </label>
              <label>
                Observação
                <textarea name="note" maxLength={1000} required={m.state === 'QUESTIONADA'} />
              </label>
              <Submit>Registrar conferência</Submit>
            </ActionForm>
          )}
        </section>
      ))}
      {!result.rows.length && <p>Nenhuma autorização encontrada.</p>}
      <nav className="pagination" aria-label="Paginação das autorizações">
        {result.page > 1 && (
          <Link href={`?estado=${state || ''}&pagina=${result.page - 1}`}>Anterior</Link>
        )}
        <span>Página {result.page}</span>
        {result.hasNext && (
          <Link href={`?estado=${state || ''}&pagina=${result.page + 1}`}>Próxima</Link>
        )}
      </nav>
    </>
  );
}
