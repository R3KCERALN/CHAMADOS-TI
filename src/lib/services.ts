import { z } from 'zod';
import { db } from './db';
import { AppError } from './errors';
import { hashPassword, publicUserSelect } from './auth-service';
import { userSchema, ticketSchema, statusSchema, passwordSchema } from './validation';
import type { Prisma, Role, Ticket } from '@/generated/prisma/client';
type Tx = Prisma.TransactionClient;
const techRoles: Role[] = ['TI', 'ADMIN'];
export async function actor(tx: Tx, id: string, roles?: Role[]) {
  const user = await tx.user.findUnique({ where: { id }, select: publicUserSelect });
  if (!user?.active || user.mustChangePassword)
    throw new AppError('Sua sessão não permite esta operação. Entre novamente.', 401);
  if (roles && !roles.includes(user.role))
    throw new AppError('Você não tem permissão para esta operação.', 403);
  return user;
}
export async function adminUsers(actorId: string) {
  await actor(db, actorId, ['ADMIN']);
  return db.user.findMany({
    select: { ...publicUserSelect, createdAt: true, department: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
}
export async function createUser(actorId: string, input: unknown) {
  const data = userSchema.extend({ password: passwordSchema }).parse(input);
  await actor(db, actorId, ['ADMIN']);
  const passwordHash = await hashPassword(data.password);
  return db.$transaction(async (tx) => {
    await actor(tx, actorId, ['ADMIN']);
    const department = await tx.department.findFirst({
      where: { id: data.departmentId, active: true },
    });
    if (!department) throw new AppError('Setor inválido.');
    const user = await tx.user.create({
      data: {
        name: data.name,
        username: data.username,
        departmentId: data.departmentId,
        role: data.role,
        passwordHash,
      },
      select: publicUserSelect,
    });
    await tx.userAudit.create({
      data: {
        actorId,
        subjectId: user.id,
        action: 'USUARIO_CRIADO',
        metadata: { role: data.role, departmentId: data.departmentId },
      },
    });
    return user;
  });
}
export async function updateUser(actorId: string, userId: string, input: unknown) {
  const data = userSchema.extend({ active: z.boolean() }).parse(input);
  return db.$transaction(async (tx) => {
    // All admin account mutations use the same lock: concurrent demotions cannot remove every admin.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(817214)`;
    await actor(tx, actorId, ['ADMIN']);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const before = await tx.user.findUnique({ where: { id: userId } });
    if (!before) throw new AppError('Usuário não encontrado.', 404);
    if (actorId === userId && (!data.active || data.role !== 'ADMIN'))
      throw new AppError('Você não pode desativar ou remover seu próprio acesso de administrador.');
    if (before.role === 'ADMIN' && before.active && (!data.active || data.role !== 'ADMIN')) {
      if ((await tx.user.count({ where: { role: 'ADMIN', active: true } })) <= 1)
        throw new AppError('Mantenha pelo menos um administrador ativo.');
    }
    if (!(await tx.department.findFirst({ where: { id: data.departmentId, active: true } })))
      throw new AppError('Setor inválido.');
    const user = await tx.user.update({ where: { id: userId }, data, select: publicUserSelect });
    await tx.session.deleteMany({ where: { userId } });
    await tx.userAudit.create({
      data: {
        actorId,
        subjectId: userId,
        action: 'USUARIO_ATUALIZADO',
        metadata: {
          before: {
            name: before.name,
            username: before.username,
            role: before.role,
            departmentId: before.departmentId,
            active: before.active,
          },
          after: data,
        },
      },
    });
    return user;
  });
}
export async function resetPassword(actorId: string, userId: string, password: string) {
  await actor(db, actorId, ['ADMIN']);
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    await actor(tx, actorId, ['ADMIN']);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true },
    });
    await tx.session.deleteMany({ where: { userId } });
    await tx.userAudit.create({ data: { actorId, subjectId: userId, action: 'SENHA_REDEFINIDA' } });
  });
}
export async function createTicket(actorId: string, input: unknown, requesterId?: string) {
  const data = ticketSchema.parse(input);
  return db.$transaction(async (tx) => {
    const user = await actor(tx, actorId, requesterId ? techRoles : ['FUNCIONARIO', 'TI', 'ADMIN']);
    const requester = requesterId
      ? await tx.user.findFirst({
          where: { id: requesterId, active: true },
          select: publicUserSelect,
        })
      : user;
    if (!requester) throw new AppError('Selecione um funcionário ativo.');
    const quick = !!requesterId;
    const ticket = await tx.ticket.create({
      data: {
        ...data,
        requesterId: requester.id,
        departmentId: requester.departmentId,
        origin: quick ? 'ATENDIMENTO_RAPIDO' : 'PORTAL',
        status: quick ? 'EM_ATENDIMENTO' : 'NOVO',
        assigneeId: quick ? actorId : null,
        startedAt: quick ? new Date() : null,
      },
    });
    await tx.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        actorId,
        type: 'CRIADO',
        toStatus: ticket.status,
        metadata: { origin: ticket.origin },
      },
    });
    if (quick)
      await tx.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          actorId,
          targetUserId: actorId,
          type: 'ASSUMIDO',
          toStatus: 'EM_ATENDIMENTO',
        },
      });
    return ticket;
  });
}
function visible(role: Role, userId: string, ticket: Ticket) {
  if (role === 'GESTOR' || (role === 'FUNCIONARIO' && ticket.requesterId !== userId))
    throw new AppError('Chamado não encontrado.', 404);
}
function manages(role: Role, userId: string, ticket: Ticket) {
  if (role !== 'ADMIN' && (role !== 'TI' || ticket.assigneeId !== userId))
    throw new AppError(
      'Somente o responsável principal ou um administrador pode realizar esta ação.',
      403,
    );
}
export async function getTicket(actorId: string, ticketId: string) {
  const user = await actor(db, actorId);
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      requester: { select: { id: true, name: true } },
      department: true,
      assignee: { select: { id: true, name: true } },
      participants: { include: { user: { select: { id: true, name: true, active: true } } } },
      events: {
        include: { actor: { select: { name: true } }, targetUser: { select: { name: true } } },
        orderBy: { sequence: 'asc' },
      },
      comments: { include: { author: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!ticket) throw new AppError('Chamado não encontrado.', 404);
  visible(user.role, user.id, ticket);
  return ticket;
}
export async function listTickets(actorId: string, filter = 'todos', page = 1) {
  const user = await actor(db, actorId, ['ADMIN', 'TI', 'FUNCIONARIO']);
  const where: Prisma.TicketWhereInput =
    user.role === 'FUNCIONARIO'
      ? { requesterId: user.id }
      : filter === 'novos'
        ? { status: 'NOVO' }
        : filter === 'meus'
          ? {
              OR: [{ assigneeId: user.id }, { participants: { some: { userId: user.id } } }],
              status: { not: 'RESOLVIDO' },
            }
          : filter === 'aguardando'
            ? { status: 'AGUARDANDO' }
            : {};
  const safePage = Math.max(1, Math.min(100000, Math.trunc(page) || 1));
  const [tickets, total] = await Promise.all([
    db.ticket.findMany({
      where,
      include: {
        requester: { select: { name: true } },
        department: { select: { name: true } },
        assignee: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      skip: (safePage - 1) * 20,
    }),
    db.ticket.count({ where }),
  ]);
  return { tickets, total, page: safePage };
}
export async function claimTicket(actorId: string, ticketId: string) {
  return db.$transaction(async (tx) => {
    await actor(tx, actorId, techRoles);
    const result = await tx.ticket.updateMany({
      where: { id: ticketId, status: 'NOVO', assigneeId: null },
      data: { assigneeId: actorId, status: 'EM_ATENDIMENTO', startedAt: new Date() },
    });
    if (result.count !== 1)
      throw new AppError('Este chamado já foi assumido por outro técnico. Atualize a página.', 409);
    await tx.ticketEvent.create({
      data: {
        ticketId,
        actorId,
        targetUserId: actorId,
        type: 'ASSUMIDO',
        fromStatus: 'NOVO',
        toStatus: 'EM_ATENDIMENTO',
      },
    });
  });
}
async function lockedTicket(tx: Tx, ticketId: string) {
  await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${ticketId} FOR UPDATE`;
  const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new AppError('Chamado não encontrado.', 404);
  return ticket;
}
export async function changeStatus(actorId: string, ticketId: string, input: unknown) {
  const data = statusSchema.parse(input);
  return db.$transaction(async (tx) => {
    const user = await actor(tx, actorId, techRoles);
    const ticket = await lockedTicket(tx, ticketId);
    manages(user.role, user.id, ticket);
    const allowed =
      ticket.status === 'EM_ATENDIMENTO'
        ? ['AGUARDANDO', 'RESOLVIDO']
        : ticket.status === 'AGUARDANDO'
          ? ['EM_ATENDIMENTO', 'RESOLVIDO']
          : [];
    if (!allowed.includes(data.status))
      throw new AppError('Esta transição de status não é permitida.', 409);
    if (data.status === 'AGUARDANDO' && !data.waitingReason)
      throw new AppError('Informe o motivo da espera.');
    if (data.status === 'AGUARDANDO' && data.waitingReason === 'OUTRO' && !data.note)
      throw new AppError('Descreva o motivo da espera.');
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        status: data.status,
        waitingReason: data.status === 'AGUARDANDO' ? data.waitingReason : null,
        waitingNote: data.status === 'AGUARDANDO' ? data.note || null : null,
        resolvedAt: data.status === 'RESOLVIDO' ? new Date() : null,
      },
    });
    await tx.ticketEvent.create({
      data: {
        ticketId,
        actorId,
        type:
          data.status === 'RESOLVIDO'
            ? 'RESOLVIDO'
            : data.status === 'AGUARDANDO'
              ? 'AGUARDANDO'
              : 'RETOMADO',
        fromStatus: ticket.status,
        toStatus: data.status,
        waitingReason: data.status === 'AGUARDANDO' ? data.waitingReason : null,
        note: data.note || null,
      },
    });
  });
}
export async function setSupport(actorId: string, ticketId: string, userId: string, add: boolean) {
  return db.$transaction(async (tx) => {
    const user = await actor(tx, actorId, techRoles);
    const ticket = await lockedTicket(tx, ticketId);
    manages(user.role, user.id, ticket);
    if (!ticket.assigneeId || ticket.status === 'RESOLVIDO')
      throw new AppError('O chamado precisa estar em atendimento ou aguardando.');
    if (userId === ticket.assigneeId)
      throw new AppError('O responsável principal já participa do chamado.');
    if (add) {
      if (!(await tx.user.findFirst({ where: { id: userId, role: 'TI', active: true } })))
        throw new AppError('Selecione um técnico ativo.');
      if (
        await tx.ticketParticipant.findUnique({ where: { ticketId_userId: { ticketId, userId } } })
      )
        throw new AppError('Este técnico já está no apoio.');
      await tx.ticketParticipant.create({ data: { ticketId, userId } });
    } else {
      const result = await tx.ticketParticipant.deleteMany({ where: { ticketId, userId } });
      if (!result.count) throw new AppError('Técnico de apoio não encontrado.');
    }
    await tx.ticketEvent.create({
      data: {
        ticketId,
        actorId,
        targetUserId: userId,
        type: add ? 'APOIO_ADICIONADO' : 'APOIO_REMOVIDO',
      },
    });
  });
}
export async function assignTicket(actorId: string, ticketId: string, userId: string) {
  return db.$transaction(async (tx) => {
    const user = await actor(tx, actorId, techRoles);
    const ticket = await lockedTicket(tx, ticketId);
    manages(user.role, actorId, ticket);
    if (!ticket.assigneeId || ticket.status === 'RESOLVIDO' || ticket.assigneeId === userId)
      throw new AppError('Não é possível transferir este chamado.');
    if (!(await tx.user.findFirst({ where: { id: userId, active: true, role: 'TI' } })))
      throw new AppError('Selecione um técnico ativo.');
    const removed = await tx.ticketParticipant.deleteMany({ where: { ticketId, userId } });
    if (removed.count)
      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId,
          targetUserId: userId,
          type: 'APOIO_REMOVIDO',
          note: 'Promovido a responsável principal.',
        },
      });
    await tx.ticket.update({ where: { id: ticketId }, data: { assigneeId: userId } });
    await tx.ticketEvent.create({
      data: {
        ticketId,
        actorId,
        targetUserId: userId,
        type: 'RESPONSAVEL_ALTERADO',
        metadata: { previousAssigneeId: ticket.assigneeId },
      },
    });
  });
}
export async function addComment(actorId: string, ticketId: string, content: string) {
  const text = z.string().trim().min(1, 'Escreva um comentário.').max(3000).parse(content);
  return db.$transaction(async (tx) => {
    const user = await actor(tx, actorId);
    const ticket = await lockedTicket(tx, ticketId);
    visible(user.role, user.id, ticket);
    const comment = await tx.ticketComment.create({
      data: { ticketId, authorId: actorId, content: text },
    });
    await tx.ticketEvent.create({
      data: { ticketId, actorId, type: 'COMENTARIO', metadata: { commentId: comment.id } },
    });
    return comment;
  });
}
