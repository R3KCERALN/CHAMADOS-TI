import { z } from 'zod';
import { recordTicketEvent } from './ticket-events';
import { resolvePeriod } from './period';
import { db } from './db';
import { actor } from './access';
import { resolveLocation, validateUserLocations } from './organization-service';
import { AppError } from './errors';
import { requireTeam } from './teams';
import { hashPassword, passwordChangeThrottleKey, publicUserSelect } from './auth-service';
import { userSchema, ticketSchema, statusSchema, passwordSchema } from './validation';
import type { Prisma, Role, Ticket } from '@/generated/prisma/client';
type Tx = Prisma.TransactionClient;
const techRoles: Role[] = ['TI', 'ADMIN'];
export { actor } from './access';
export async function adminUsers(
  actorId: string,
  { q = '', page = 1 }: { q?: string; page?: number } = {},
) {
  const admin = await actor(db, actorId, ['ADMIN']);
  const term = q.trim().slice(0, 100);
  const where: Prisma.UserWhereInput = {
    organizationId: admin.organizationId,
    ...(term && {
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { username: { contains: term, mode: 'insensitive' } },
        { department: { name: { contains: term, mode: 'insensitive' } } },
      ],
    }),
  };
  const safePage = Math.max(1, Math.min(100000, Math.trunc(page) || 1));
  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      select: {
        ...publicUserSelect,
        createdAt: true,
        department: { select: { name: true } },
        team: { select: { name: true } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 20,
      skip: (safePage - 1) * 20,
    }),
    db.user.count({ where }),
  ]);
  return { users, total, page: safePage };
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
    const teamId =
      data.role === 'TI' ? (await requireTeam(tx, admin.organizationId, data.teamId)).id : null;
    const stockKeeper = data.role === 'TI' && !!data.stockKeeper;
    const user = await tx.user.create({
      data: {
        organizationId: admin.organizationId,
        teamId,
        stockKeeper,
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
        metadata: { role: data.role, departmentId: data.departmentId, teamId, stockKeeper },
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
    const teamId =
      data.role === 'TI' ? (await requireTeam(tx, admin.organizationId, data.teamId)).id : null;
    if (teamId) {
      const open = await tx.ticket.count({
        where: { assigneeId: userId, status: { not: 'RESOLVIDO' }, teamId: { not: teamId } },
      });
      if (open > 0)
        throw new AppError(
          `Transfira os ${open} chamado(s) em que esta pessoa é responsável antes de trocar a equipe.`,
        );
    }
    const { additionalCompanyIds, additionalUnitIds, ...fields } = data;
    const stockKeeper = data.role === 'TI' && !!data.stockKeeper;
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
        teamId,
        stockKeeper,
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
            teamId: before.teamId,
            active: before.active,
          },
          after: { ...data, teamId, stockKeeper },
        },
      },
    });
    if (stockKeeper !== before.stockKeeper)
      await tx.userAudit.create({
        data: {
          actorId,
          subjectId: userId,
          action: 'RESPONSAVEL_ESTOQUE_ALTERADO',
          metadata: { stockKeeper },
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
    // A fresh temporary password must not stay blocked by earlier failed change attempts.
    await tx.loginThrottle.deleteMany({ where: { key: passwordChangeThrottleKey(userId) } });
  });
}
export async function createTicket(actorId: string, input: unknown, requesterId?: string) {
  const data = ticketSchema.parse(input);
  return db.$transaction(async (tx) => {
    const quick = !!requesterId || !!data.quick || !!data.requesterName;
    // Quick service makes the author the assignee: same team-change lock as a claim.
    if (quick) await lockAssignee(tx, actorId);
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
    const team =
      quick && user.role === 'TI'
        ? await requireTeam(tx, user.organizationId, user.teamId)
        : await requireTeam(tx, user.organizationId, data.teamId);
    const occurredAt = new Date();
    const ticket = await tx.ticket.create({
      data: {
        description: data.description,
        impact: data.impact,
        organizationId: user.organizationId,
        teamId: team.id,
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
type Viewer = { id: string; role: Role; teamId: string | null };
// Read scope: ADMIN sees everything; a technician sees the own team's tickets plus the ones
// where they are support; the employee sees only the own requests; GESTOR has no detail.
export function canSee(user: Viewer, ticket: Ticket & { participants: { userId: string }[] }) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'TI')
    return (
      (!!user.teamId && ticket.teamId === user.teamId) ||
      ticket.participants.some((p) => p.userId === user.id)
    );
  return user.role === 'FUNCIONARIO' && ticket.requesterId === user.id;
}
function visible(user: Viewer, ticket: Ticket & { participants: { userId: string }[] }) {
  if (!canSee(user, ticket)) throw new AppError('Chamado não encontrado.', 404);
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
      team: { select: { id: true, key: true, name: true } },
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
  visible(user, ticket);
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
  // Queue views are the technician's team; "meus"/"apoio" already include support tickets of
  // the other team and the assignee views only match the technician's own tickets.
  if (
    user.role === 'TI' &&
    !['meus', 'apoio', 'atendimento', 'minha-espera', 'resolvidos-hoje'].includes(filter)
  )
    where.teamId = user.teamId ?? '';
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
        teamId: z.string().max(100).optional(),
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
    if (fields.teamId && user.role === 'ADMIN') where.teamId = fields.teamId;
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
        team: { select: { key: true, name: true } },
        assignee: { select: { name: true } },
      },
      // Triage queue: the oldest NOVO first; ties and every other list stay stable by id.
      orderBy:
        user.role !== 'FUNCIONARIO' && filter === 'novos'
          ? [{ createdAt: 'asc' }, { id: 'asc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
      skip: (safePage - 1) * 20,
    }),
    db.ticket.count({ where }),
  ]);
  return { tickets, total, page: safePage };
}
// Shared lock on the technician who becomes assignee: updateUser holds FOR UPDATE on that row
// while checking open tickets, so a team change cannot race a claim or a transfer.
async function lockAssignee(tx: Tx, userId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR SHARE`;
}
export async function claimTicket(actorId: string, ticketId: string) {
  return db.$transaction(async (tx) => {
    await lockAssignee(tx, actorId);
    const user = await actor(tx, actorId, techRoles);
    const occurredAt = new Date();
    const result = await tx.ticket.updateMany({
      where: {
        id: ticketId,
        organizationId: user.organizationId,
        status: 'NOVO',
        assigneeId: null,
        ...(user.role === 'TI' && { teamId: user.teamId ?? '' }),
      },
      data: { assigneeId: actorId, status: 'EM_ATENDIMENTO', startedAt: occurredAt },
    });
    if (result.count !== 1)
      throw new AppError('Este chamado já foi assumido por outro técnico. Atualize a página.', 409);
    // A ticket moved to another team keeps its supports; the principal is never also support.
    const removed = await tx.ticketParticipant.deleteMany({ where: { ticketId, userId: actorId } });
    if (removed.count)
      await recordTicketEvent(tx, {
        data: {
          ticketId,
          actorId,
          targetUserId: actorId,
          type: 'APOIO_REMOVIDO',
          createdAt: occurredAt,
          note: 'Assumiu como responsável principal.',
        },
      });
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
  const ticket = await tx.ticket.findFirst({
    where: { id: ticketId, organizationId },
    include: { participants: { select: { userId: true } } },
  });
  if (!ticket) throw new AppError('Chamado não encontrado.', 404);
  return ticket;
}
export async function changeStatus(actorId: string, ticketId: string, input: unknown) {
  const data = statusSchema.parse(input);
  return db.$transaction(async (tx) => {
    const user = await actor(tx, actorId, techRoles);
    const ticket = await lockedTicket(tx, ticketId, user.organizationId);
    visible(user, ticket);
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
    visible(user, ticket);
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
    visible(user, ticket);
    manages(user.role, actorId, ticket);
    if (!ticket.assigneeId || ticket.status === 'RESOLVIDO' || ticket.assigneeId === userId)
      throw new AppError('Não é possível transferir este chamado.');
    await lockAssignee(tx, userId);
    // The principal is an ADMIN (no team) or a technician of the ticket's team.
    if (
      !(await tx.user.findFirst({
        where: {
          id: userId,
          active: true,
          organizationId: user.organizationId,
          OR: [{ role: 'ADMIN' }, { role: 'TI', teamId: ticket.teamId }],
        },
      }))
    )
      throw new AppError('Selecione um técnico ativo da equipe do chamado.');
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
// A ticket opened in the wrong team goes back to the other team's queue as NOVO: the previous
// assignee, wait and category (which belongs to the old team) are cleared; supports stay.
export async function moveTicketTeam(
  actorId: string,
  ticketId: string,
  teamId: string,
): Promise<void> {
  return db.$transaction(async (tx) => {
    const user = await actor(tx, actorId, techRoles);
    const ticket = await lockedTicket(tx, ticketId, user.organizationId);
    visible(user, ticket);
    manages(user.role, user.id, ticket);
    const team = await requireTeam(tx, user.organizationId, teamId);
    if (team.id === ticket.teamId) throw new AppError('Este chamado já é desta equipe.', 409);
    if (ticket.status === 'RESOLVIDO')
      throw new AppError('Chamado resolvido não pode mudar de equipe.', 409);
    const occurredAt = new Date();
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        teamId: team.id,
        status: 'NOVO',
        assigneeId: null,
        startedAt: null,
        waitingReason: null,
        waitingNote: null,
        categoryId: null,
      },
    });
    await recordTicketEvent(tx, {
      data: {
        ticketId,
        actorId,
        type: 'EQUIPE_ALTERADA',
        createdAt: occurredAt,
        fromStatus: ticket.status,
        toStatus: 'NOVO',
        previousCategoryId: ticket.categoryId,
        nextCategoryId: null,
        metadata: {
          previousTeamId: ticket.teamId,
          nextTeamId: team.id,
          previousAssigneeId: ticket.assigneeId,
          previousCategoryId: ticket.categoryId,
        },
      },
    });
  });
}
export async function addComment(actorId: string, ticketId: string, content: string) {
  const text = z.string().trim().min(1, 'Escreva um comentário.').max(3000).parse(content);
  return db.$transaction(async (tx) => {
    const user = await actor(tx, actorId);
    const ticket = await lockedTicket(tx, ticketId, user.organizationId);
    visible(user, ticket);
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
      teamId: z.string().max(100).optional(),
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
    const team = await requireTeam(tx, admin.organizationId, data.teamId);
    return tx.category.create({
      data: {
        name: data.name,
        active: data.active,
        organizationId: admin.organizationId,
        teamId: team.id,
      },
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
    visible(user, ticket);
    if (
      data.categoryId &&
      data.categoryId !== ticket.categoryId &&
      !(await tx.category.findFirst({
        where: {
          id: data.categoryId,
          active: true,
          organizationId: user.organizationId,
          teamId: ticket.teamId,
        },
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
    visible(user, ticket);
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
