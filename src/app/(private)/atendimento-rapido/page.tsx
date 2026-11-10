import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Zap } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { locationOptions } from '@/lib/organization-service';
import { teamOptions } from '@/lib/teams';
import { db } from '@/lib/db';
import { TicketForm } from '@/components/ticket-form';
import { RequesterPicker } from '@/components/requester-picker';
export default async function QuickPage() {
  const user = await requireUser();
  if (!['TI', 'ADMIN'].includes(user.role)) notFound();
  const [companies, teams] = await Promise.all([
    locationOptions(user.id),
    user.role === 'ADMIN' ? teamOptions(db, user.organizationId) : [],
  ]);
  return (
    <div className="narrow">
      <Link className="back-link" href="/">
        <ArrowLeft size={17} />
        Voltar ao início
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            <Zap size={14} /> REGISTRE. ATENDA. PRONTO.
          </span>
          <h1>Atendimento rápido</h1>
          <p>Transforme uma conversa em um atendimento registrado.</p>
        </div>
      </div>
      <section className="panel padded">
        <TicketForm quick teams={teams}>
          <RequesterPicker companies={companies} />
        </TicketForm>
      </section>
    </div>
  );
}
