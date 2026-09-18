import Link from 'next/link';
import { organizationLabels as labels } from '@/lib/organization-labels';
import { ArrowUpRight, Inbox, ChevronRight } from 'lucide-react';
import { formatDate, statusLabels, ticketNumber } from '@/lib/labels';
import type { TicketStatus, Impact } from '@/generated/prisma/client';
export function Status({ status }: { status: TicketStatus }) {
  return (
    <span className={`status status-${status}`}>
      <span />
      {statusLabels[status]}
    </span>
  );
}
type TicketSummary = {
  id: string;
  number: number;
  description: string;
  impact: Impact;
  status: TicketStatus;
  createdAt: Date;
  requester: { name: string } | null;
  requesterName: string;
  company?: { displayName: string } | null;
  unit?: { name: string } | null;
  department: { name: string } | null;
  assignee: { name: string } | null;
};
export function TicketList({
  tickets,
  employee = false,
}: {
  tickets: TicketSummary[];
  employee?: boolean;
}) {
  if (!tickets.length)
    return (
      <div className="empty">
        <span className="empty-icon">
          <Inbox size={28} />
        </span>
        <h3>Tudo em dia por aqui</h3>
        <p>Nenhum chamado nesta visualização.</p>
        {employee && (
          <Link href="/chamados/novo" className="text-link">
            Precisa de ajuda? Abra um chamado <ArrowUpRight size={16} />
          </Link>
        )}
      </div>
    );
  return (
    <div className="ticket-list">
      {tickets.map((ticket) => (
        <Link className="ticket-row" href={`/chamados/${ticket.id}`} key={ticket.id}>
          <span className={`impact-bar impact-${ticket.impact}`} />
          <div className="ticket-main">
            <div className="ticket-eyebrow">
              <span>{ticketNumber(ticket.number)}</span>
              <span>{ticket.department?.name || 'Sem setor'}</span>
              {ticket.impact === 'BLOQUEADO' && (
                <span className="blocked-label">Trabalho bloqueado</span>
              )}
            </div>
            <div className="location-badge">
              {ticket.company?.displayName || labels.noCompany}
              {ticket.unit && ` · ${ticket.unit.name}`}
            </div>
            <h3>{ticket.description}</h3>
            <p>
              {employee
                ? ticket.assignee
                  ? `Com ${ticket.assignee.name}`
                  : 'Aguardando um técnico'
                : ticket.requesterName}{' '}
              <span>·</span> {formatDate(ticket.createdAt)}
            </p>
          </div>
          <Status status={ticket.status} />
          <ChevronRight size={18} className="row-chevron" />
        </Link>
      ))}
    </div>
  );
}
