import { z } from 'zod';
import { recordTicketEvent } from './ticket-events';
import { resolvePeriod } from './period';
import { db } from './db';
import { actor } from './access';
import { resolveLocation, validateUserLocations } from './organization-service';
import { AppError } from './errors';
import { hashPassword, publicUserSelect } from './auth-service';
import { userSchema, ticketSchema, statusSchema, passwordSchema } from './validation';
import type { Prisma, Role, Ticket } from '@/generated/prisma/client';
type Tx = Prisma.TransactionClient;
const techRoles: Role[] = ['TI', 'ADMIN'];
export { actor } from './access';
export async function adminUsers(actorId: string) {
  const admin = await actor(db, actorId, ['ADMIN']);
  return db.user.findMany({
    where: { organizationId: admin.organizationId },
    select: { ...publicUserSelect, createdAt: true, department: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
}
export async function createUser(actorId: string, input: unknown) {
  const data = userSchema.extend({ password: passwordSchema }).parse(input);
  await actor(db, actorId, ['ADMIN']);
  const passwordHash = await hashPassword(data.password);
  return db.$transaction(async (tx) => {
    const admin = await actor(tx, actorId, ['ADMIN']);
    const department = await tx.department.findFirst({
      where: { id: data.departmentId, active: true, organizationId: admin.organizationId },
    });
    if (!department) throw new AppError('Setor inválido.');
    const locations = await validateUserLocations(tx, admin.organizationId, data);
    const user = await tx.user.create({
      data: {
        organizationId: admin.organizationId,
        primaryCompanyId: locations.primaryCompanyId,
        primaryUnitId: locations.primaryUnitId,
        companyAccess: {
          create: locations.additionalCompanyIds.map((companyId) => ({ companyId })),
        },
        unitAccess: { create: locations.additionalUnitIds.map((unitId) => ({ unitId })) },
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
    const admin = await actor(tx, actorId, ['ADMIN']);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const before = await tx.user.findUnique({ where: { id: userId } });
    if (!before || before.organizationId !== admin.organizationId)
      throw new AppError('Usuário não encontrado.', 404);
    if (actorId === userId && (!data.active || data.role !== 'ADMIN'))
      throw new AppError('Você não pode desativar ou remover seu próprio acesso de administrador.');
    if (before.role === 'ADMIN' && before.active && (!data.active || data.role !== 'ADMIN')) {
      if (
        (await tx.user.count({
          where: { role: 'ADMIN', active: true, organizationId: admin.organizationId },
        })) <= 1
      )
        throw new AppError('Mantenha pelo menos um administrador ativo.');
    }
    if (
      !(await tx.department.findFirst({
        where: { id: data.departmentId, active: true, organizationId: admin.organizationId },
      }))
    )
      throw new AppError('Setor inválido.');
    const { additionalCompanyIds, additionalUnitIds, ...fields } = data;
    const existingCompanies = await tx.userCompanyAccess.findMany({ where: { userId } });
    const existingUnits = await tx.userUnitAccess.findMany({ where: { userId } });
    const locations = await validateUserLocations(
      tx,
      admin.organizationId,
      {
        ...fields,
        primaryCompanyId:
          fields.primaryCompanyId === undefined ? before.primaryCompanyId : fields.primaryCompanyId,
        primaryUnitId:
          fields.primaryUnitId === undefined ? before.primaryUnitId : fields.primaryUnitId,
        additionalCompanyIds: additionalCompanyIds ?? existingCompanies.map((a) => a.companyId),
        additionalUnitIds: additionalUnitIds ?? existingUnits.map((a) => a.unitId),
      },
      {
        companyIds: [before.primaryCompanyId, ...existingCompanies.map((a) => a.companyId)].filter(
          (id): id is string => !!id,
        ),
        unitIds: [before.primaryUnitId, ...existingUnits.map((a) => a.unitId)].filter(
          (id): id is string => !!id,
        ),
        allowMissingCompany: !data.active && !before.primaryCompanyId,
      },
    );
    await tx.userCompanyAccess.deleteMany({ where: { userId } });
    await tx.userUnitAccess.deleteMany({ where: { userId } });
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        ...fields,
        primaryCompanyId: locations.primaryCompanyId,
        primaryUnitId: locations.primaryUnitId,
        companyAccess: {
          create: locations.additionalCompanyIds.map((companyId) => ({ companyId })),
        },
        unitAccess: { create: locations.additionalUnitIds.map((unitId) => ({ unitId })) },
      },
      select: publicUserSelect,
    });
    await tx.session.deleteMany({ where: { userId } });
    await tx.pushSubscription.updateMany({ where: { userId }, data: { active: false } });
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
    const admin = await actor(tx, actorId, ['ADMIN']);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    if (!(await tx.user.findFirst({ where: { id: userId, organizationId: admin.organizationId } })))
      throw new AppError('Usuário não encontrado.', 404);
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true },
    });
    await tx.session.deleteMany({ where: { userId } });
    await tx.pushSubscription.updateMany({ where: { userId }, data: { active: false } });
    await tx.userAudit.create({ data: { actorId, subjectId: userId, action: 'SENHA_REDEFINIDA' } });
  });
}
export async function createTicket(actorId: string, input: unknown, requesterId?: string) {
  const data = ticketSchema.parse(input);
  return db.$transaction(async (tx) => {
    const quick = !!requesterId || !!data.quick || !!data.requesterName;
    const user = await actor(tx, actorId, quick ? techRoles : ['FUNCIONARIO', 'TI', 'ADMIN']);
    const requester = requesterId
      ? await tx.user.findFirst({
          where: { id: requesterId, active: true, organizationId: user.organizationId },
          select: publicUserSelect,
        })
      : quick && data.requesterName
        ? null
        : user;
    if (requesterId && !requester) throw new AppError('Selecione um funcionário ativo.');
    if (quick && !requesterId && !data.requesterName)
      throw new AppError('Selecione uma pessoa ou informe o nome.');
    if (quick && !data.companyId && (!requester || !requester.primaryCompanyId))
      throw new AppError('Selecione a filial do atendimento.');
    const location = await resolveLocation(
      tx,
      user,
      { ...data, unitId: requester ? data.unitId : data.unitId || null },
      requester || undefined,
    );
    const occurredAt = new Date();
    const ticket = await tx.ticket.create({
      data: {
        description: data.description,
        impact: data.impact,
        organizationId: user.organizationId,
        ...location,
        openedByUserId: user.id,
        requesterId: requester?.id || null,
        requesterName: requester?.name || data.requesterName!,
        departmentId: requester?.departmentId || null,
        origin: quick ? 'ATENDIMENTO_RAPIDO' : 'PORTAL',
        status: quick ? 'EM_ATENDIMENTO' : 'NOVO',
        assigneeId: quick ? actorId : null,
        createdAt: occurredAt,
        startedAt: quick ? occurredAt : null,
      },
    });
    await recordTicketEvent(tx, {
      data: {
        ticketId: ticket.id,
        actorId,
        type: 'CRIADO',
        createdAt: occurredAt,
        toStatus: ticket.status,
        metadata: { origin: ticket.origin, requesterName: ticket.requesterName },
      },
    });
    if (quick)
      await recordTicketEvent(tx, {
        data: {
          ticketId: ticket.id,
          actorId,
          targetUserId: actorId,
          type: 'ASSUMIDO',
          createdAt: occurredAt,
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
export async function getTicket(
  actorId: string,
  ticketId: string,
  eventsPage = 1,
  commentsPage = 1,
) {
  const user = await actor(db, actorId);
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId, organizationId: user.organizationId },
    include: {
      requester: { select: { id: true, name: true } },
      openedByUser: { select: { id: true, name: true } },
      company: true,
      unit: true,
      department: true,
      category: true,
      _count: { select: { events: true, comments: true } },
      assignee: { select: { id: true, name: true } },
      participants: { include: { user: { select: { id: true, name: true, active: true } } } },
      events: {
        include: {
          actor: { select: { name: true } },
          targetUser: { select: { name: true } },
          previousCategory: true,
          nextCategory: true,
        },
        orderBy: { sequence: 'desc' },
        take: 30,
        skip: (Math.max(1, Math.trunc(eventsPage) || 1) - 1) * 30,
      },
      comments: {
        include: { author: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
        skip: (Math.max(1, Math.trunc(commentsPage) || 1) - 1) * 20,
      },
    },
  });
  if (!ticket) throw new AppError('Chamado não encontrado.', 404);
  visible(user.role, user.id, ticket);
  return { ...ticket, events: ticket.events.reverse(), comments: ticket.comments.reverse() };
}
export async function listTickets(
  actorId: string,
  filter = 'todos',
  page = 1,
  input: Record<string, string | undefined> = {},
) {
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
  if (user.role !== 'FUNCIONARIO') {
    if (filter === 'atendimento')
      Object.assign(where, { assigneeId: user.id, status: 'EM_ATENDIMENTO' });
    if (filter === 'minha-espera')
      Object.assign(where, { assigneeId: user.id, status: 'AGUARDANDO' });
    if (filter === 'apoio')
      Object.assign(where, {
        participants: { some: { userId: user.id } },
        status: { not: 'RESOLVIDO' },
      });
    if (filter === 'resolvidos-hoje') {
      const period = resolvePeriod({ periodo: 'hoje' });
      Object.assign(where, {
        assigneeId: user.id,
        resolvedAt: { gte: period.start, lt: period.end },
        status: 'RESOLVIDO',
      });
    }
    const fields = z
      .object({
        companyId: z.string().max(100).optional(),
        unitId: z.string().max(100).optional(),
        categoryId: z.string().max(100).optional(),
        departmentId: z.string().max(100).optional(),
        impact: z.enum(['BLOQUEADO', 'PARCIAL', 'BAIXO']).optional(),
        complexity: z.enum(['BAIXA', 'MEDIA', 'ALTA', 'CRITICA', 'none']).optional(),
        q: z.string().trim().max(200).optional(),
      })
      .parse(Object.fromEntries(Object.entries(input).filter(([, v]) => v)));
    if (fields.companyId) where.companyId = fields.companyId === 'none' ? null : fields.companyId;
    if (fields.unitId) where.unitId = fields.unitId === 'none' ? null : fields.unitId;
    if (fields.categoryId)
      where.categoryId = fields.categoryId === 'none' ? null : fields.categoryId;
    if (fields.departmentId) where.departmentId = fields.departmentId;
    if (fields.impact) where.impact = fields.impact;
    if (fields.complexity)
      where.complexity = fields.complexity === 'none' ? null : fields.complexity;
    if (fields.q) {
      const numeric = Number(fields.q.replace(/^CS-/i, ''));
      where.AND = [
        {
          OR: [
            { description: { contains: fields.q, mode: 'insensitive' } },
            { requesterName: { contains: fields.q, mode: 'insensitive' } },
            { requester: { name: { contains: fields.q, mode: 'insensitive' } } },
            ...(Number.isSafeInteger(numeric) && numeric > 0 && numeric <= 2147483647
              ? [{ number: numeric }]
              : []),
          ],
        },
      ];
    }
  }
  where.organizationId = user.organizationId;
  const safePage = Math.max(1, Math.min(100000, Math.trunc(page) || 1));
  const [tickets, total] = await Promise.all([
    db.ticket.findMany({
      where,
      include: {
        requester: { select: { name: true } },
        company: { select: { displayName: true } },
        unit: { select: { name: true } },
        department: { select: { name: true } },
        category: { select: { name: true } },
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
    const user = await actor(tx, actorId, techRoles);
    const occurredAt = new Date();
    const result = await tx.ticket.updateMany({
      where: {
        id: ticketId,
        organizationId: user.organizationId,
        status: 'NOVO',
        assigneeId: null,
      },
      data: { assigneeId: actorId, status: 'EM_ATENDIMENTO', startedAt: occurredAt },
    });
    if (result.count !== 1)
      throw new AppError('Este chamado já foi assumido por outro técnico. Atualize a página.', 409);
    await recordTicketEvent(tx, {
      data: {
        ticketId,
        actorId,
        targetUserId: actorId,
        type: 'ASSUMIDO',
        createdAt: occurredAt,
        fromStatus: 'NOVO',
        toStatus: 'EM_ATENDIMENTO',
      },
    });
  });
}
async function lockedTicket(tx: Tx, ticketId: string, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${ticketId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  const ticket = await tx.ticket.findFirst({ where: { id: ticketId, organizationId } });
  if (!ticket) throw new AppError('Chamado não encontrado.', 404);
  return ticket;
}
export async function changeStatus(actorId: string, ticketId: string, input: unknown) {
  const data = statusSchema.parse(input);
  return db.$transaction(async (tx) => {
    const user = await actor(tx, actorId, techRoles);
    const ticket = await lockedTicket(tx, ticketId, user.organizationId);
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
    const occurredAt = new Date();
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        status: data.status,
        waitingReason: data.status === 'AGUARDANDO' ? data.waitingReason : null,
        waitingNote: data.status === 'AGUARDANDO' ? data.note || null : null,
        resolvedAt: data.status === 'RESOLVIDO' ? occurredAt : null,
      },
    });
    await recordTicketEvent(tx, {
      data: {
        ticketId,
        actorId,
        type:
          data.status === 'RESOLVIDO'
            ? 'RESOLVIDO'
            : data.status === 'AGUARDANDO'
              ? 'AGUARDANDO'
              : 'RETOMADO',
        createdAt: occurredAt,
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
    const ticket = await lockedTicket(tx, ticketId, user.organizationId);
    manages(user.role, user.id, ticket);
    if (!ticket.assigneeId || ticket.status === 'RESOLVIDO')
      throw new AppError('O chamado precisa estar em atendimento ou aguardando.');
    if (userId === ticket.assigneeId)
      throw new AppError('O responsável principal já participa do chamado.');
    if (add) {
      if (
        !(await tx.user.findFirst({
          where: { id: userId, role: 'TI', active: true, organizationId: user.organizationId },
        }))
      )
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
    await recordTicketEvent(tx, {
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
    const ticket = await lockedTicket(tx, ticketId, user.organizationId);
    manages(user.role, actorId, ticket);
    if (!ticket.assigneeId || ticket.status === 'RESOLVIDO' || ticket.assigneeId === userId)
      throw new AppError('Não é possível transferir este chamado.');
    if (
      !(await tx.user.findFirst({
        where: { id: userId, active: true, role: 'TI', organizationId: user.organizationId },
      }))
    )
      throw new AppError('Selecione um técnico ativo.');
    const removed = await tx.ticketParticipant.deleteMany({ where: { ticketId, userId } });
    if (removed.count)
      await recordTicketEvent(tx, {
        data: {
          ticketId,
          actorId,
          targetUserId: userId,
          type: 'APOIO_REMOVIDO',
          note: 'Promovido a responsável principal.',
        },
      });
    await tx.ticket.update({ where: { id: ticketId }, data: { assigneeId: userId } });
    await recordTicketEvent(tx, {
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
    const ticket = await lockedTicket(tx, ticketId, user.organizationId);
    visible(user.role, user.id, ticket);
    const comment = await tx.ticketComment.create({
      data: { ticketId, authorId: actorId, content: text },
    });
    await recordTicketEvent(tx, {
      data: { ticketId, actorId, type: 'COMENTARIO', metadata: { commentId: comment.id } },
    });
    return comment;
  });
}

export async function saveCategory(actorId: string, input: unknown) {
  const data = z
    .object({
      id: z.string().optional(),
      name: z.string().trim().min(2).max(100),
      active: z.boolean().default(true),
    })
    .parse(input);
  return db.$transaction(async (tx) => {
    const admin = await actor(tx, actorId, ['ADMIN']);
    if (
      data.id &&
      !(await tx.category.findFirst({
        where: { id: data.id, organizationId: admin.organizationId },
      }))
    )
      throw new AppError('Categoria não encontrada.', 404);
    if (data.id)
      return tx.category.update({
        where: { id: data.id },
        data: { name: data.name, active: data.active },
      });
    return tx.category.create({
      data: { name: data.name, active: data.active, organizationId: admin.organizationId },
    });
  });
}
export async function classifyTicket(actorId: string, ticketId: string, input: unknown) {
  const data = z
    .object({
      categoryId: z.string().max(100).nullable(),
      complexity: z.enum(['BAIXA', 'MEDIA', 'ALTA', 'CRITICA']).nullable(),
    })
    .parse(input);
  return db.$transaction(async (tx) => {
    const user = await actor(tx, actorId, techRoles);
    const ticket = await lockedTicket(tx, ticketId, user.organizationId);
    if (
      data.categoryId &&
      data.categoryId !== ticket.categoryId &&
      !(await tx.category.findFirst({
        where: { id: data.categoryId, active: true, organizationId: user.organizationId },
      }))
    )
      throw new AppError('Selecione uma categoria ativa.');
    if (data.categoryId !== ticket.categoryId)
      await recordTicketEvent(tx, {
        data: {
          ticketId,
          actorId,
          type: 'CATEGORIA_ALTERADA',
          previousCategoryId: ticket.categoryId,
          nextCategoryId: data.categoryId,
        },
      });
    if (data.complexity !== ticket.complexity)
      await recordTicketEvent(tx, {
        data: {
          ticketId,
          actorId,
          type: 'COMPLEXIDADE_ALTERADA',
          previousComplexity: ticket.complexity,
          nextComplexity: data.complexity,
        },
      });
    return tx.ticket.update({ where: { id: ticketId }, data });
  });
}

export async function relocateTicket(actorId: string, ticketId: string, input: unknown) {
  const data = z
    .object({
      companyId: z.string().min(1).max(100),
      unitId: z.string().max(100).nullable().optional(),
    })
    .parse(input);
  return db.$transaction(async (tx) => {
    const user = await actor(tx, actorId, techRoles);
    const ticket = await lockedTicket(tx, ticketId, user.organizationId);
    const location = await resolveLocation(tx, user, { ...data, unitId: data.unitId || null });
    if (ticket.companyId === location.companyId && ticket.unitId === location.unitId) return;
    await tx.ticket.update({ where: { id: ticketId }, data: location });
    await recordTicketEvent(tx, {
      data: {
        ticketId,
        actorId,
        type: 'LOCALIZACAO_ALTERADA',
        metadata: {
          previousCompanyId: ticket.companyId,
          previousUnitId: ticket.unitId,
          ...location,
        },
      },
    });
  });
}
