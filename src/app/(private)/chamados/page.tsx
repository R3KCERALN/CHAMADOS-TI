import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { listTickets } from '@/lib/services';
import { TicketList } from '@/components/tickets';
import { redirect } from 'next/navigation';
export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string; pagina?: string }>;
}) {
  const user = await requireUser();
  if (user.role === 'GESTOR') redirect('/gestor');
  const params = await searchParams;
  const employee = user.role === 'FUNCIONARIO';
  const filter = ['novos', 'meus', 'aguardando'].includes(params.filtro || '')
    ? params.filtro!
    : 'todos';
  const { tickets, total, page } = await listTickets(user.id, filter, Number(params.pagina || 1));
  return (
    <>
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
      {!employee && (
        <nav className="tabs" aria-label="Filtrar chamados">
          {[
            ['todos', 'Todos'],
            ['novos', 'Novos na fila'],
            ['meus', 'Meus atendimentos'],
            ['aguardando', 'Aguardando'],
          ].map(([key, label]) => (
            <Link
              key={key}
              href={`/chamados?filtro=${key}`}
              className={filter === key ? 'active' : ''}
              aria-current={filter === key ? 'page' : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
      <section className="panel list-panel">
        <div className="section-heading">
          <h2>
            {total} {total === 1 ? 'chamado' : 'chamados'}
          </h2>
          <span className="muted small">Mais recentes primeiro</span>
        </div>
        <TicketList tickets={tickets} employee={employee} />
      </section>
      <nav className="pagination" aria-label="Paginação">
        {page > 1 && (
          <Link className="button secondary" href={`/chamados?filtro=${filter}&pagina=${page - 1}`}>
            Anterior
          </Link>
        )}
        <span>Página {page}</span>
        {page * 20 < total && (
          <Link className="button secondary" href={`/chamados?filtro=${filter}&pagina=${page + 1}`}>
            Próxima
          </Link>
        )}
      </nav>
    </>
  );
}
