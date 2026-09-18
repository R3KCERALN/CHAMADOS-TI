import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { locationOptions } from '@/lib/organization-service';
import { LocationFields } from '@/components/location-fields';
import { TicketForm } from '@/components/ticket-form';
export default async function NewTicketPage() {
  const user = await requireUser();
  if (user.role === 'GESTOR') redirect('/gestor');
  const companies = await locationOptions(user.id);
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
        <TicketForm>
          <LocationFields
            companies={companies}
            initialCompanyId={user.primaryCompanyId}
            initialUnitId={user.primaryUnitId}
            compact
          />
        </TicketForm>
      </section>
    </div>
  );
}
