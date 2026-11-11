import { randomUUID } from 'node:crypto';
import { ticketMaterials } from '@/lib/stock-service';
import { AppError } from '@/lib/errors';
import { formatDate } from '@/lib/labels';
import { formatQuantity } from '@/lib/stock-labels';
import { ActionForm, Submit } from '@/components/form';
import { stockAction } from '@/app/actions';
export async function TicketMaterials({ actorId, ticketId }: { actorId: string; ticketId: string }) {
  let result: Awaited<ReturnType<typeof ticketMaterials>>;
  try { result = await ticketMaterials(actorId, ticketId); }
  catch (e) { if (e instanceof AppError && [403,404].includes(e.status)) return null; throw e; }
  return <section className="panel padded" aria-labelledby="ticket-materials"><h2 id="ticket-materials">Materiais usados</h2>
    {result.movements.map((m) => <p key={m.id}>{m.reversed ? <s>{m.item.name} · {formatQuantity(m.quantity!, m.item.unit)}</s> : <>{m.item.name} · {formatQuantity(m.quantity!, m.item.unit)}</>} · {m.actor.name} · {formatDate(m.createdAt)}{m.reversed && ' · Estornado'}</p>)}
    {!result.movements.length && <p>Nenhum material registrado.</p>}
    {result.canRecord && <ActionForm action={stockAction}><input type="hidden" name="intent" value="uso-chamado"/><input type="hidden" name="ticketId" value={ticketId}/><input type="hidden" name="requestId" value={randomUUID()}/>
      <label>Material<select name="itemId" required defaultValue=""><option value="" disabled>Selecione o material</option>{result.materials.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.teamName}</option>)}</select></label>
      <label>Quantidade<input name="quantity" inputMode="decimal" required/></label><Submit>Registrar material</Submit>
    </ActionForm>}
  </section>;
}
