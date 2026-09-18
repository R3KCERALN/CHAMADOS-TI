import type { Distribution, Overview } from '@/lib/analytics-service';
import { formatDuration } from '@/lib/analytics-service';
export function Bars({
  title,
  subtitle,
  rows,
  time = false,
}: {
  title: string;
  subtitle: string;
  rows: Distribution[];
  time?: boolean;
}) {
  const total = rows.reduce((s, r) => s + r.count, 0),
    max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="panel padded chart-panel">
      <h2>{title}</h2>
      <p className="muted small">{subtitle}</p>
      {!rows.length ? (
        <p className="chart-empty">Nenhum registro para estes filtros.</p>
      ) : (
        <ul className="bar-list">
          {rows.map((row) => (
            <li key={row.name}>
              <div className="bar-caption">
                <span>{row.name}</span>
                <strong>
                  {row.count.toLocaleString('pt-BR')}{' '}
                  <small>{total ? Math.round((row.count / total) * 100) : 0}%</small>
                </strong>
              </div>
              <div className="bar-track" aria-hidden="true">
                <span style={{ width: `${(row.count / max) * 100}%` }} />
              </div>
              {time && (
                <p className="bar-time">
                  Acumulado: {formatDuration(row.seconds)}
                  {row.median !== undefined && <> · Mediana: {formatDuration(row.median)}</>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
export function Evolution({ rows }: { rows: Overview['series'] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.opened, r.resolved]));
  const x = (i: number) => 48 + (i / Math.max(1, rows.length - 1)) * 850;
  const y = (value: number) => 190 - (value / max) * 155;
  return (
    <section className="panel padded evolution">
      <div className="section-heading chart-heading">
        <div>
          <h2>Movimento da operação</h2>
          <p>Abertos pela data de criação; resolvidos pela data de resolução.</p>
        </div>
        <div className="chart-legend">
          <span>Abertos</span>
          <span>Resolvidos</span>
        </div>
      </div>
      <svg
        viewBox="0 0 940 230"
        role="img"
        aria-label="Evolução de chamados abertos e resolvidos. Os valores também estão na tabela abaixo."
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1="48" x2="898" y1={y(max * f)} y2={y(max * f)} stroke="#e3e9e6" />
            <text x="36" y={y(max * f) + 4} textAnchor="end" fill="#586a62" fontSize="12">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {(['opened', 'resolved'] as const).map((key, index) => (
          <g key={key}>
            <polyline
              fill="none"
              stroke={index ? '#4574aa' : '#176b57'}
              strokeWidth="3"
              strokeDasharray={index ? '5 4' : undefined}
              points={rows.map((r, i) => `${x(i)},${y(r[key])}`).join(' ')}
            />
            {rows.map((r, i) => (
              <circle
                key={r.bucket}
                cx={x(i)}
                cy={y(r[key])}
                r="3"
                fill={index ? '#4574aa' : '#176b57'}
              >
                <title>{`${r.bucket}: ${r[key]} ${index ? 'resolvidos' : 'abertos'}`}</title>
              </circle>
            ))}
          </g>
        ))}
        {rows
          .filter(
            (_, i) =>
              i === 0 || i === rows.length - 1 || i % Math.max(1, Math.ceil(rows.length / 6)) === 0,
          )
          .map((r) => (
            <text
              key={r.bucket}
              x={x(rows.indexOf(r))}
              y="219"
              textAnchor="middle"
              fill="#586a62"
              fontSize="11"
            >
              {rows.length <= 24 &&
              rows[0]?.bucket.slice(0, 10) === rows.at(-1)?.bucket.slice(0, 10)
                ? r.bucket.slice(11)
                : r.bucket.slice(5, 10).split('-').reverse().join('/')}
            </text>
          ))}
      </svg>
      <details className="data-table">
        <summary>Ver valores por intervalo</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Intervalo local</th>
                <th>Abertos</th>
                <th>Resolvidos</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bucket}>
                  <td>{r.bucket}</td>
                  <td>{r.opened}</td>
                  <td>{r.resolved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
