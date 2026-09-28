import { LiveUpdates } from '@/components/live-updates';
import { operationalRevision } from '@/lib/live-updates';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, ArrowUpRight, Inbox, Headphones, Clock3, MoveRight } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { APP_TIMEZONE } from '@/lib/config';
import { resolvePeriod } from '@/lib/period';
import { listTickets } from '@/lib/services';
import { TicketList } from '@/components/tickets';
export default async function HomePage() {
  const user = await requireUser();
  if (user.role === 'GESTOR') redirect('/gestor');
  const revision = await operationalRevision(user.id);
  const employee = user.role === 'FUNCIONARIO';
  const { tickets } = await listTickets(user.id, employee ? 'todos' : 'meus');
  const today = resolvePeriod({ periodo: 'hoje' });
  const counts = employee
    ? null
    : await Promise.all([
        db.ticket.count({ where: { organizationId: user.organizationId, status: 'NOVO' } }),
        db.ticket.count({
          where: {
            organizationId: user.organizationId,
            assigneeId: user.id,
            status: 'EM_ATENDIMENTO',
          },
        }),
        db.ticket.count({
          where: { organizationId: user.organizationId, assigneeId: user.id, status: 'AGUARDANDO' },
        }),
        db.ticket.count({
          where: {
            organizationId: user.organizationId,
            assigneeId: user.id,
            status: 'RESOLVIDO',
            resolvedAt: { gte: today.start, lt: today.end },
          },
        }),
        db.ticket.count({
          where: {
            organizationId: user.organizationId,
            status: { not: 'RESOLVIDO' },
            participants: { some: { userId: user.id } },
          },
        }),
      ]);
  const operationalItems = counts
    ? [
        {
          label: 'Novos na fila',
          count: counts[0],
          href: '/chamados?filtro=novos',
          icon: Inbox,
          text: 'Prontos para começar',
          color: 'blue',
        },
        {
          label: 'Meus em atendimento',
          count: counts[1],
          href: '/chamados?filtro=atendimento',
          icon: Headphones,
          text: 'Responsável principal',
          color: 'green',
        },
        {
          label: 'Meus aguardando',
          count: counts[2],
          href: '/chamados?filtro=minha-espera',
          icon: Clock3,
          text: 'Acompanhe o próximo passo',
          color: 'amber',
        },
        {
          label: 'Resolvidos hoje',
          count: counts[3],
          href: '/chamados?filtro=resolvidos-hoje',
          icon: Headphones,
          text: 'Como responsável final',
          color: 'green',
        },
        {
          label: 'Estou como apoio',
          count: counts[4],
          href: '/chamados?filtro=apoio',
          icon: Headphones,
          text: 'Chamados ainda abertos',
          color: 'blue',
        },
      ]
    : [];
  const operationalCards = (items: typeof operationalItems) =>
    items.map((item) => (
      <Link key={item.label} href={item.href} className="stat-card">
        <div className="stat-top">
          <span>{item.label}</span>
          <span className={`stat-icon ${item.color}`}>
            <item.icon size={19} />
          </span>
        </div>
        <strong>{String(item.count).padStart(2, '0')}</strong>
        <div className="stat-bottom">
          <span>{item.text}</span>
          <MoveRight size={17} />
        </div>
      </Link>
    ));
  return (
    <>
      <LiveUpdates initialRevision={revision} />
      <div className="page-heading">
        <div>
          <h1>
            Olá, {user.name.split(' ')[0]}
            <span className="green-dot">.</span>
          </h1>
        </div>
        <span className="today">
          {new Intl.DateTimeFormat('pt-BR', {
            day: 'numeric',
            month: 'long',
            timeZone: APP_TIMEZONE,
          }).format(new Date())}
        </span>
      </div>
      <section className={`hero simple-hero ${employee ? 'employee-hero' : 'tech-hero'}`}>
        <div>
          <h2>{employee ? 'Precisa de ajuda?' : 'Registre um atendimento'}</h2>
          <p>
            {employee
              ? 'Descreva o problema para abrir um chamado.'
              : 'Para atendimentos presenciais, por telefone ou mensagem.'}
          </p>
          <Link href={employee ? '/chamados/novo' : '/atendimento-rapido'} className="button white">
            <Plus size={20} />
            {employee ? 'Abrir chamado' : 'Atendimento rápido'}
            <ArrowUpRight size={18} />
          </Link>
        </div>
      </section>
      {counts && (
        <section
          className="stats operational-stats primary-operational-stats"
          aria-label="Prioridades do atendimento"
        >
          {operationalCards(operationalItems.slice(0, 2))}
        </section>
      )}
      <section className="panel list-panel">
        <div className="section-heading">
          <div>
            <h2>{employee ? 'Meus chamados' : 'Na sua mesa'}</h2>
            <p>
              {employee
                ? 'Cada etapa do seu atendimento, em um só lugar.'
                : 'Os chamados em que você participa.'}
            </p>
          </div>
          <Link className="text-link" href={employee ? '/chamados' : '/chamados?filtro=meus'}>
            Ver todos <ArrowUpRight size={16} />
          </Link>
        </div>
        <TicketList tickets={tickets.slice(0, 5)} employee={employee} />
      </section>
      {counts && (
        <section
          className="stats operational-stats secondary-operational-stats"
          aria-label="Outros indicadores operacionais"
        >
          {operationalCards(operationalItems.slice(2))}
        </section>
      )}
      {user.role === 'ADMIN' && (
        <Link href="/admin/usuarios" className="admin-shortcut">
          <span>
            <strong>Administração de acessos</strong>
            <small>Cadastre pessoas e mantenha os acessos atualizados.</small>
          </span>
          <ArrowUpRight size={22} />
        </Link>
      )}
    </>
  );
}
