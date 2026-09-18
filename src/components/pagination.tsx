import Link from 'next/link';
import { queryString, type SearchParams } from '@/lib/period';
export function Pagination({
  page,
  total,
  size = 20,
  path,
  params,
  keyName = 'pagina',
}: {
  page: number;
  total: number;
  size?: number;
  path: string;
  params: SearchParams;
  keyName?: string;
}) {
  return (
    <nav className="pagination" aria-label={`Paginação ${keyName}`}>
      {page > 1 && (
        <Link
          className="button secondary"
          href={`${path}?${queryString(params, { [keyName]: String(page - 1) })}`}
        >
          Anterior
        </Link>
      )}
      <span>
        Página {page} · {total} registros
      </span>
      {page * size < total && (
        <Link
          className="button secondary"
          href={`${path}?${queryString(params, { [keyName]: String(page + 1) })}`}
        >
          Próxima
        </Link>
      )}
    </nav>
  );
}
