import type {
  Prisma,
  StockItemKind,
  StockMovementType,
  StockUnit,
} from '@/generated/prisma/client';
export const unitLabels: Record<StockUnit, string> = {
  UNIDADE: 'unidade',
  METRO: 'metro',
  ROLO: 'rolo',
  CAIXA: 'caixa',
  PACOTE: 'pacote',
};
export const kindLabels: Record<StockItemKind, string> = {
  FERRAMENTA: 'Ferramenta',
  MATERIAL: 'Material',
};
export const movementLabels: Record<StockMovementType, string> = {
  ENTRADA: 'Entrada',
  USO_CHAMADO: 'Uso em chamado',
  USO_AVULSO: 'Uso fora de chamado',
  AJUSTE: 'Ajuste de contagem',
  ESTORNO: 'Estorno',
  RETIRADA: 'Peguei',
  DEVOLUCAO: 'Devolvi',
};
// String-only so client components can use it without the Prisma runtime.
export function formatQuantity(value: Prisma.Decimal | string, unit?: StockUnit | null): string {
  let text = String(value);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  if (text === '-0') text = '0';
  text = text.replace('.', ',');
  return unit ? `${text} ${unitLabels[unit]}` : text;
}
