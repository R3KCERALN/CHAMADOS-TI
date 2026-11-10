import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { teamOptions } from '@/lib/teams';
import { ActionForm, FieldError, Submit } from '@/components/form';
import { categoryAction } from '@/app/actions';
import { Pagination } from '@/components/pagination';
import type { SearchParams } from '@/lib/period';
export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  if (user.role !== 'ADMIN') notFound();
  const params = await searchParams;
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(params.pagina)) || 1));
  const [teams, categories, total] = await Promise.all([
    teamOptions(db, user.organizationId),
    db.category.findMany({
      where: { organizationId: user.organizationId },
      // Team keys sort Elétrica before TI; descending shows TI first, as everywhere else.
      orderBy: [{ team: { key: 'desc' } }, { name: 'asc' }],
      take: 20,
      skip: (page - 1) * 20,
    }),
    db.category.count({ where: { organizationId: user.organizationId } }),
  ]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRAÇÃO</span>
          <h1>Categorias técnicas</h1>
          <p>Classificações de cada equipe. Desativar preserva os chamados e eventos anteriores.</p>
        </div>
      </div>
      <section className="panel padded">
        <h2>Criar categoria</h2>
        <ActionForm action={categoryAction}>
          <div className="field">
            <label htmlFor="new-category-team">Equipe</label>
            <select id="new-category-team" name="teamId" defaultValue="" required>
              <option value="" disabled>
                Selecione a equipe
              </option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            <FieldError name="teamId" />
          </div>
          <div className="field">
            <label htmlFor="new-category">Nome da categoria</label>
            <input
              id="new-category"
              name="name"
              required
              minLength={2}
              maxLength={100}
              aria-describedby="new-category-error"
            />
            <FieldError name="name" id="new-category-error" />
          </div>
          <Submit>Criar categoria</Submit>
        </ActionForm>
      </section>
      {teams.map((team) => {
        const items = categories.filter((c) => c.teamId === team.id);
        if (!items.length) return null;
        return (
          <section key={team.id} aria-labelledby={`team-${team.id}`}>
            <h2 id={`team-${team.id}`}>{team.name}</h2>
            <div className="category-grid">
              {items.map((c) => (
                <section className="panel padded" key={c.id}>
                  <ActionForm action={categoryAction}>
                    <input name="id" type="hidden" value={c.id} />
                    <div className="field">
                      <label htmlFor={`category-${c.id}`}>Nome</label>
                      <input
                        id={`category-${c.id}`}
                        name="name"
                        required
                        minLength={2}
                        maxLength={100}
                        defaultValue={c.name}
                        aria-describedby={`category-${c.id}-error`}
                      />
                      <FieldError name="name" id={`category-${c.id}-error`} />
                    </div>
                    <div className="field">
                      <label htmlFor={`active-${c.id}`}>Situação</label>
                      <select id={`active-${c.id}`} name="active" defaultValue={String(c.active)}>
                        <option value="true">Ativa</option>
                        <option value="false">Inativa</option>
                      </select>
                    </div>
                    <Submit className="button secondary">Salvar categoria</Submit>
                  </ActionForm>
                </section>
              ))}
            </div>
          </section>
        );
      })}
      <Pagination path="/admin/categorias" params={params} page={page} total={total} />
    </>
  );
}
