import { notFound } from 'next/navigation';
import { ChartNoAxesCombined } from 'lucide-react';
import { requireUser } from '@/lib/auth';
export default async function ManagerPage() {
  const user = await requireUser();
  if (user.role !== 'GESTOR') notFound();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">VISÃO DE GESTÃO</span>
          <h1>Olá, {user.name.split(' ')[0]}.</h1>
          <p>Bem-vindo à sua área de acompanhamento.</p>
        </div>
      </div>
      <section className="panel manager-placeholder">
        <span className="empty-icon">
          <ChartNoAxesCombined size={32} />
        </span>
        <span className="eyebrow">PRÓXIMA ETAPA</span>
        <h2>Indicadores começam com bons registros.</h2>
        <p>
          Estamos construindo a base com os atendimentos do dia a dia. A área de indicadores será
          desenvolvida após a validação do fluxo operacional.
        </p>
        <span className="status status-AGUARDANDO">Em preparação</span>
      </section>
    </>
  );
}
