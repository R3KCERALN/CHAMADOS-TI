import { INVALID_FILTER_NOTICE } from '@/lib/invalid-filters';
export function InvalidFilterNotice({ aviso }: { aviso?: string | string[] }) {
  if (aviso !== INVALID_FILTER_NOTICE) return null;
  return (
    <p className="notice error" role="status">
      Algum filtro do endereço era inválido, ou o período passava de cinco anos. Mostrando a visão
      padrão; ajuste os filtros novamente.
    </p>
  );
}
