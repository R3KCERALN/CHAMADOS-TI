import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { stockActor } from '@/lib/stock-access';
import { db } from '@/lib/db';
import { teamOptions } from '@/lib/teams';
import { ActionForm, Submit } from '@/components/form';
import { StockHidden, ItemFields } from '@/components/stock/fields';
import { stockAction } from '@/app/actions';
export default async function NewStockItem() {
  const user = await requireUser();
  if (user.role !== 'ADMIN' && !(user.role === 'TI' && user.stockKeeper)) notFound();
  await stockActor(db, user.id, 'keep');
  const teams = await teamOptions(db, user.organizationId);
  return <><div className="page-heading"><h1>Novo item</h1><Link href="/estoque">Voltar ao estoque</Link></div><section className="panel padded"><ActionForm action={stockAction}>
    <StockHidden intent="criar"/><label>Tipo<select name="kind"><option value="FERRAMENTA">Ferramenta</option><option value="MATERIAL">Material</option></select></label><ItemFields teams={teams}/><label>Quantidade inicial (material)<input name="initialQuantity" inputMode="decimal"/></label><Submit>Criar item</Submit>
  </ActionForm></section></>;
}
