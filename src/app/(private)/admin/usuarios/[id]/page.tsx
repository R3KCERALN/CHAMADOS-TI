import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { publicUserSelect } from '@/lib/auth-service';
import { ActionForm, Submit } from '@/components/form';
import { UserFields } from '@/components/user-fields';
import { updateUserAction, resetPasswordAction } from '@/app/actions';
export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  if (actor.role !== 'ADMIN') notFound();
  const { id } = await params;
  const [user, departments] = await Promise.all([
    db.user.findUnique({ where: { id }, select: publicUserSelect }),
    db.department.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
  ]);
  if (!user) notFound();
  return (
    <div className="narrow">
      <Link className="back-link" href="/admin/usuarios">
        <ArrowLeft size={17} />
        Voltar aos usuários
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRAÇÃO</span>
          <h1>{user.name}</h1>
          <p>Atualize os dados e gerencie o acesso.</p>
        </div>
      </div>
      <section className="panel padded">
        <ActionForm action={updateUserAction}>
          <input type="hidden" name="id" value={id} />
          <UserFields departments={departments} user={user} />
          <Submit>Salvar alterações</Submit>
        </ActionForm>
      </section>
      <section className="panel padded reset-panel">
        <h2>Redefinir senha</h2>
        <p className="muted small">
          As sessões existentes serão encerradas. A pessoa deverá criar uma nova senha ao entrar.
        </p>
        <ActionForm action={resetPasswordAction}>
          <input type="hidden" name="id" value={id} />
          <div className="field">
            <label htmlFor="temporaryPassword">Nova senha temporária</label>
            <input
              id="temporaryPassword"
              name="password"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </div>
          <Submit className="button secondary">Redefinir senha</Submit>
        </ActionForm>
      </section>
    </div>
  );
}
