import { LiveUpdates } from '@/components/live-updates';
import { operationalRevision } from '@/lib/live-updates';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Clock3,
  MessageSquareText,
  UserRound,
  CheckCircle2,
  Plus,
  ArrowRightLeft,
} from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { getTicket } from '@/lib/services';
import { db } from '@/lib/db';
import { locationOptions } from '@/lib/organization-service';
import { LocationFields } from '@/components/location-fields';
import { organizationLabels as labels } from '@/lib/organization-labels';
import { formatCnpj } from '@/lib/cnpj';
import { AppError } from '@/lib/errors';
import { ticketAction } from '@/app/actions';
import { ActionForm, FieldError, Submit } from '@/components/form';
import { Pagination } from '@/components/pagination';
import { Status } from '@/components/tickets';
import {
  formatDate,
  eventLabels,
  impactLabels,
  waitingLabels,
  ticketNumber,
  statusLabels,
  complexityLabels,
} from '@/lib/labels';
function Hidden({ id, intent }: { id: string; intent: string }) {
  return (
    <>
      <input type="hidden" name="ticketId" value={id} />
      <input type="hidden" name="intent" value={intent} />
    </>
  );
}
export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ criado?: string; eventos?: string; comentarios?: string }>;
}) {
  const user = await requireUser();
  const revision = await operationalRevision(user.id);
  const { id } = await params;
  const search = await searchParams;
  const eventsPage = Math.max(1, Number(search.eventos) || 1),
    commentsPage = Math.max(1, Number(search.comentarios) || 1);
  const ticket = await getTicket(user.id, id, eventsPage, commentsPage).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const tech = ['TI', 'ADMIN'].includes(user.role);
  const companies = tech ? await locationOptions(user.id) : [];
  const manage = user.role === 'ADMIN' || (user.role === 'TI' && ticket.assigneeId === user.id);
  const editable = manage && !!ticket.assigneeId && ticket.status !== 'RESOLVIDO';
  const technicians = editable
    ? await db.user.findMany({
        where: {
          organizationId: user.organizationId,
          role: 'TI',
          active: true,
          id: { not: ticket.assigneeId! },
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
    : [];
  const available = technicians.filter((t) => !ticket.participants.some((p) => p.userId === t.id));
  const created = search.criado;
  const categories = tech
    ? await db.category.findMany({
        where: {
          organizationId: user.organizationId,
          OR: [{ active: true }, ...(ticket.categoryId ? [{ id: ticket.categoryId }] : [])],
        },
        orderBy: { name: 'asc' },
      })
    : [];
  return (
    <>
      <LiveUpdates initialRevision={revision} />
      <Link href="/chamados" className="back-link">
        <ArrowLeft size={17} />
        Voltar aos chamados
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {ticketNumber(ticket.number)} <span className="separator">/</span>{' '}
            {ticket.origin === 'ATENDIMENTO_RAPIDO' ? 'ATENDIMENTO RÁPIDO' : 'CHAMADO'}
          </span>
          <h1>Detalhes do atendimento</h1>
          <p>Aberto em {formatDate(ticket.createdAt)}</p>
        </div>
        <Status status={ticket.status} />
      </div>
      {created && (
        <p className="notice success" role="status">
          Chamado registrado com sucesso. Você pode acompanhar cada etapa aqui.
        </p>
      )}
      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel padded">
            <div className="section-title">
              <MessageSquareText size={19} />
              <h2>O que precisamos resolver</h2>
            </div>
            <p className="ticket-impact">
              <span>Impacto informado</span>
              <strong className={ticket.impact === 'BLOQUEADO' ? 'danger-text' : ''}>
                {impactLabels[ticket.impact]}
              </strong>
            </p>
            <p className="description">{ticket.description}</p>
            {ticket.waitingReason && (
              <div className="waiting-note">
                <Clock3 size={18} />
                <div>
                  <strong>Aguardando: {waitingLabels[ticket.waitingReason]}</strong>
                  {ticket.waitingNote && <p>{ticket.waitingNote}</p>}
                </div>
              </div>
            )}
            {ticket.resolvedAt && (
              <p className="resolved-note">
                <CheckCircle2 size={18} />
                Resolvido em {formatDate(ticket.resolvedAt)}
              </p>
            )}
          </section>
          {tech && (ticket.status === 'NOVO' || editable) && (
            <section className="panel padded primary-actions">
              <div className="section-title">
                <ArrowRightLeft size={19} />
                <h2>Próximo passo</h2>
              </div>
              {ticket.status === 'NOVO' && (
                <ActionForm action={ticketAction}>
                  <Hidden id={id} intent="claim" />
                  <Submit>Assumir chamado</Submit>
                </ActionForm>
              )}
              {editable && ticket.status === 'AGUARDANDO' && (
                <ActionForm action={ticketAction}>
                  <Hidden id={id} intent="status" />
                  <input type="hidden" name="status" value="EM_ATENDIMENTO" />
                  <Submit>Retomar atendimento</Submit>
                </ActionForm>
              )}
              {editable && ticket.status === 'EM_ATENDIMENTO' && (
                <details className="action-details">
                  <summary>Colocar em aguardando</summary>
                  <ActionForm action={ticketAction}>
                    <Hidden id={id} intent="status" />
                    <input type="hidden" name="status" value="AGUARDANDO" />
                    <div className="field">
                      <label htmlFor="waitingReason">Motivo da espera</label>
                      <select id="waitingReason" name="waitingReason" required defaultValue="">
                        <option value="" disabled>
                          Selecione o motivo
                        </option>
                        {Object.entries(waitingLabels).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="waiting-note">Detalhes da espera</label>
                      <textarea
                        id="waiting-note"
                        name="note"
                        rows={2}
                        maxLength={1000}
                        placeholder="Obrigatório para outro motivo"
                      />
                    </div>
                    <Submit className="button secondary">Confirmar espera</Submit>
                  </ActionForm>
                </details>
              )}
              {editable && (
                <>
                  <details className="action-details">
                    <summary className="resolve-summary">
                      <CheckCircle2 size={17} />
                      Resolver chamado
                    </summary>
                    <ActionForm action={ticketAction}>
                      <Hidden id={id} intent="status" />
                      <input type="hidden" name="status" value="RESOLVIDO" />
                      <div className="field">
                        <label htmlFor="resolution">Como foi resolvido? (opcional)</label>
                        <textarea id="resolution" name="note" rows={3} maxLength={1000} />
                      </div>
                      <p className="muted small">O solicitante verá o chamado como resolvido.</p>
                      <Submit>Confirmar resolução</Submit>
                    </ActionForm>
                  </details>
                  <details className="action-details">
                    <summary>Transferir responsável</summary>
                    <ActionForm action={ticketAction}>
                      <Hidden id={id} intent="assign" />
                      <div className="field">
                        <label htmlFor="assign-user">Novo responsável principal</label>
                        <select id="assign-user" name="userId" required defaultValue="">
                          <option value="" disabled>
                            Selecione um técnico
                          </option>
                          {technicians.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Submit className="button secondary">Transferir chamado</Submit>
                    </ActionForm>
                  </details>
                </>
              )}
            </section>
          )}
          <section className="panel padded">
            <div className="section-title">
              <MessageSquareText size={19} />
              <h2>
                Comentários <span className="count-pill">{ticket._count.comments}</span>
              </h2>
            </div>
            <div className="comments">
              {ticket.comments.length ? (
                ticket.comments.map((comment) => (
                  <article className="comment" key={comment.id}>
                    <div className="comment-header">
                      <strong>{comment.author.name}</strong>
                      <time dateTime={comment.createdAt.toISOString()}>
                        {formatDate(comment.createdAt)}
                      </time>
                    </div>
                    <p>{comment.content}</p>
                  </article>
                ))
              ) : (
                <p className="muted small">
                  Alguma informação a acrescentar? Deixe um comentário para o atendimento.
                </p>
              )}
            </div>
            <Pagination
              path={`/chamados/${id}`}
              params={search}
              page={commentsPage}
              total={ticket._count.comments}
              size={20}
              keyName="comentarios"
            />
            <ActionForm action={ticketAction}>
              <Hidden id={id} intent="comment" />
              <div className="field">
                <label htmlFor="content">Adicionar comentário</label>
                <textarea
                  id="content"
                  name="content"
                  rows={3}
                  maxLength={3000}
                  required
                  placeholder="Compartilhe uma atualização ou detalhe importante…"
                />
              </div>
              <Submit className="button secondary">Enviar comentário</Submit>
            </ActionForm>
          </section>
          <section className="panel padded">
            <div className="section-title">
              <Clock3 size={19} />
              <h2>Histórico do chamado</h2>
            </div>
            <ol className="timeline">
              {ticket.events.map((event) => (
                <li key={event.id}>
                  <span
                    className={`timeline-dot ${event.type === 'RESOLVIDO' ? 'completed' : ''}`}
                  />
                  <div>
                    <strong>
                      {event.type === 'CRIADO' && ticket.origin === 'ATENDIMENTO_RAPIDO'
                        ? `Atendimento rápido registrado por ${event.actor.name}`
                        : eventLabels[event.type]}
                    </strong>
                    {event.targetUser && (
                      <span className="event-target"> · {event.targetUser.name}</span>
                    )}
                    <p>
                      {event.actor.name} <span>·</span>{' '}
                      <time dateTime={event.createdAt.toISOString()}>
                        {formatDate(event.createdAt)}
                      </time>
                    </p>
                    {event.fromStatus && event.toStatus && (
                      <p className="event-detail">
                        {statusLabels[event.fromStatus]} → {statusLabels[event.toStatus]}
                      </p>
                    )}
                    {event.waitingReason && (
                      <p className="event-detail">{waitingLabels[event.waitingReason]}</p>
                    )}
                    {event.type === 'CATEGORIA_ALTERADA' && (
                      <p className="event-detail">
                        {event.previousCategory?.name || 'Sem categoria'} →{' '}
                        {event.nextCategory?.name || 'Sem categoria'}
                      </p>
                    )}
                    {event.type === 'COMPLEXIDADE_ALTERADA' && (
                      <p className="event-detail">
                        {event.previousComplexity
                          ? complexityLabels[event.previousComplexity]
                          : 'Não classificada'}{' '}
                        →{' '}
                        {event.nextComplexity
                          ? complexityLabels[event.nextComplexity]
                          : 'Não classificada'}
                      </p>
                    )}
                    {event.note && <p className="event-note">{event.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
            <Pagination
              path={`/chamados/${id}`}
              params={search}
              page={eventsPage}
              total={ticket._count.events}
              size={30}
              keyName="eventos"
            />
          </section>
        </div>
        <aside className="detail-aside">
          <section className="panel padded ticket-context">
            <div className="section-title">
              <UserRound size={19} />
              <h2>Contexto do chamado</h2>
            </div>
            <div className="ticket-facts">
              <div>
                <span>{labels.company}</span>
                <strong>
                  {ticket.company?.displayName || labels.noCompany}
                  {ticket.unit && ` · ${ticket.unit.name}`}
                </strong>
                {ticket.company && <small>CNPJ {formatCnpj(ticket.company.cnpj)}</small>}
              </div>
              <div>
                <span>Registrado por</span>
                <strong>{ticket.openedByUser?.name || 'Não registrado (legado)'}</strong>
              </div>
              <div>
                <span>Solicitante</span>
                <strong>{ticket.requesterName}</strong>
                {!ticket.requesterId && <small>Solicitante informado manualmente</small>}
              </div>
              <div>
                <span>Setor na abertura</span>
                <strong>{ticket.department?.name || 'Sem setor'}</strong>
              </div>
            </div>
          </section>
          {tech && (
            <section className="panel padded">
              <h2>Localização</h2>
              <ActionForm action={ticketAction}>
                <input type="hidden" name="ticketId" value={id} />
                <input type="hidden" name="intent" value="location" />
                <LocationFields
                  companies={companies}
                  initialCompanyId={ticket.companyId}
                  initialUnitId={ticket.unitId}
                />
                <Submit className="button secondary">Corrigir localização</Submit>
              </ActionForm>
              <h2>Classificação técnica</h2>
              <p className="muted small">
                Opcional. Não altera o impacto informado pelo solicitante.
              </p>
              <ActionForm action={ticketAction}>
                <Hidden id={id} intent="classify" />
                <div className="field">
                  <label htmlFor="technical-category">Categoria técnica</label>
                  <select
                    id="technical-category"
                    name="categoryId"
                    defaultValue={ticket.categoryId || ''}
                    aria-describedby="categoryId-error"
                  >
                    <option value="">Sem categoria</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {!c.active ? ' (inativa)' : ''}
                      </option>
                    ))}
                  </select>
                  <FieldError name="categoryId" id="categoryId-error" />
                </div>
                <div className="field">
                  <label htmlFor="technical-complexity">Complexidade operacional</label>
                  <select
                    id="technical-complexity"
                    name="complexity"
                    defaultValue={ticket.complexity || ''}
                    aria-describedby="complexity-error"
                  >
                    <option value="">Não classificada</option>
                    {Object.entries(complexityLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <FieldError name="complexity" id="complexity-error" />
                </div>
                <Submit className="button secondary">Salvar classificação</Submit>
              </ActionForm>
            </section>
          )}
          <section className="panel padded">
            <div className="section-title">
              <UserRound size={19} />
              <h2>Equipe de atendimento</h2>
            </div>
            <span className="eyebrow">RESPONSÁVEL PRINCIPAL</span>
            <p className="assignee-name">{ticket.assignee?.name || 'Aguardando atribuição'}</p>
            {ticket.startedAt && (
              <p className="muted small">Iniciado em {formatDate(ticket.startedAt)}</p>
            )}
            <div className="support-block">
              <span className="eyebrow">TÉCNICOS DE APOIO</span>
              {ticket.participants.length ? (
                ticket.participants.map((participant) => (
                  <div className="support-person" key={participant.userId}>
                    <span>
                      {participant.user.name}
                      {!participant.user.active && <small> (inativo)</small>}
                    </span>
                    {editable && (
                      <ActionForm action={ticketAction} className="compact-form">
                        <Hidden id={id} intent="support-remove" />
                        <input type="hidden" name="userId" value={participant.userId} />
                        <Submit className="button subtle small-button">Remover</Submit>
                      </ActionForm>
                    )}
                  </div>
                ))
              ) : (
                <p className="muted small">Nenhum técnico de apoio.</p>
              )}
            </div>
            {editable && (
              <ActionForm action={ticketAction}>
                <Hidden id={id} intent="support-add" />
                <div className="field">
                  <label htmlFor="support-user">Adicionar apoio</label>
                  <select id="support-user" name="userId" required defaultValue="">
                    <option value="" disabled>
                      Selecione um técnico
                    </option>
                    {available.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Submit className="button secondary">
                  <Plus size={16} />
                  Adicionar apoio
                </Submit>
              </ActionForm>
            )}
          </section>
          <p className="aside-note">Cada atualização fica registrada no histórico deste chamado.</p>
        </aside>
      </div>
    </>
  );
}
