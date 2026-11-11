import { randomUUID } from 'node:crypto';
import { unitLabels } from '@/lib/stock-labels';
export function StockHidden({ intent, itemId }: { intent: string; itemId?: string }) {
  return <><input type="hidden" name="intent" value={intent}/><input type="hidden" name="requestId" value={randomUUID()}/>{itemId && <input type="hidden" name="itemId" value={itemId}/>}</>;
}
export function ItemFields({ teams, item }: { teams: { id: string; name: string }[]; item?: { name: string; teamId: string; unit: string | null; minimum: { toString(): string } | null } }) {
  return <><label>Nome<input name="name" required minLength={2} maxLength={80} defaultValue={item?.name}/></label>
    <label>Equipe<select name="teamId" required defaultValue={item?.teamId || ''}><option value="" disabled>Selecione a equipe</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <label>Unidade (material)<select name="unit" defaultValue={item?.unit || 'UNIDADE'}>{Object.entries(unitLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label>Estoque mínimo (material)<input name="minimum" inputMode="decimal" defaultValue={item?.minimum?.toString()} /></label></>;
}
