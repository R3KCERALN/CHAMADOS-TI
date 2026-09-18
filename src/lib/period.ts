import { APP_TIMEZONE } from './config';
import { AppError } from './errors';
export type SearchParams = Record<string, string | string[] | undefined>;
export const param = (input: SearchParams, key: string) =>
  typeof input[key] === 'string' ? (input[key] as string) : '';
export function localDate(date: Date, zone = APP_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function shiftDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export function localMidnight(date: string, zone = APP_TIMEZONE) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw new AppError('Data inválida.');
  const desired = Date.parse(`${date}T00:00:00Z`);
  // Find the first instant of the civil date, including zones with a DST gap at midnight.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateAt = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant));
    const get = (key: string) => parts.find((p) => p.type === key)!.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
  let low = desired - 36 * 3600000;
  let high = desired + 36 * 3600000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dateAt(middle) < date) low = middle + 1;
    else high = middle;
  }
  if (dateAt(low) !== date) throw new AppError('Data inexistente no fuso configurado.');
  return new Date(low);
}
export const periodLabels = {
  hoje: 'Hoje',
  '7dias': 'Últimos 7 dias',
  '30dias': 'Últimos 30 dias',
  mes: 'Este mês',
  anterior: 'Mês anterior',
  personalizado: 'Personalizado',
};
export function resolvePeriod(input: SearchParams, now = new Date(), zone = APP_TIMEZONE) {
  const key = param(input, 'periodo') || '30dias';
  if (!(key in periodLabels)) throw new AppError('Período inválido.');
  const today = localDate(now, zone);
  let from = today,
    to = today;
  if (key === '7dias') from = shiftDate(today, -6);
  if (key === '30dias') from = shiftDate(today, -29);
  if (key === 'mes') from = `${today.slice(0, 7)}-01`;
  if (key === 'anterior') {
    to = shiftDate(`${today.slice(0, 7)}-01`, -1);
    from = `${to.slice(0, 7)}-01`;
  }
  if (key === 'personalizado') {
    from = param(input, 'inicio');
    to = param(input, 'fim');
  }
  const start = localMidnight(from, zone);
  const last = localMidnight(to, zone);
  const end = localMidnight(shiftDate(to, 1), zone);
  if (start > last || end.getTime() - start.getTime() > 366 * 5 * 86400000)
    throw new AppError('Informe um intervalo válido de até cinco anos.');
  const days = Math.round((end.getTime() - start.getTime()) / 86400000);
  return {
    key,
    from,
    to,
    start,
    end,
    now,
    zone,
    grouping: (days <= 1 ? 'hour' : days <= 62 ? 'day' : days <= 366 ? 'week' : 'month') as
      'hour' | 'day' | 'week' | 'month',
  };
}
export function queryString(input: SearchParams, changes: Record<string, string> = {}) {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...input, ...changes }))
    if (typeof value === 'string' && value) p.set(key, value);
  return p.toString();
}
