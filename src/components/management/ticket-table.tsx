import Link from 'next/link';
import { formatDate, ticketNumber, complexityLabels, statusLabels } from '@/lib/labels';
import { formatDuration, type MetricTicket } from '@/lib/analytics-service';
export function ManagementTicketTable({
  rows,
  canOpen,
  participation = false,
}: {
  rows: MetricTicket[];
  canOpen: boolean;
  participation?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Chamado</th>
            <th>Solicitante / setor</th>
            <th>Categoria / complexidade</th>
            <th>Status</th>
            <th>Criado em</th>
            <th>{participation ? 'Resolvido em' : 'Idade atual'}</th>
            {participation && <th>Participação no período</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>
                {canOpen ? (
                  <Link className="text-link" href={`/chamados/${t.id}`}>
                    {ticketNumber(t.number)}
                  </Link>
                ) : (
                  ticketNumber(t.number)
                )}
              </td>
              <td>
                <strong>{t.requester}</strong>
                <small>{t.department}</small>
              </td>
              <td>
                {t.category || 'Sem categoria'}
                <small>
                  {t.complexity
                    ? complexityLabels[t.complexity as keyof typeof complexityLabels]
                    : 'Não classificada'}
                </small>
              </td>
              <td>{statusLabels[t.status as keyof typeof statusLabels]}</td>
              <td>{formatDate(new Date(t.createdAt))}</td>
              <td>
                {participation
                  ? t.resolvedAt
                    ? formatDate(new Date(t.resolvedAt))
                    : '—'
                  : formatDuration(t.age)}
              </td>
              {participation && (
                <td>
                  {t.principal ? 'Responsável' : ''}
                  {t.principal && t.support ? ' e ' : ''}
                  {t.support ? 'Apoio' : ''}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="chart-empty">Nenhum chamado encontrado.</p>}
    </div>
  );
}
