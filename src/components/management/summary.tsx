import { formatDuration, type TimeStats } from '@/lib/analytics-service';
export function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
}) {
  return (
    <article className="panel metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
    </article>
  );
}
export function TimeCard({
  label,
  stats,
  hint,
}: {
  label: string;
  stats: TimeStats;
  hint: string;
}) {
  return (
    <article className="panel metric-card time-card">
      <span>{label}</span>
      <strong>{formatDuration(stats.median)}</strong>
      <p>
        Média {formatDuration(stats.mean)} · amostra {stats.count}
      </p>
      <small>{hint}</small>
    </article>
  );
}
