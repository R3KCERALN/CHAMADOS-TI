import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { TicketForm } from '@/components/ticket-form';
export default async function NewTicketPage() {
  const user = await requireUser();
  if (user.role === 'GESTOR') redirect('/gestor');
  return (
    <div className="narrow">
      <Link className="back-link" href="/">
        <ArrowLeft size={17} />
        Voltar ao início
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">VAMOS RESOLVER JUNTOS</span>
          <h1>Abrir chamado</h1>
          <p>Uma descrição e o impacto. É só isso que precisamos.</p>
        </div>
      </div>
      <section className="panel padded">
        <TicketForm />
      </section>
    </div>
  );
}
