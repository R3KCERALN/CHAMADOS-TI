import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Plus, ArrowUpRight } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { adminUsers } from '@/lib/services';
import { teamsWithoutStockKeeper } from '@/lib/stock-access';
import { roleLabels } from '@/lib/labels';
import { Pagination } from '@/components/pagination';
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ criado?: string; busca?: string; pagina?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== 'ADMIN') notFound();
  const params = await searchParams;
  const { users, total, page } = await adminUsers(user.id, {
    q: params.busca,
    page: Number(params.pagina),
  });
  const missingKeepers = await teamsWithoutStockKeeper(user.organizationId);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRAÇÃO</span>
          <h1>Pessoas e acessos</h1>
          <p>O acesso certo para cada pessoa, com o histórico sempre preservado.</p>
        </div>
        <Link href="/admin/usuarios/novo" className="button primary">
          <Plus size={18} />
          Criar usuário
        </Link>
      </div>
      {params.criado && (
        <p className="notice success" role="status">
          Usuário criado. Compartilhe a senha temporária diretamente com a pessoa.
        </p>
      )}
      {missingKeepers.map((team) => (
        <p key={team.id} className="notice" role="status">
          Equipe {team.name} sem responsável de estoque.
        </p>
      ))}
      <section className="panel list-panel">
        <div className="section-heading">
          <h2>
            {total} {total === 1 ? 'pessoa' : 'pessoas'}
          </h2>
          <form className="search-form">
            <label className="sr-only" htmlFor="busca">
              Buscar pessoas
            </label>
            <input
              id="busca"
              name="busca"
              placeholder="Nome, username ou setor…"
              defaultValue={params.busca}
              type="search"
            />
            <button className="button secondary" type="submit">
              Buscar
            </button>
          </form>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Setor</th>
                <th>Perfil</th>
                <th>Equipe</th>
                <th>Situação</th>
                <th>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((person) => (
                <tr key={person.id}>
                  <td>
                    <strong>{person.name}</strong>
                    {person.stockKeeper && (
                      <span className="status status-AGUARDANDO">Estoque</span>
                    )}
                    <small>@{person.username}</small>
                  </td>
                  <td>{person.department.name}</td>
                  <td>{roleLabels[person.role]}</td>
                  <td>{person.team?.name ?? '—'}</td>
                  <td>
                    <span
                      className={`status ${person.active ? 'status-RESOLVIDO' : 'status-inactive'}`}
                    >
                      {person.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td>
                    <Link
                      className="text-link"
                      href={`/admin/usuarios/${person.id}`}
                      aria-label={`Editar ${person.name}`}
                    >
                      Editar <ArrowUpRight size={15} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!users.length && (
            <div className="empty">
              <h3>Nenhuma pessoa encontrada</h3>
              <p>Tente outro nome ou setor.</p>
            </div>
          )}
        </div>
      </section>
      <Pagination
        path="/admin/usuarios"
        params={{ busca: params.busca }}
        page={page}
        total={total}
      />
    </>
  );
}
