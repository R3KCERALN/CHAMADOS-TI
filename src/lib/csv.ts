import type { ExportRow } from './analytics-service';
export function csvCell(value: unknown) {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[\s]*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export const csvHeader =
  [
    'Número',
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
