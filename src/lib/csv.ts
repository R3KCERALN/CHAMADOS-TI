import { formatDate, ticketNumber } from './labels';
import { movementLabels, unitLabels } from './stock-labels';
import { organizationLabels as labels } from './organization-labels';
import type { ExportRow } from './analytics-service';
export function csvCell(value: unknown) {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[\s]*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export const csvHeader =
  [
    'Número',
    'Equipe',
    labels.company,
    'CNPJ',
    labels.unit,
    'Registrado por',
    'Solicitante cadastrado',
    'Nome informado manualmente',
    'Solicitante',
    'Setor',
    'Responsável atual/final',
    'Categoria',
    'Complexidade',
    'Impacto',
    'Status',
    'Origem',
    'Criado em (UTC)',
    'Primeira resposta (UTC)',
    'Resolvido em (UTC)',
    'Tempo total (segundos)',
    'Tempo aguardando (segundos)',
    'Tempo ativo de ciclo (segundos)',
  ]
    .map(csvCell)
    .join(';') + '\r\n';
export function csvRow(row: ExportRow) {
  return (
    [
      row.number,
      row.team,
      row.company || labels.noCompany,
      row.cnpj,
      row.unit,
      row.openedBy,
      row.registeredRequester,
      row.manualRequester,
      row.requester,
      row.department,
      row.assignee,
      row.category || 'Sem categoria',
      row.complexity || 'Não classificada',
      row.impact,
      row.status,
      row.origin,
      row.createdAt,
      row.first_response,
      row.resolvedAt,
      row.total_seconds,
      row.waiting_seconds,
      row.active_seconds,
    ]
      .map(csvCell)
      .join(';') + '\r\n'
  );
}

export const stockCsvHeader =
  [
    'Data',
    'Tipo',
    'Item',
    'Equipe do item',
    'Unidade',
    'Quantidade',
    'Saldo após',
    'Quem fez',
    'Equipe de quem fez',
    'Chamado',
    'Equipe do chamado',
    'Estornado',
    'Conferência',
  ]
    .map(csvCell)
    .join(';') + '\r\n';
export function stockCsvRow(row: import('./stock-analytics').StockExportRow) {
  return (
    [
      formatDate(row.createdAt),
      movementLabels[row.type as keyof typeof movementLabels],
      row.name,
      row.teamName,
      row.unit ? unitLabels[row.unit as keyof typeof unitLabels] : '',
      row.quantity?.replace('.', ','),
      row.balanceAfter?.replace('.', ','),
      row.actorName,
      row.actorTeamName,
      row.ticketNumber ? ticketNumber(row.ticketNumber) : '',
      row.ticketTeamName,
      row.reversed ? 'Sim' : 'Não',
      row.state,
    ]
      .map(csvCell)
      .join(';') + '\r\n'
  );
}
