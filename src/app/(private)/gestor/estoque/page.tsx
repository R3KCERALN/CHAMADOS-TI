import { unitLabels } from '@/lib/stock-labels';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { stockReport } from '@/lib/stock-analytics';
import { db } from '@/lib/db';
import { teamOptions } from '@/lib/teams';
import { formatDate } from '@/lib/labels';
import { formatDuration } from '@/lib/analytics-service';
import { periodLabels, queryString, type SearchParams } from '@/lib/period';
import { resetInvalidFilters } from '@/lib/invalid-filters';
import { PdfLink } from '@/components/management/pdf-link';
import { Pagination } from '@/components/pagination';
export default async function StockReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  if (!['GESTOR', 'ADMIN'].includes(user.role)) notFound();
  const params = await searchParams;
  const data = await stockReport(user.id, params).catch((e) =>
    resetInvalidFilters(e, params, '/gestor/estoque'),
  );
  const [teams, items] = await Promise.all([
    teamOptions(db, user.organizationId),
    db.stockItem.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">GESTÃO</span>
          <h1>Relatórios de estoque</h1>
          <p>
            {data.filters.from} a {data.filters.to} · {data.filters.zone}
          </p>
        </div>
        <div className="stock-links">
          <Link href="/gestor">Indicadores</Link>
          <PdfLink screen="estoque" params={params} />
          <a className="button secondary" href={`/gestor/estoque/exportar?${queryString(params)}`}>
            Exportar CSV
          </a>
        </div>
      </div>
      <form className="filters">
        <label>
          Período
          <select name="periodo" defaultValue={data.filters.key}>
            {Object.entries(periodLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Início
          <input type="date" name="inicio" defaultValue={data.filters.from} />
        </label>
        <label>
          Fim
          <input type="date" name="fim" defaultValue={data.filters.to} />
        </label>
        {(['team', 'actorTeam'] as const).map((key) => (
          <label key={key}>
            {key === 'team' ? 'Equipe do item' : 'Equipe de quem usou'}
            <select name={key} defaultValue={data.filters[key] || ''}>
              <option value="">Todas</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          Item
          <select name="item" defaultValue={data.filters.item || ''}>
            <option value="">Todos</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary">Filtrar</button>
      </form>
      <section className="panel padded">
        <h2>Consumo por item</h2>
        <p>Usos sem estorno. Ajustes e entradas não contam como consumo.</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Equipe</th>
                <th>Unidade</th>
                <th>Quantidade</th>
              </tr>
            </thead>
            <tbody>
              {data.consumption.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td>{r.teamName}</td>
                  <td>{unitLabels[r.unit as keyof typeof unitLabels]}</td>
                  <td>{r.quantity.replace('.', ',')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel padded">
        <h2>Usos fora de chamado</h2>
        <div className="stock-links">
          {Object.entries(data.offTicket.counts).map(([k, v]) => (
            <p key={k}>
              {k}: <strong>{v}</strong>
            </p>
          ))}
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Item</th>
                <th>Quantidade</th>
                <th>Quem fez</th>
                <th>Conferência</th>
              </tr>
            </thead>
            <tbody>
              {data.offTicket.rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.createdAt)}</td>
                  <td>
                    {r.name}
                    {r.reversed && ' · Estornado'}
                  </td>
                  <td>{r.quantity.replace('.', ',')}</td>
                  <td>{r.actorName}</td>
                  <td>{r.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={data.offTicket.page}
          total={data.offTicket.total}
          path="/gestor/estoque"
          params={params}
        />
      </section>
      <section className="panel padded">
        <h2>Ferramentas fora do lugar</h2>
        {data.toolsOut.map((r) => (
          <p key={r.name}>
            {r.name} · {r.holderName} · desde {formatDate(r.since)} · {formatDuration(r.seconds)}
          </p>
        ))}
        {!data.toolsOut.length && <p>Todas as ferramentas estão guardadas.</p>}
      </section>
    </>
  );
}
