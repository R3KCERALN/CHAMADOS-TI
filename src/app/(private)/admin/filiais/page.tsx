import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { organizationLabels as labels } from '@/lib/organization-labels';
import { ActionForm, Submit } from '@/components/form';
import { companyAction } from '@/app/actions';
import { Pagination } from '@/components/pagination';
import type { SearchParams } from '@/lib/period';
function Fields({
  company,
}: {
  company?: {
    id: string;
    displayName: string;
    legalName: string | null;
    cnpj: string;
    active: boolean;
  };
}) {
  const id = company?.id || 'new';
  return (
    <>
      {company && <input name="id" type="hidden" value={id} />}
      <div className="field">
        <label htmlFor={`display-${id}`}>Nome de exibição</label>
        <input
          id={`display-${id}`}
          name="displayName"
          required
          minLength={2}
          maxLength={100}
          defaultValue={company?.displayName}
        />
      </div>
      <div className="field">
        <label htmlFor={`legal-${id}`}>Razão social (opcional)</label>
        <input
          id={`legal-${id}`}
          name="legalName"
          maxLength={200}
          defaultValue={company?.legalName || ''}
        />
      </div>
      <div className="field">
        <label htmlFor={`cnpj-${id}`}>CNPJ</label>
        <input
          id={`cnpj-${id}`}
          name="cnpj"
          required
          maxLength={30}
          inputMode="numeric"
          defaultValue={company?.cnpj}
        />
      </div>
      {company && (
        <div className="field">
          <label htmlFor={`active-${id}`}>Situação</label>
          <select id={`active-${id}`} name="active" defaultValue={String(company.active)}>
            <option value="true">Ativa</option>
            <option value="false">Inativa</option>
          </select>
        </div>
      )}
    </>
  );
}
export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  if (user.role !== 'ADMIN') notFound();
  const params = await searchParams;
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(params.pagina)) || 1));
  const where = { organizationId: user.organizationId };
  const [companies, total] = await Promise.all([
    db.company.findMany({
      where,
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * 20,
      take: 20,
    }),
    db.company.count({ where }),
  ]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRAÇÃO</span>
          <h1>{labels.companies}</h1>
          <p>
            Organização atual: <strong>{user.organization.name}</strong>
          </p>
          <p>Uma {labels.company.toLowerCase()} pode funcionar sem nenhuma unidade.</p>
        </div>
      </div>
      <section className="panel padded">
        <h2>Criar {labels.company.toLowerCase()}</h2>
        <ActionForm action={companyAction}>
          <Fields />
          <Submit>Criar {labels.company.toLowerCase()}</Submit>
        </ActionForm>
      </section>
      <div className="category-grid">
        {companies.map((company) => (
          <section className="panel padded" key={company.id}>
            <h2>{company.displayName}</h2>
            <ActionForm action={companyAction}>
              <Fields company={company} />
              <Submit className="button secondary">Salvar {labels.company.toLowerCase()}</Submit>
            </ActionForm>
          </section>
        ))}
      </div>
      <Pagination path="/admin/filiais" params={params} page={page} total={total} />
    </>
  );
}
