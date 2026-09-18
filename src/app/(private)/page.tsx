import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, ArrowUpRight, Inbox, Headphones, Clock3, MoveRight } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { listTickets } from '@/lib/services';
import { TicketList } from '@/components/tickets';
export default async function HomePage() {
  const user = await requireUser();
  if (user.role === 'GESTOR') redirect('/gestor');
  const employee = user.role === 'FUNCIONARIO';
  const { tickets } = await listTickets(user.id, employee ? 'todos' : 'meus');
  const counts = employee
    ? null
    : await Promise.all([
        db.ticket.count({ where: { status: 'NOVO' } }),
        db.ticket.count({
          where: {
            status: { not: 'RESOLVIDO' },
            OR: [{ assigneeId: user.id }, { participants: { some: { userId: user.id } } }],
          },
        }),
        db.ticket.count({ where: { status: 'AGUARDANDO' } }),
      ]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {employee ? 'SEU PONTO DE APOIO' : 'CENTRAL DE OPERAÇÕES'}
          </span>
          <h1>
            Olá, {user.name.split(' ')[0]}
            <span className="green-dot">.</span>
          </h1>
          <p>
            {employee
              ? 'Vamos deixar seu dia mais simples.'
              : 'Vamos fazer o trabalho seguir em frente.'}
          </p>
        </div>
        <span className="today">
          {new Intl.DateTimeFormat('pt-BR', {
            day: 'numeric',
            month: 'long',
            timeZone: 'America/Sao_Paulo',
          }).format(new Date())}
        </span>
      </div>
      <section className={`hero ${employee ? 'employee-hero' : ''}`}>
        <div>
          <span className="eyebrow light">
            {employee ? 'ESTAMOS AQUI PARA AJUDAR' : 'DA CONVERSA PARA O REGISTRO'}
          </span>
          <h2>{employee ? 'Precisa de ajuda?' : 'O atendimento já começou?'}</h2>
          <p>
            {employee
              ? 'Conte o que aconteceu. O TI cuida do próximo passo.'
              : 'Registre aquela ajuda por telefone, mensagem ou no corredor. Em poucos segundos.'}
          </p>
          <Link href={employee ? '/chamados/novo' : '/atendimento-rapido'} className="button white">
            <Plus size={20} />
            {employee ? 'Abrir chamado' : 'Atendimento rápido'}
            <ArrowUpRight size={18} />
          </Link>
        </div>
        <div className="hero-art" aria-hidden="true">
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
          <span className="hero-symbol">
            <Headphones size={64} strokeWidth={1.2} />
          </span>
          <span className="hero-bubble">Pode contar com a gente.</span>
        </div>
      </section>
      {counts && (
        <section className="stats" aria-label="Resumo dos atendimentos">
          {[
            {
              label: 'Novos na fila',
              count: counts[0],
              href: '/chamados?filtro=novos',
              icon: Inbox,
              text: 'Prontos para começar',
              color: 'blue',
            },
            {
              label: 'Meus atendimentos',
              count: counts[1],
              href: '/chamados?filtro=meus',
              icon: Headphones,
              text: 'Responsável ou apoio',
              color: 'green',
            },
            {
              label: 'Aguardando',
              count: counts[2],
              href: '/chamados?filtro=aguardando',
              icon: Clock3,
              text: 'Acompanhe o próximo passo',
              color: 'amber',
            },
          ].map((item) => (
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
          ))}
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
