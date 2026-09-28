import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { organizationLabels as labels } from '@/lib/organization-labels';
import { ActionForm, FieldError, Submit } from '@/components/form';
import { unitAction } from '@/app/actions';
import { Pagination } from '@/components/pagination';
import { param, type SearchParams } from '@/lib/period';
export default async function UnitsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  if (user.role !== 'ADMIN') notFound();
  const params = await searchParams;
  const companyId = param(params, 'company');
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(params.pagina)) || 1));
  const companies = await db.company.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { displayName: 'asc' },
  });
  const where = {
    company: { organizationId: user.organizationId },
    ...(companyId ? { companyId } : {}),
  };
  const [units, total] = await Promise.all([
    db.unit.findMany({
      where,
      include: { company: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 20,
      skip: (page - 1) * 20,
    }),
    db.unit.count({ where }),
  ]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRAÇÃO</span>
          <h1>{labels.units}</h1>
          <p>Locais físicos opcionais dentro de uma {labels.company.toLowerCase()}.</p>
        </div>
      </div>
      <form method="get" className="panel padded">
        <div className="field">
          <label htmlFor="company">Filtrar por {labels.company.toLowerCase()}</label>
          <select id="company" name="company" defaultValue={companyId}>
            <option value="">Todas</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </div>
        <button className="button secondary">Filtrar</button>
      </form>
      <section className="panel padded">
        <h2>Criar {labels.unit.toLowerCase()}</h2>
        <ActionForm action={unitAction}>
          <div className="field">
            <label htmlFor="companyId">{labels.company}</label>
            <select
              id="companyId"
              name="companyId"
              defaultValue={companyId}
              required
              aria-describedby="companyId-error"
            >
              <option value="">Selecione</option>
              {companies
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
            </select>
            <FieldError name="companyId" id="companyId-error" />
          </div>
          <div className="field">
            <label htmlFor="unitName">Nome da {labels.unit.toLowerCase()}</label>
            <input
              id="unitName"
              name="name"
              maxLength={100}
              required
              aria-describedby="unitName-error"
            />
            <FieldError name="name" id="unitName-error" />
          </div>
          <div className="field">
            <label htmlFor="code">Código (opcional)</label>
            <input id="code" name="code" maxLength={30} />
          </div>
          <Submit>Criar {labels.unit.toLowerCase()}</Submit>
        </ActionForm>
      </section>
      <div className="category-grid">
        {units.map((u) => (
          <section key={u.id} className="panel padded">
            <h2>{u.name}</h2>
            <p>{u.company.displayName}</p>
            <ActionForm action={unitAction}>
              <input name="id" value={u.id} type="hidden" />
              <input name="companyId" value={u.companyId} type="hidden" />
              <div className="field">
                <label htmlFor={`name-${u.id}`}>Nome</label>
                <input
                  id={`name-${u.id}`}
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={u.name}
                  aria-describedby={`name-${u.id}-error`}
                />
                <FieldError name="name" id={`name-${u.id}-error`} />
              </div>
              <div className="field">
                <label htmlFor={`code-${u.id}`}>Código (opcional)</label>
                <input id={`code-${u.id}`} name="code" maxLength={30} defaultValue={u.code || ''} />
              </div>
              <div className="field">
                <label htmlFor={`active-${u.id}`}>Situação</label>
                <select id={`active-${u.id}`} name="active" defaultValue={String(u.active)}>
                  <option value="true">Ativa</option>
                  <option value="false">Inativa</option>
                </select>
              </div>
              <Submit className="button secondary">Salvar {labels.unit.toLowerCase()}</Submit>
            </ActionForm>
          </section>
        ))}
      </div>
      <Pagination path="/admin/unidades" params={params} page={page} total={total} />
    </>
  );
}
