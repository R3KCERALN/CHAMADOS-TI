import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { OffTicketUseForm } from '@/components/stock/off-ticket-use-form';
export default async function OffTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const user = await requireUser();
  if (!['TI', 'ADMIN'].includes(user.role)) notFound();
  const item = await db.stockItem.findFirst({
    where: {
      id: (await searchParams).item || '',
      organizationId: user.organizationId,
      kind: 'MATERIAL',
      active: true,
    },
  });
  if (!item) notFound();
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Usar fora de chamado</h1>
          <p>{item.name}</p>
        </div>
        <Link href="/estoque?aba=materiais">Voltar ao estoque</Link>
      </div>
      <section className="panel padded">
        <OffTicketUseForm itemId={item.id} requestId={randomUUID()} />
      </section>
    </>
  );
}
