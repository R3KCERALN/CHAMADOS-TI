import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { ActionForm, Submit } from '@/components/form';
import { UserFields } from '@/components/user-fields';
import { createUserAction } from '@/app/actions';
export default async function CreateUserPage() {
  const user = await requireUser();
  if (user.role !== 'ADMIN') notFound();
  const departments = await db.department.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
  });
  return (
    <div className="narrow">
      <Link className="back-link" href="/admin/usuarios">
        <ArrowLeft size={17} />
        Voltar aos usuários
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRAÇÃO</span>
          <h1>Criar usuário</h1>
          <p>Cadastre uma pessoa para acessar a Central.</p>
        </div>
      </div>
      <section className="panel padded">
        <ActionForm action={createUserAction}>
          <UserFields departments={departments} />
          <Submit>Criar usuário</Submit>
        </ActionForm>
      </section>
    </div>
  );
}
