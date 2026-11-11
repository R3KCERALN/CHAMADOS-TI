import { queryString, type SearchParams } from '@/lib/period';
import type { PdfScreen } from '@/lib/management-pdf';
export function PdfLink({
  screen,
  params,
  id,
  className = 'button secondary',
}: {
  screen: PdfScreen;
  params: SearchParams;
  id?: string;
  className?: string;
}) {
  return (
    <a
      className={className}
      href={`/gestor/relatorio?${queryString(params, { tela: screen, id: id ?? '', pagina: '' })}`}
    >
      Baixar PDF
    </a>
  );
}
