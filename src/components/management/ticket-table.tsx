import Link from 'next/link';
import { organizationLabels as labels } from '@/lib/organization-labels';
import { formatDate, ticketNumber, complexityLabels, statusLabels } from '@/lib/labels';
import { formatDuration, type MetricTicket } from '@/lib/analytics-service';
export function ManagementTicketTable({
  rows,
  canOpen,
  participation = false,
  dates = false,
}: {
  rows: MetricTicket[];
  canOpen: boolean;
  participation?: boolean;
  dates?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Chamado</th>
            <th>Equipe</th>
            <th>Solicitante / setor</th>
            <th>
              {labels.company} / {labels.unit}
            </th>
            <th>Categoria / complexidade</th>
            <th>Status</th>
            <th>Criado em</th>
            <th>{participation || dates ? 'Resolvido em' : 'Idade atual'}</th>
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
              <td>{t.team}</td>
              <td>
                <strong>{t.requester}</strong>
                <small>{t.department}</small>
              </td>
              <td>
                {t.company || labels.noCompany}
                <small>{t.unit || '—'}</small>
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
                {participation || dates
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
