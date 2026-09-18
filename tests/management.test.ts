import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { db } from '../src/lib/db';
import { hashPassword, login, changePassword } from '../src/lib/auth-service';
import { passwordSchema } from '../src/lib/validation';
import {
  createUser,
  resetPassword,
  saveCategory,
  classifyTicket,
  createTicket,
  claimTicket,
  changeStatus,
  getTicket,
  listTickets,
} from '../src/lib/services';
import { overview, teamReport, technicianDetail, exportRows } from '../src/lib/analytics-service';
import { csvCell, csvRow } from '../src/lib/csv';
import { localMidnight, resolvePeriod } from '../src/lib/period';
import type { Role, EventType, TicketStatus, WaitingReason } from '../src/generated/prisma/client';
const now = new Date('2026-09-18T15:00:00Z');
const period = { periodo: 'personalizado', inicio: '2026-09-01', fim: '2026-09-30' };
let admin: string,
  manager: string,
  tech: string,
  tech2: string,
  employee: string,
  departmentId: string;
const id = () => randomBytes(8).toString('hex');
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/central_test_/);
  departmentId = (await db.department.create({ data: { name: `Base ${id()}` } })).id;
  const hash = await hashPassword('123456');
  [admin, manager, tech, tech2, employee] = await Promise.all(
    (['ADMIN', 'GESTOR', 'TI', 'TI', 'FUNCIONARIO'] as Role[]).map(
      async (role) =>
        (
          await db.user.create({
            data: {
              name: `Pessoa ${role} ${id()}`,
              username: `test.${id()}`,
              role,
              departmentId,
              passwordHash: hash,
              mustChangePassword: false,
            },
          })
        ).id,
    ),
  );
});
after(() => db.$disconnect());
async function fixture(options: { transfer?: boolean; support?: boolean; pending?: boolean } = {}) {
  const department = (await db.department.create({ data: { name: `Operação ${id()}` } })).id;
  const date = (h: number) => new Date(`2026-09-10T${String(h).padStart(2, '0')}:00:00Z`);
  const ticket = await db.ticket.create({
    data: {
      description: 'Atendimento de teste com períodos conhecidos.',
      requesterId: employee,
      departmentId: department,
      impact: 'PARCIAL',
      status: options.pending ? 'AGUARDANDO' : 'RESOLVIDO',
      createdAt: date(12),
      startedAt: date(13),
      resolvedAt: options.pending ? null : date(21),
      assigneeId: options.transfer ? tech2 : tech,
      waitingReason: options.pending ? 'FORNECEDOR' : null,
    },
  });
  const events: {
    type: EventType;
    at: number;
    from?: TicketStatus;
    to?: TicketStatus;
    reason?: WaitingReason;
    target?: string;
  }[] = [
    { type: 'CRIADO', at: 12, to: 'NOVO' },
    { type: 'ASSUMIDO', at: 13, from: 'NOVO', to: 'EM_ATENDIMENTO', target: tech },
    { type: 'AGUARDANDO', at: 14, from: 'EM_ATENDIMENTO', to: 'AGUARDANDO', reason: 'USUARIO' },
    { type: 'RETOMADO', at: 16, from: 'AGUARDANDO', to: 'EM_ATENDIMENTO' },
    { type: 'AGUARDANDO', at: 17, from: 'EM_ATENDIMENTO', to: 'AGUARDANDO', reason: 'FORNECEDOR' },
  ];
  if (!options.pending)
    events.push(
      { type: 'RETOMADO', at: 20, from: 'AGUARDANDO', to: 'EM_ATENDIMENTO' },
      { type: 'RESOLVIDO', at: 21, from: 'EM_ATENDIMENTO', to: 'RESOLVIDO' },
    );
  if (options.transfer) events.push({ type: 'RESPONSAVEL_ALTERADO', at: 18, target: tech2 });
  if (options.support)
    events.push(
      { type: 'APOIO_ADICIONADO', at: 14, target: tech2 },
      { type: 'APOIO_REMOVIDO', at: 16, target: tech2 },
    );
  for (const e of events.sort((a, b) => a.at - b.at))
    await db.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        actorId: e.type === 'CRIADO' ? employee : tech,
        type: e.type,
        createdAt: date(e.at),
        fromStatus: e.from,
        toStatus: e.to,
        waitingReason: e.reason,
        targetUserId: e.target,
      },
    });
  return { ticket, filters: { ...period, department }, date };
}
test('política aceita alfanumérico de seis caracteres e PIN numérico; rejeita menos de seis', () => {
  for (const p of ['allan01', 'senha123', '123456', '456789', '12345678'])
    assert.equal(passwordSchema.parse(p), p);
  for (const p of ['12345', 'abc12', '']) assert.equal(passwordSchema.safeParse(p).success, false);
});
test('senha/PIN de seis funciona em criação, reset e troca obrigatória com Argon2', async () => {
  const user = await createUser(admin, {
    name: 'Teste de senha',
    username: `pin.${id()}`,
    departmentId,
    role: 'FUNCIONARIO',
    password: '123456',
  });
  assert.equal((await login(user.username, '123456')).mustChangePassword, true);
  await changePassword(user.id, '123456', 'allan01');
  assert.equal((await login(user.username, 'allan01')).mustChangePassword, false);
  await resetPassword(admin, user.id, '456789');
  assert.equal((await login(user.username, '456789')).mustChangePassword, true);
  await assert.rejects(resetPassword(admin, user.id, '12345'));
  await assert.rejects(changePassword(user.id, '456789', '12345'));
});
test('TI atribui categoria e complexidade com eventos; funcionário não classifica', async () => {
  const category = await saveCategory(admin, { name: `Categoria ${id()}` });
  const ticket = await createTicket(employee, {
    description: 'Preciso configurar uma impressora.',
    impact: 'BAIXO',
  });
  await assert.rejects(
    classifyTicket(employee, ticket.id, { categoryId: category.id, complexity: 'ALTA' }),
    /permissão/,
  );
  await classifyTicket(tech, ticket.id, { categoryId: category.id, complexity: 'ALTA' });
  const result = await getTicket(tech, ticket.id);
  assert.equal(result.categoryId, category.id);
  assert.equal(result.complexity, 'ALTA');
  assert.equal(result.events.at(-2)?.nextCategoryId, category.id);
  assert.equal(result.events.at(-1)?.nextComplexity, 'ALTA');
  await saveCategory(admin, { id: category.id, name: category.name, active: false });
  assert.equal((await getTicket(tech, ticket.id)).category?.active, false);
  const next = await createTicket(employee, {
    description: 'Outra configuração.',
    impact: 'BAIXO',
  });
  await assert.rejects(
    classifyTicket(tech, next.id, { categoryId: category.id, complexity: 'BAIXA' }),
    /ativa/,
  );
  await assert.rejects(saveCategory(tech, { name: 'Categoria indevida' }), /permissão/);
  await assert.rejects(db.category.delete({ where: { id: category.id } }));
});
test('múltiplas esperas são somadas e excluídas do tempo ativo; média e mediana têm amostra explícita', async () => {
  const { filters } = await fixture();
  const data = await overview(manager, filters, now);
  assert.equal(data.summary.opened, 1);
  assert.equal(data.summary.resolved, 1);
  assert.equal(data.summary.response.median, 3600);
  assert.equal(data.summary.total.median, 9 * 3600);
  assert.equal(data.summary.active.median, 3 * 3600);
  assert.equal(data.summary.active.mean, 3 * 3600);
  assert.equal(data.summary.active.count, 1);
  const rows = await exportRows(manager, filters, now);
  assert.equal(rows[0].waiting_seconds, 5 * 3600);
  assert.equal(rows[0].active_seconds, 3 * 3600);
  assert.equal(rows[0].total_seconds, 9 * 3600);
});
test('motivos de espera contam chamados distintos e somam duração sem perder dados', async () => {
  const { filters } = await fixture();
  const data = await overview(manager, filters, now);
  assert.equal(data.waits.find((r) => r.name === 'USUARIO')?.seconds, 7200);
  assert.equal(data.waits.find((r) => r.name === 'FORNECEDOR')?.seconds, 10800);
  assert.equal(data.waits.find((r) => r.name === 'USUARIO')?.count, 1);
});
test('intervalo AGUARDANDO aberto fecha no instante de consulta e não entra nas medianas de resolvidos', async () => {
  const { filters, date } = await fixture({ pending: true });
  const data = await overview(manager, filters, now);
  const rows = await exportRows(manager, filters, now);
  assert.equal(rows[0].waiting_seconds, 7200 + (now.getTime() - date(17).getTime()) / 1000);
  assert.equal(rows[0].active_seconds, 7200);
  assert.equal(data.summary.active.count, 0);
  assert.equal(data.summary.pending, 1);
  assert.equal(data.summary.waiting, 1);
  const oldPeriod = await overview(
    manager,
    { ...filters, inicio: '2026-08-01', fim: '2026-08-31' },
    now,
  );
  assert.equal(oldPeriod.summary.opened, 0);
  assert.equal(oldPeriod.summary.pending, 1);
});
test('apoio removido permanece histórico e não recebe resolução principal', async () => {
  const { filters, ticket } = await fixture({ support: true });
  const team = await teamReport(manager, filters, now);
  const supporter = team.rows.find((t) => t.id === tech2)!;
  const principal = team.rows.find((t) => t.id === tech)!;
  assert.equal(supporter.support, 1);
  assert.equal(supporter.resolved, 0);
  assert.equal(supporter.principal, 0);
  assert.equal(principal.resolved, 1);
  const detail = await technicianDetail(manager, tech2, filters, now);
  assert.equal(detail.tickets[0].id, ticket.id);
  assert.equal(detail.tickets[0].support, true);
  assert.equal(detail.tickets[0].principal, false);
});
test('transferência preserva participações mas credita resolução apenas ao responsável final', async () => {
  const { filters, ticket } = await fixture({ transfer: true });
  const team = await teamReport(manager, filters, now);
  const first = team.rows.find((t) => t.id === tech)!,
    last = team.rows.find((t) => t.id === tech2)!;
  assert.equal(first.principal, 1);
  assert.equal(first.resolved, 0);
  assert.equal(last.principal, 1);
  assert.equal(last.resolved, 1);
  assert.equal(
    await db.ticketEvent.count({ where: { ticketId: ticket.id, type: 'RESPONSAVEL_ALTERADO' } }),
    1,
  );
  await db.user.update({ where: { id: tech2 }, data: { active: false } });
  assert.ok(
    (await teamReport(manager, filters, now)).rows.some((t) => t.id === tech2 && !t.active),
  );
  await db.user.update({ where: { id: tech2 }, data: { active: true } });
});
test('GESTOR e ADMIN consultam indicadores; TI e funcionário não acessam consultas nem exportação', async () => {
  const { filters } = await fixture();
  assert.ok((await overview(admin, filters, now)).summary);
  assert.ok((await overview(manager, filters, now)).summary);
  for (const user of [tech, employee]) {
    await assert.rejects(overview(user, filters, now), /permissão/);
    await assert.rejects(teamReport(user, filters, now), /permissão/);
    await assert.rejects(technicianDetail(user, tech2, filters, now), /permissão/);
    await assert.rejects(exportRows(user, filters, now), /permissão/);
  }
});
test('filtro de datas separa criação de resolução e CSV usa união sem duplicar', async () => {
  const { filters } = await fixture();
  const empty = await overview(
    manager,
    { ...filters, inicio: '2026-09-11', fim: '2026-09-12' },
    now,
  );
  assert.equal(empty.summary.opened, 0);
  assert.equal(empty.summary.resolved, 0);
  assert.equal(
    (await exportRows(manager, { ...filters, inicio: '2026-09-11', fim: '2026-09-12' }, now))
      .length,
    0,
  );
  assert.equal((await exportRows(manager, filters, now)).length, 1);
  const other = await overview(manager, { ...filters, technician: tech2 }, now);
  assert.equal(other.summary.opened, 0);
  assert.equal((await exportRows(manager, { ...filters, technician: tech2 }, now)).length, 0);
});
test('mediana PostgreSQL não é distorcida por um único ciclo muito longo', async () => {
  const { filters, ticket } = await fixture();
  const dept = filters.department;
  for (const hours of [1, 100])
    await db.ticket.create({
      data: {
        description: 'Ciclo para teste de mediana.',
        requesterId: employee,
        departmentId: dept,
        assigneeId: tech,
        status: 'RESOLVIDO',
        impact: 'BAIXO',
        createdAt: ticket.createdAt,
        startedAt: ticket.createdAt,
        resolvedAt: new Date(ticket.createdAt.getTime() + hours * 3600000),
      },
    });
  const data = await overview(manager, filters, now);
  assert.equal(data.summary.total.median, 9 * 3600);
  assert.equal(data.summary.total.mean, (110 * 3600) / 3);
  assert.equal(data.summary.incomplete, 2);
  assert.equal(data.summary.active.count, 1);
});
test('Hoje respeita virada do dia no fuso America/Belem, com fim exclusivo', () => {
  const p = resolvePeriod({ periodo: 'hoje' }, new Date('2026-09-18T02:30:00Z'), 'America/Belem');
  assert.equal(p.from, '2026-09-17');
  assert.equal(p.start.toISOString(), '2026-09-17T03:00:00.000Z');
  assert.equal(p.end.toISOString(), '2026-09-18T03:00:00.000Z');
  const prev = resolvePeriod(
    { periodo: 'anterior' },
    new Date('2026-03-01T04:00:00Z'),
    'America/Belem',
  );
  assert.equal(prev.from, '2026-02-01');
  assert.equal(prev.to, '2026-02-28');
  assert.throws(() =>
    resolvePeriod({ periodo: 'personalizado', inicio: '2026-02-30', fim: '2026-03-01' }, now),
  );
});
test('CSV escapa aspas, separadores, quebras e fórmulas; preserva português', async () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('A;B\nC'), '"A;B\nC"');
  assert.ok(csvCell('  +cmd').startsWith('"\''));
  const { filters } = await fixture();
  const rows = await exportRows(manager, filters, now);
  assert.ok(csvRow(rows[0]).includes('Sem categoria'));
});
test('filtros da fila consultam número, descrição e solicitante no servidor', async () => {
  const t = await createTicket(employee, {
    description: `Busca específica ${id()}`,
    impact: 'BLOQUEADO',
  });
  const result = await listTickets(tech, 'todos', 1, { q: `CS-${t.number}`, impact: 'BLOQUEADO' });
  assert.equal(result.total, 1);
  assert.equal(result.tickets[0].id, t.id);
  assert.equal(
    (await listTickets(tech, 'todos', 1, { q: t.description, impact: 'BAIXO' })).total,
    0,
  );
});
test('timeline e comentários são paginados no servidor', async () => {
  const t = await createTicket(employee, {
    description: 'Paginação de auditoria.',
    impact: 'BAIXO',
  });
  await db.ticketEvent.createMany({
    data: Array.from({ length: 35 }, () => ({
      ticketId: t.id,
      actorId: tech,
      type: 'COMENTARIO' as const,
    })),
  });
  const first = await getTicket(employee, t.id);
  assert.equal(first.events.length, 30);
  assert.equal(first._count.events, 36);
  const second = await getTicket(employee, t.id, 2);
  assert.equal(second.events.length, 6);
  assert.equal(second.events[0].type, 'CRIADO');
});

test('datas civis suportam horário de verão histórico sem deslocar o início do dia', () => {
  assert.equal(
    localMidnight('2018-11-04', 'America/Sao_Paulo').toISOString(),
    '2018-11-04T03:00:00.000Z',
  );
  assert.equal(
    localMidnight('2018-11-05', 'America/Sao_Paulo').toISOString(),
    '2018-11-05T02:00:00.000Z',
  );
});
test('espera recortada ao período mantém apenas a interseção e a idade mantém UTC explícito', async () => {
  const { filters, ticket } = await fixture({ pending: true });
  const narrowed = { ...filters, inicio: '2026-09-11', fim: '2026-09-11' };
  const result = await overview(manager, narrowed, now);
  assert.equal(result.waits.length, 1);
  assert.equal(result.waits[0].name, 'FORNECEDOR');
  assert.equal(result.waits[0].seconds, 86400);
  assert.equal(result.oldest[0].createdAt, ticket.createdAt.toISOString());
  assert.equal(result.summary.pending, 1);
  assert.equal(result.summary.opened, 0);
});
test('filtros combinados e paginação CSV por chave não duplicam chamados', async () => {
  const { filters, ticket } = await fixture();
  const category = await saveCategory(admin, { name: `Exportação ${id()}` });
  await classifyTicket(tech, ticket.id, { categoryId: category.id, complexity: 'CRITICA' });
  const combined = {
    ...filters,
    category: category.id,
    complexity: 'CRITICA',
    status: 'RESOLVIDO',
    technician: tech,
  };
  assert.equal((await overview(manager, combined, now)).summary.resolved, 1);
  const first = await exportRows(manager, combined, now, 0, 1);
  assert.equal(first.length, 1);
  assert.equal((await exportRows(manager, combined, now, first[0].number, 1)).length, 0);
  assert.equal((await exportRows(manager, { ...combined, complexity: 'BAIXA' }, now)).length, 0);
});

test('fluxo real de atendimento gera tempos confiáveis até a resolução', async () => {
  const ticket = await createTicket(employee, {
    description: 'Validar relógios no fluxo real.',
    impact: 'BAIXO',
  });
  await claimTicket(tech, ticket.id);
  await changeStatus(tech, ticket.id, { status: 'AGUARDANDO', waitingReason: 'USUARIO' });
  await changeStatus(tech, ticket.id, { status: 'EM_ATENDIMENTO' });
  await changeStatus(tech, ticket.id, { status: 'RESOLVIDO' });
  const instant = new Date();
  const result = await exportRows(manager, { periodo: 'hoje', department: departmentId }, instant);
  const row = result.find((r) => r.number === ticket.number)!;
  const detail = await getTicket(tech, ticket.id);
  assert.notEqual(
    row.active_seconds,
    null,
    JSON.stringify({
      created: detail.createdAt,
      resolved: detail.resolvedAt,
      events: detail.events.map((e) => ({
        type: e.type,
        at: e.createdAt,
        from: e.fromStatus,
        to: e.toStatus,
      })),
    }),
  );
  assert.notEqual(row.waiting_seconds, null);
  assert.ok(
    Math.abs(
      row.total_seconds! -
        row.active_seconds! -
        row.waiting_seconds! -
        (row.first_response!.getTime() - row.createdAt.getTime()) / 1000,
    ) < 0.00001,
  );
});

test('evento final registrado depois de resolvedAt não invalida intervalos antigos', async () => {
  const { filters, ticket } = await fixture();
  await db.ticketEvent.updateMany({
    where: { ticketId: ticket.id, type: 'RESOLVIDO' },
    data: { createdAt: new Date(ticket.resolvedAt!.getTime() + 3) },
  });
  const result = await overview(manager, filters, now);
  assert.equal(result.summary.incomplete, 0);
  assert.equal(result.summary.active.median, 10800);
});
