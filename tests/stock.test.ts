import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { syntheticCnpj, teamId } from './fixtures';
import { APP_ORGANIZATION_ID } from '../src/lib/config';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth-service';
import {
  parseQuantity,
  lockItem,
  applyMaterialMovement,
  createItem,
  updateItem,
  addEntry,
  adjustCount,
  takeTool,
  returnTool,
  deactivateItem,
  recordTicketUse,
  reverseMovement,
  ticketMaterials,
} from '../src/lib/stock-service';
import {
  updateUser,
  createTicket,
  claimTicket,
  setSupport,
  changeStatus,
} from '../src/lib/services';
import { formatQuantity } from '../src/lib/stock-labels';
import { Prisma, type Role } from '../src/generated/prisma/client';
const password = process.env.TEST_PASSWORD!;
const organizationId = APP_ORGANIZATION_ID;
let hash: string, tiTeam: string, departmentId: string, primaryCompanyId: string;
let admin: string, keeper: string, tech: string, manager: string, employee: string;
let electrician: string, eletricaTeam: string;
async function makeUser(role: Role, options = {}) {
  return db.user.create({
    data: {
      name: `Pessoa ${role}`,
      username: `test.${randomBytes(6).toString('hex')}`,
      organizationId,
      primaryCompanyId,
      departmentId,
      role,
      passwordHash: hash,
      mustChangePassword: false,
      ...(role === 'TI' && { teamId: tiTeam }),
      ...options,
    },
  });
}
const itemName = (prefix = 'Cabo') => `${prefix} ${randomBytes(4).toString('hex')}`;
async function material(min: string | null, saldo: string, unit = 'METRO') {
  const { item } = await createItem(keeper, {
    kind: 'MATERIAL',
    name: itemName(),
    teamId: tiTeam,
    unit,
    minimum: min,
    initialQuantity: saldo,
    requestId: randomUUID(),
  });
  return item;
}
const item = (id: string) => db.stockItem.findUniqueOrThrow({ where: { id } });
const alerts = (itemId: string) =>
  db.stockAlert.findMany({ where: { itemId }, orderBy: { openedAt: 'asc' } });
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/central_test_\d+_[a-f0-9]{8}$/);
  tiTeam = await teamId(organizationId, 'TI');
  primaryCompanyId = (
    await db.company.create({
      data: {
        organizationId,
        displayName: 'Local de estoque ' + randomBytes(4).toString('hex'),
        cnpj: syntheticCnpj(),
      },
    })
  ).id;
  departmentId = (await db.department.create({ data: { organizationId, name: 'Setor estoque' } }))
    .id;
  hash = await hashPassword(password);
  admin = (await makeUser('ADMIN')).id;
  keeper = (await makeUser('TI', { stockKeeper: true })).id;
  tech = (await makeUser('TI')).id;
  manager = (await makeUser('GESTOR')).id;
  employee = (await makeUser('FUNCIONARIO')).id;
  eletricaTeam = await teamId(organizationId, 'ELETRICA');
  electrician = (await makeUser('TI', { teamId: eletricaTeam })).id;
});
after(() => db.$disconnect());

test('parseQuantity aceita vírgula e ponto e recusa zero, negativo, notação científica e 4 casas', () => {
  assert.equal(parseQuantity('2,5').toString(), '2.5');
  assert.equal(parseQuantity(' 2.5 ').toString(), '2.5');
  assert.equal(parseQuantity('999999999,999').toString(), '999999999.999');
  const message = 'Informe uma quantidade maior que zero, com até 3 casas decimais.';
  for (const bad of ['0', '-1', '1e3', '2,5555', '', 'abc', '0,000', '1.000.000'])
    assert.throws(() => parseQuantity(bad), { message, status: 400 }, bad);
  assert.equal(parseQuantity('0', { allowZero: true }).toString(), '0');
  assert.throws(() => parseQuantity('-1', { allowZero: true }), /zero ou mais/);
  assert.equal(formatQuantity(new Prisma.Decimal('2.500'), 'METRO'), '2,5 metro');
  assert.equal(formatQuantity('-2.000'), '-2');
  assert.equal(formatQuantity('10', 'PACOTE'), '10 pacote');
});

test('só responsável ou ADMIN cadastra, dá entrada e ajusta; GESTOR e funcionário não', async () => {
  const tool = await createItem(admin, {
    kind: 'FERRAMENTA',
    name: itemName('Alicate'),
    teamId: tiTeam,
    requestId: randomUUID(),
  });
  assert.equal(tool.item.kind, 'FERRAMENTA');
  assert.equal(tool.item.unit, null);
  assert.equal(tool.movement, null);
  const target = await material('1', '3');
  const attempts = (actorId: string) => [
    () =>
      createItem(actorId, {
        kind: 'MATERIAL',
        name: itemName(),
        teamId: tiTeam,
        unit: 'UNIDADE',
        requestId: randomUUID(),
      }),
    () => addEntry(actorId, target.id, { quantity: '1', requestId: randomUUID() }),
    () =>
      adjustCount(actorId, target.id, {
        counted: '1',
        reason: 'Contagem física',
        requestId: randomUUID(),
      }),
  ];
  for (const [actorId, status] of [
    [tech, 403],
    [manager, 403],
    [employee, 404],
  ] as const)
    for (const attempt of attempts(actorId)) await assert.rejects(attempt(), { status });
  assert.equal((await item(target.id)).balance.toString(), '3');
  assert.equal(await db.stockMovement.count({ where: { itemId: target.id } }), 1);
  await addEntry(admin, target.id, { quantity: '1', requestId: randomUUID() });
  assert.equal((await item(target.id)).balance.toString(), '4');
});

test('material criado no mínimo abre alerta; entrada acima do mínimo encerra; nova queda abre outro', async () => {
  const created = await material('5', '5');
  const [opened] = await alerts(created.id);
  const entry = await db.stockMovement.findFirstOrThrow({ where: { itemId: created.id } });
  assert.equal(entry.type, 'ENTRADA');
  assert.equal(opened.openedByMovementId, entry.id);
  assert.equal(opened.closedAt, null);
  const restock = await addEntry(keeper, created.id, {
    quantity: '0,5',
    note: 'Compra',
    requestId: randomUUID(),
  });
  assert.equal(restock.balanceAfter?.toString(), '5.5');
  const [closed] = await alerts(created.id);
  assert.ok(closed.closedAt);
  assert.equal(closed.closedByMovementId, restock.id);
  await adjustCount(keeper, created.id, {
    counted: '2',
    reason: 'Contagem física',
    requestId: randomUUID(),
  });
  // Still at or below the minimum: the open alert stays the only one.
  await adjustCount(keeper, created.id, {
    counted: '1',
    reason: 'Nova contagem',
    requestId: randomUUID(),
  });
  const all = await alerts(created.id);
  assert.equal(all.length, 2);
  assert.equal(all.filter((a) => a.closedAt === null).length, 1);
  const noEntry = await createItem(keeper, {
    kind: 'MATERIAL',
    name: itemName(),
    teamId: tiTeam,
    unit: 'UNIDADE',
    minimum: '0',
    requestId: randomUUID(),
  });
  assert.equal(noEntry.movement, null);
  const [zero] = await alerts(noEntry.item.id);
  assert.equal(zero.openedByMovementId, null);
  const audit = await db.stockItemAudit.findFirstOrThrow({ where: { itemId: noEntry.item.id } });
  assert.equal(audit.action, 'CRIADO');
  assert.equal(audit.actorId, keeper);
});

test('alterar o mínimo reavalia o alerta nos dois sentidos', async () => {
  const target = await material('2', '5');
  const edit = (minimum: string | null) =>
    updateItem(keeper, target.id, { name: target.name, teamId: tiTeam, unit: 'METRO', minimum });
  assert.equal((await alerts(target.id)).length, 0);
  await edit('5');
  const [opened] = await alerts(target.id);
  assert.equal(opened.closedAt, null);
  assert.equal(opened.openedByMovementId, null);
  await edit('4,999');
  const [closed] = await alerts(target.id);
  assert.ok(closed.closedAt);
  assert.equal(closed.closedByMovementId, null);
  await edit('6');
  await edit(null);
  const all = await alerts(target.id);
  assert.equal(all.length, 2);
  assert.ok(all.every((a) => a.closedAt));
});

test('unidade fica fixa depois do primeiro movimento; edição grava auditoria', async () => {
  const name = itemName();
  const { item: created } = await createItem(keeper, {
    kind: 'MATERIAL',
    name: `  ${name}  `,
    teamId: tiTeam,
    unit: 'METRO',
    requestId: randomUUID(),
  });
  assert.equal(created.name, name);
  await assert.rejects(
    createItem(keeper, {
      kind: 'MATERIAL',
      name: 'X',
      teamId: tiTeam,
      unit: 'METRO',
      requestId: randomUUID(),
    }),
    { status: 400 },
  );
  await updateItem(keeper, created.id, { name, teamId: tiTeam, unit: 'ROLO' });
  assert.equal((await item(created.id)).unit, 'ROLO');
  await addEntry(keeper, created.id, { quantity: '1', requestId: randomUUID() });
  await assert.rejects(updateItem(keeper, created.id, { name, teamId: tiTeam, unit: 'CAIXA' }), {
    message: 'A unidade não pode mudar depois do primeiro movimento.',
  });
  const renamed = itemName('Conector');
  const eletrica = await teamId(organizationId, 'ELETRICA');
  await updateItem(admin, created.id, {
    name: renamed,
    teamId: eletrica,
    unit: 'ROLO',
    minimum: '1',
  });
  const audits = await db.stockItemAudit.findMany({
    where: { itemId: created.id, action: 'EDITADO' },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(audits.length, 2);
  assert.deepEqual(audits[0].metadata, { before: { unit: 'METRO' }, after: { unit: 'ROLO' } });
  assert.equal(audits[1].actorId, admin);
  assert.deepEqual(audits[1].metadata, {
    before: { name, teamId: tiTeam, minimum: null },
    after: { name: renamed, teamId: eletrica, minimum: '1' },
  });
});

test('ajuste de contagem corrige saldo, limpa conferir saldo e exige motivo', async () => {
  const target = await material(null, '5', 'UNIDADE');
  await db.$transaction(async (tx) => {
    const locked = await lockItem(tx, target.id, organizationId);
    const use = await applyMaterialMovement(
      tx,
      locked,
      { id: keeper, teamId: tiTeam },
      { type: 'USO_AVULSO', quantity: new Prisma.Decimal(7), delta: new Prisma.Decimal(-7) },
    );
    assert.equal(use.balanceAfter?.toString(), '-2');
    assert.equal(use.itemTeamId, tiTeam);
    assert.equal(use.actorTeamId, tiTeam);
  });
  assert.equal((await item(target.id)).needsCount, true);
  for (const reason of ['', '  ab ', 'x'.repeat(501)])
    await assert.rejects(
      adjustCount(keeper, target.id, { counted: '3', reason, requestId: randomUUID() }),
      { status: 400 },
    );
  await assert.rejects(
    adjustCount(keeper, target.id, {
      counted: '-1',
      reason: 'Contagem física',
      requestId: randomUUID(),
    }),
    /zero ou mais/,
  );
  const adjust = await adjustCount(keeper, target.id, {
    counted: '3,25',
    reason: ' Contagem física ',
    requestId: randomUUID(),
  });
  assert.equal(adjust.type, 'AJUSTE');
  assert.equal(adjust.quantity?.toString(), '3.25');
  assert.equal(adjust.delta?.toString(), '5.25');
  assert.equal(adjust.reason, 'Contagem física');
  let current = await item(target.id);
  assert.equal(current.balance.toString(), '3.25');
  assert.equal(current.needsCount, false);
  await db.stockItem.update({ where: { id: target.id }, data: { needsCount: true } });
  const same = await adjustCount(keeper, target.id, {
    counted: '3.25',
    reason: 'Conferido',
    requestId: randomUUID(),
  });
  assert.equal(same.delta?.toString(), '0');
  assert.equal(same.quantity?.toString(), '3.25');
  current = await item(target.id);
  assert.equal(current.needsCount, false);
  const zero = await adjustCount(keeper, target.id, {
    counted: '0',
    reason: 'Acabou',
    requestId: randomUUID(),
  });
  assert.equal(zero.balanceAfter?.toString(), '0');
});

test('item de outra organização responde 404 sem gravar movimento', async () => {
  const org = await db.organization.create({
    data: { name: 'Org estoque alheio ' + randomBytes(4).toString('hex') },
  });
  const foreign = await db.stockItem.create({
    data: {
      organizationId: org.id,
      teamId: await teamId(org.id, 'TI'),
      kind: 'MATERIAL',
      name: 'Cabo alheio',
      unit: 'METRO',
    },
  });
  await assert.rejects(addEntry(keeper, foreign.id, { quantity: '1', requestId: randomUUID() }), {
    status: 404,
  });
  await assert.rejects(
    adjustCount(admin, foreign.id, { counted: '1', reason: 'Contagem', requestId: randomUUID() }),
    { status: 404 },
  );
  await assert.rejects(
    updateItem(admin, foreign.id, { name: 'Novo nome', teamId: tiTeam, unit: 'METRO' }),
    { status: 404 },
  );
  await assert.rejects(
    createItem(admin, {
      kind: 'MATERIAL',
      name: itemName(),
      teamId: await teamId(org.id, 'TI'),
      unit: 'METRO',
      requestId: randomUUID(),
    }),
    /Selecione a equipe/,
  );
  assert.equal(await db.stockMovement.count({ where: { itemId: foreign.id } }), 0);
  assert.equal((await item(foreign.id)).balance.toString(), '0');
});

test('entrada repetida com o mesmo requestId grava um movimento só', async () => {
  const target = await material(null, '1');
  const requestId = randomUUID();
  const entry = { quantity: '2', requestId };
  const first = await addEntry(keeper, target.id, entry);
  const again = await addEntry(keeper, target.id, entry);
  assert.equal(again.id, first.id);
  const racing = randomUUID();
  const [a, b] = await Promise.all([
    addEntry(keeper, target.id, { quantity: '3', requestId: racing }),
    addEntry(keeper, target.id, { quantity: '3', requestId: racing }),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(await db.stockMovement.count({ where: { itemId: target.id } }), 3);
  assert.equal((await item(target.id)).balance.toString(), '6');
  await assert.rejects(addEntry(admin, target.id, entry), { status: 409 });
  await assert.rejects(addEntry(keeper, target.id, { quantity: '1', requestId: 'abc' }), {
    status: 400,
  });
  const createRequest = randomUUID();
  const input = {
    kind: 'MATERIAL',
    name: itemName(),
    teamId: tiTeam,
    unit: 'METRO',
    initialQuantity: '4',
    requestId: createRequest,
  };
  const created = await createItem(keeper, input);
  const replay = await createItem(keeper, input);
  assert.equal(replay.item.id, created.item.id);
  assert.equal(replay.movement?.id, created.movement?.id);
  assert.equal(await db.stockItem.count({ where: { name: input.name } }), 1);
  await assert.rejects(createItem(keeper, { ...input, requestId: randomUUID() }), {
    message: 'Já existe um item com este nome.',
  });
});

async function tool() {
  const { item } = await createItem(keeper, {
    kind: 'FERRAMENTA',
    name: itemName('Furadeira'),
    teamId: tiTeam,
    requestId: randomUUID(),
  });
  return item;
}
const toolMoves = (itemId: string) =>
  db.stockMovement.findMany({ where: { itemId }, orderBy: { sequence: 'asc' } });

test('dois técnicos pegando a mesma ferramenta ao mesmo tempo: só um consegue', async () => {
  const target = await tool();
  const results = await Promise.allSettled([
    takeTool(tech, target.id),
    takeTool(electrician, target.id),
  ]);
  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r) => r.status === 'rejected');
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.equal((lost[0] as PromiseRejectedResult).reason.status, 409);
  assert.equal(
    (lost[0] as PromiseRejectedResult).reason.message,
    'Esta ferramenta já está com outra pessoa. Atualize a página.',
  );
  const winner = results[0].status === 'fulfilled' ? tech : electrician;
  const moves = await toolMoves(target.id);
  assert.equal(moves.length, 1);
  const [take] = moves;
  assert.equal(take.type, 'RETIRADA');
  assert.equal(take.actorId, winner);
  assert.equal(take.quantity, null);
  assert.equal(take.delta, null);
  assert.equal(take.balanceAfter, null);
  assert.equal(take.itemTeamId, tiTeam);
  assert.equal(take.actorTeamId, winner === tech ? tiTeam : eletricaTeam);
  const held = await item(target.id);
  assert.equal(held.holderId, winner);
  assert.ok(held.heldSince);
  // A second tap by the holder is also refused.
  await assert.rejects(takeTool(winner, target.id), { status: 409 });
  await assert.rejects(takeTool(manager, target.id), { status: 403 });
  await assert.rejects(takeTool(employee, target.id), { status: 404 });
  const cable = await material(null, '1');
  await assert.rejects(takeTool(tech, cable.id), { status: 400 });
  const org = await db.organization.create({
    data: { name: 'Org ferramenta alheia ' + randomBytes(4).toString('hex') },
  });
  const foreign = await db.stockItem.create({
    data: {
      organizationId: org.id,
      teamId: await teamId(org.id, 'TI'),
      kind: 'FERRAMENTA',
      name: 'Alicate alheio',
    },
  });
  await assert.rejects(takeTool(tech, foreign.id), { status: 404 });
  await assert.rejects(returnTool(admin, foreign.id), { status: 404 });
  await assert.rejects(deactivateItem(admin, foreign.id, 'Quebrou'), { status: 404 });
  assert.equal(await db.stockMovement.count({ where: { itemId: foreign.id } }), 0);
  const untouched = await item(foreign.id);
  assert.equal(untouched.holderId, null);
  assert.equal(untouched.active, true);
});

test('só quem está com a ferramenta ou o responsável devolve; devolução registra de quem era', async () => {
  const target = await tool();
  await assert.rejects(returnTool(tech, target.id), { status: 409 });
  await takeTool(tech, target.id);
  const message = 'Só quem está com a ferramenta ou um responsável de estoque pode devolvê-la.';
  await assert.rejects(returnTool(electrician, target.id), { status: 403, message });
  await assert.rejects(returnTool(manager, target.id), { status: 403 });
  await assert.rejects(returnTool(employee, target.id), { status: 404 });
  assert.equal((await item(target.id)).holderId, tech);
  const own = await returnTool(tech, target.id);
  assert.equal(own.type, 'DEVOLUCAO');
  assert.equal(own.actorId, tech);
  assert.equal(own.targetUserId, tech);
  assert.equal(own.quantity, null);
  assert.equal(own.itemTeamId, tiTeam);
  assert.equal(own.actorTeamId, tiTeam);
  let current = await item(target.id);
  assert.equal(current.holderId, null);
  assert.equal(current.heldSince, null);
  await assert.rejects(returnTool(tech, target.id), { status: 409 });
  await takeTool(electrician, target.id);
  const byKeeper = await returnTool(keeper, target.id);
  assert.equal(byKeeper.actorId, keeper);
  assert.equal(byKeeper.targetUserId, electrician);
  await takeTool(tech, target.id);
  const byAdmin = await returnTool(admin, target.id);
  assert.equal(byAdmin.targetUserId, tech);
  assert.equal(byAdmin.actorTeamId, null);
  current = await item(target.id);
  assert.equal(current.holderId, null);
  const moves = await toolMoves(target.id);
  assert.deepEqual(
    moves.map((m) => m.type),
    ['RETIRADA', 'DEVOLUCAO', 'RETIRADA', 'DEVOLUCAO', 'RETIRADA', 'DEVOLUCAO'],
  );
  const cable = await material(null, '1');
  await assert.rejects(returnTool(keeper, cable.id), { status: 400 });
});

test('ferramenta de técnico desativado continua com ele e o responsável a devolve', async () => {
  const leaving = await makeUser('TI');
  const target = await tool();
  await takeTool(leaving.id, target.id);
  await updateUser(admin, leaving.id, {
    name: leaving.name,
    username: leaving.username,
    primaryCompanyId,
    departmentId,
    role: 'TI',
    teamId: tiTeam,
    active: false,
  });
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: leaving.id } })).active, false);
  const held = await item(target.id);
  assert.equal(held.holderId, leaving.id);
  assert.ok(held.heldSince);
  await assert.rejects(returnTool(leaving.id, target.id), { status: 401 });
  await assert.rejects(returnTool(tech, target.id), { status: 403 });
  const back = await returnTool(keeper, target.id);
  assert.equal(back.targetUserId, leaving.id);
  assert.equal(back.actorId, keeper);
  const current = await item(target.id);
  assert.equal(current.holderId, null);
  assert.equal(current.heldSince, null);
});

test('ferramenta desativada com motivo some da retirada e guarda o histórico', async () => {
  const target = await tool();
  await takeTool(tech, target.id);
  await assert.rejects(deactivateItem(tech, target.id, 'Quebrou'), { status: 403 });
  await assert.rejects(deactivateItem(manager, target.id, 'Quebrou'), { status: 403 });
  await assert.rejects(deactivateItem(employee, target.id, 'Quebrou'), { status: 404 });
  for (const reason of ['', ' ab ', 'x'.repeat(501)])
    await assert.rejects(deactivateItem(keeper, target.id, reason), { status: 400 });
  assert.equal((await item(target.id)).active, true);
  await deactivateItem(keeper, target.id, '  Quebrou na obra  ');
  const off = await item(target.id);
  assert.equal(off.active, false);
  assert.equal(off.deactivatedReason, 'Quebrou na obra');
  assert.equal(off.holderId, null);
  assert.equal(off.heldSince, null);
  const audit = await db.stockItemAudit.findFirstOrThrow({
    where: { itemId: target.id, action: 'DESATIVADO' },
  });
  assert.equal(audit.actorId, keeper);
  assert.deepEqual(audit.metadata, { reason: 'Quebrou na obra', holderId: tech });
  await assert.rejects(takeTool(electrician, target.id), { status: 409 });
  await assert.rejects(returnTool(keeper, target.id), { status: 409 });
  await assert.rejects(deactivateItem(admin, target.id, 'De novo'), { status: 409 });
  const moves = await toolMoves(target.id);
  assert.deepEqual(
    moves.map((m) => m.type),
    ['RETIRADA'],
  );
  assert.equal((await item(target.id)).holderId, null);
  // A material: deactivating closes its open alert and blocks new entries.
  const cable = await material('5', '2');
  assert.equal((await alerts(cable.id)).filter((a) => a.closedAt === null).length, 1);
  await deactivateItem(admin, cable.id, 'Fora de linha');
  const [closed] = await alerts(cable.id);
  assert.ok(closed.closedAt);
  assert.equal(closed.closedByMovementId, null);
  const audits = await db.stockItemAudit.findFirstOrThrow({
    where: { itemId: cable.id, action: 'DESATIVADO' },
  });
  assert.deepEqual(audits.metadata, { reason: 'Fora de linha', holderId: null });
  await assert.rejects(addEntry(keeper, cable.id, { quantity: '1', requestId: randomUUID() }), {
    message: 'Este material está desativado.',
  });
  assert.equal(await db.stockMovement.count({ where: { itemId: cable.id } }), 1);
});

const HOUR = 60 * 60 * 1000;
const deadlineMessage =
  'O prazo de 48 horas depois da resolução acabou. Registre como uso fora de chamado, com foto.';
const reverseDenied =
  'Só quem lançou, em até 24 horas, ou um responsável de estoque pode estornar.';
/** A TI ticket opened by the employee and claimed by `tech`. */
async function claimedTicket(team = tiTeam, assignee = tech) {
  const ticket = await createTicket(employee, {
    description: 'Tomada da sala de reunião sem energia.',
    impact: 'PARCIAL',
    teamId: team,
  });
  await claimTicket(assignee, ticket.id);
  return ticket;
}
const use = (actorId: string, ticketId: string, itemId: string, quantity = '1', requestId?: string) =>
  recordTicketUse(actorId, ticketId, { itemId, quantity, requestId: requestId ?? randomUUID() });
const reverse = (actorId: string, movementId: string, requestId?: string) =>
  reverseMovement(actorId, movementId, {
    reason: 'Lançado no chamado errado',
    requestId: requestId ?? randomUUID(),
  });

test('oito usos simultâneos não perdem baixa e o aviso dispara uma vez', async () => {
  const target = await material('2', '8');
  const ticket = await claimedTicket();
  assert.equal((await alerts(target.id)).length, 0);
  const moves = await Promise.all(
    Array.from({ length: 8 }, () => use(tech, ticket.id, target.id)),
  );
  assert.equal(new Set(moves.map((m) => m.id)).size, 8);
  const after = await item(target.id);
  assert.equal(after.balance.toString(), '0');
  assert.equal(after.needsCount, false);
  const uses = await db.stockMovement.findMany({
    where: { itemId: target.id, type: 'USO_CHAMADO' },
    orderBy: { sequence: 'asc' },
  });
  assert.equal(uses.length, 8);
  assert.deepEqual(
    uses.map((m) => m.balanceAfter?.toString()),
    ['7', '6', '5', '4', '3', '2', '1', '0'],
  );
  for (const m of uses) {
    assert.equal(m.ticketId, ticket.id);
    assert.equal(m.ticketTeamId, tiTeam);
    assert.equal(m.itemTeamId, tiTeam);
    assert.equal(m.actorTeamId, tiTeam);
    assert.equal(m.quantity?.toString(), '1');
    assert.equal(m.delta?.toString(), '-1');
  }
  const opened = await alerts(target.id);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].closedAt, null);
  assert.equal(opened[0].openedByMovementId, uses[5].id);
});

test('uso acima do saldo é aceito e marca conferir saldo', async () => {
  const target = await material(null, '1');
  const ticket = await claimedTicket();
  const moved = await use(tech, ticket.id, target.id, '3');
  assert.equal(moved.balanceAfter?.toString(), '-2');
  const after = await item(target.id);
  assert.equal(after.balance.toString(), '-2');
  assert.equal(after.needsCount, true);
  // Decimal input with a comma works too.
  await use(tech, ticket.id, target.id, '0,5');
  assert.equal((await item(target.id)).balance.toString(), '-2.5');
  for (const bad of ['0', '-1', 'abc', '2,5555'])
    await assert.rejects(use(tech, ticket.id, target.id, bad), { status: 400 });
});

test('apoio da outra equipe registra material no chamado; solicitante e técnico de fora não', async () => {
  const target = await material(null, '10');
  const ticket = await claimedTicket();
  await setSupport(tech, ticket.id, electrician, true);
  const outsider = (await makeUser('TI')).id;
  const supportMove = await use(electrician, ticket.id, target.id);
  assert.equal(supportMove.ticketTeamId, tiTeam);
  assert.equal(supportMove.actorTeamId, eletricaTeam);
  assert.equal(supportMove.itemTeamId, tiTeam);
  await use(admin, ticket.id, target.id);
  await use(tech, ticket.id, target.id);
  // Employee (even the requester) gets 404 everywhere; GESTOR has no ticket detail either.
  await assert.rejects(ticketMaterials(employee, ticket.id), { status: 404 });
  await assert.rejects(use(employee, ticket.id, target.id), { status: 404 });
  await assert.rejects(ticketMaterials(manager, ticket.id), { status: 404 });
  await assert.rejects(use(manager, ticket.id, target.id), { status: 403 });
  // Same-team technician who sees the ticket but is not in it.
  const seen = await ticketMaterials(outsider, ticket.id);
  assert.equal(seen.canRecord, false);
  assert.equal(seen.movements.length, 3);
  await assert.rejects(use(outsider, ticket.id, target.id), { status: 403 });
  const support = await ticketMaterials(electrician, ticket.id);
  assert.equal(support.canRecord, true);
  assert.deepEqual(
    support.movements.map((m) => [m.id, m.reversed]),
    (
      await db.stockMovement.findMany({
        where: { ticketId: ticket.id },
        orderBy: { sequence: 'asc' },
      })
    ).map((m) => [m.id, false]),
  );
  const listed = support.materials.find((m) => m.id === target.id);
  assert.deepEqual(listed, { id: target.id, name: target.name, unit: 'METRO', teamName: 'TI' });
  assert.equal((await ticketMaterials(admin, ticket.id)).canRecord, true);
  // Removing the support removes access at once.
  await setSupport(tech, ticket.id, electrician, false);
  await assert.rejects(ticketMaterials(electrician, ticket.id), { status: 404 });
  await assert.rejects(use(electrician, ticket.id, target.id), { status: 404 });
  // Another team's ticket and an unknown ticket are 404 for a technician.
  const eletricaTicket = await claimedTicket(eletricaTeam, electrician);
  await assert.rejects(ticketMaterials(tech, eletricaTicket.id), { status: 404 });
  await assert.rejects(use(tech, eletricaTicket.id, target.id), { status: 404 });
  await assert.rejects(use(admin, 'chamado-inexistente', target.id), { status: 404 });
  // Tools, inactive materials and items that do not exist.
  const drill = await tool();
  await assert.rejects(use(tech, ticket.id, drill.id), { message: 'Este item não é um material.' });
  const old = await material(null, '5');
  await deactivateItem(keeper, old.id, 'Fora de linha');
  await assert.rejects(use(tech, ticket.id, old.id), { message: 'Este material está desativado.' });
  await assert.rejects(use(tech, ticket.id, 'item-inexistente'), { status: 404 });
  assert.ok(!support.materials.some((m) => m.id === old.id || m.id === drill.id));
  assert.equal((await item(target.id)).balance.toString(), '7');
  assert.equal(await db.stockMovement.count({ where: { ticketId: ticket.id } }), 3);
});

test('material esquecido: até 48 h depois de resolver vale; depois, não', async () => {
  const target = await material(null, '10');
  const ticket = await claimedTicket();
  await changeStatus(tech, ticket.id, { status: 'RESOLVIDO', note: 'Tomada trocada.' });
  await use(tech, ticket.id, target.id);
  await db.ticket.update({
    where: { id: ticket.id },
    data: { resolvedAt: new Date(Date.now() - 47 * HOUR) },
  });
  await use(tech, ticket.id, target.id);
  assert.equal((await ticketMaterials(tech, ticket.id)).canRecord, true);
  await db.ticket.update({
    where: { id: ticket.id },
    data: { resolvedAt: new Date(Date.now() - 49 * HOUR) },
  });
  await assert.rejects(use(tech, ticket.id, target.id), { message: deadlineMessage, status: 400 });
  await assert.rejects(use(admin, ticket.id, target.id), { message: deadlineMessage });
  assert.equal((await ticketMaterials(tech, ticket.id)).canRecord, false);
  assert.equal((await item(target.id)).balance.toString(), '8');
});

test('toque duplo com o mesmo requestId grava um movimento só', async () => {
  const target = await material(null, '5');
  const ticket = await claimedTicket();
  const requestId = randomUUID();
  const first = await use(tech, ticket.id, target.id, '1', requestId);
  const again = await use(tech, ticket.id, target.id, '1', requestId);
  assert.equal(again.id, first.id);
  const racing = randomUUID();
  const [a, b] = await Promise.all([
    use(tech, ticket.id, target.id, '1', racing),
    use(tech, ticket.id, target.id, '1', racing),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(await db.stockMovement.count({ where: { ticketId: ticket.id } }), 2);
  assert.equal((await item(target.id)).balance.toString(), '3');
  // The same form sent by another person is refused.
  await setSupport(tech, ticket.id, electrician, true);
  await assert.rejects(use(electrician, ticket.id, target.id, '1', requestId), { status: 409 });
  // A double tap on "Estornar" also writes one reversal.
  const reversal = randomUUID();
  const [r1, r2] = await Promise.all([
    reverse(tech, first.id, reversal),
    reverse(tech, first.id, reversal),
  ]);
  assert.equal(r1.id, r2.id);
  assert.equal((await reverse(tech, first.id, reversal)).id, r1.id);
  assert.equal(await db.stockMovement.count({ where: { reversesId: first.id } }), 1);
  assert.equal((await item(target.id)).balance.toString(), '4');
});

test('estorno devolve o saldo, encerra o alerta aberto por engano e não se repete', async () => {
  const target = await material('2', '3');
  const ticket = await claimedTicket();
  const mistaken = await use(tech, ticket.id, target.id, '2');
  const [opened] = await alerts(target.id);
  assert.equal(opened.closedAt, null);
  for (const reason of ['', ' ab ', 'x'.repeat(501)])
    await assert.rejects(
      reverseMovement(tech, mistaken.id, { reason, requestId: randomUUID() }),
      { status: 400 },
    );
  const estorno = await reverse(tech, mistaken.id);
  assert.equal(estorno.type, 'ESTORNO');
  assert.equal(estorno.reversesId, mistaken.id);
  assert.equal(estorno.quantity?.toString(), '2');
  assert.equal(estorno.delta?.toString(), '2');
  assert.equal(estorno.balanceAfter?.toString(), '3');
  assert.equal(estorno.reason, 'Lançado no chamado errado');
  assert.equal(estorno.ticketId, null);
  assert.equal((await item(target.id)).balance.toString(), '3');
  const [closed] = await alerts(target.id);
  assert.ok(closed.closedAt);
  assert.equal(closed.closedByMovementId, estorno.id);
  const listed = await ticketMaterials(tech, ticket.id);
  assert.deepEqual(
    listed.movements.map((m) => [m.id, m.reversed]),
    [[mistaken.id, true]],
  );
  await assert.rejects(reverse(keeper, mistaken.id), {
    message: 'Este lançamento já foi estornado.',
    status: 409,
  });
  // Two different reversal forms at the same time: one wins, the other gets 409.
  const second = await use(tech, ticket.id, target.id, '1');
  const results = await Promise.allSettled([reverse(tech, second.id), reverse(keeper, second.id)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const [failed] = results.filter((r) => r.status === 'rejected');
  assert.equal(failed.reason.message, 'Este lançamento já foi estornado.');
  assert.equal(failed.reason.status, 409);
  assert.equal(await db.stockMovement.count({ where: { reversesId: second.id } }), 1);
  assert.equal((await item(target.id)).balance.toString(), '3');
  // An entry can be reversed by a keeper; reversals, adjustments and tool moves cannot.
  const entry = await addEntry(keeper, target.id, { quantity: '4', requestId: randomUUID() });
  const back = await reverse(keeper, entry.id);
  assert.equal(back.delta?.toString(), '-4');
  assert.equal((await item(target.id)).balance.toString(), '3');
  await assert.rejects(reverse(admin, estorno.id), { status: 400 });
  const adjust = await adjustCount(keeper, target.id, {
    counted: '3',
    reason: 'Contagem física',
    requestId: randomUUID(),
  });
  await assert.rejects(reverse(admin, adjust.id), { status: 400 });
  const drill = await tool();
  const taken = await takeTool(tech, drill.id);
  await assert.rejects(reverse(admin, taken.id), { status: 400 });
  // Not for employees, GESTOR, unknown or foreign movements.
  const fresh = await use(tech, ticket.id, target.id, '1');
  await assert.rejects(reverse(employee, fresh.id), { status: 404 });
  await assert.rejects(reverse(manager, fresh.id), { status: 403 });
  await assert.rejects(reverse(admin, 'movimento-inexistente'), { status: 404 });
  const org = await db.organization.create({
    data: { name: 'Org estorno alheio ' + randomBytes(4).toString('hex') },
  });
  const foreignTeam = await teamId(org.id, 'TI');
  const foreignUser = await db.user.create({
    data: {
      departmentId: (await db.department.create({ data: { organizationId: org.id, name: 'Setor alheio' } })).id,
      name: 'Pessoa alheia',
      username: `test.${randomBytes(6).toString('hex')}`,
      organizationId: org.id,
      role: 'ADMIN',
      passwordHash: hash,
      mustChangePassword: false,
    },
  });
  const foreignItem = await db.stockItem.create({
    data: {
      organizationId: org.id,
      teamId: foreignTeam,
      kind: 'MATERIAL',
      name: 'Cabo alheio',
      unit: 'METRO',
      balance: 5,
    },
  });
  const foreignMove = await db.stockMovement.create({
    data: {
      organizationId: org.id,
      itemId: foreignItem.id,
      type: 'ENTRADA',
      quantity: 5,
      delta: 5,
      balanceAfter: 5,
      actorId: foreignUser.id,
      itemTeamId: foreignTeam,
    },
  });
  await assert.rejects(reverse(admin, foreignMove.id), { status: 404 });
  assert.equal(await db.stockMovement.count({ where: { itemId: foreignItem.id } }), 1);
  assert.equal((await item(foreignItem.id)).balance.toString(), '5');
});

test('autor estorna até 24 h; depois só o responsável', async () => {
  const target = await material(null, '10');
  const ticket = await claimedTicket();
  await setSupport(tech, ticket.id, electrician, true);
  const recent = await use(tech, ticket.id, target.id);
  const old = await use(tech, ticket.id, target.id);
  await db.stockMovement.update({
    where: { id: old.id },
    data: { createdAt: new Date(Date.now() - 25 * HOUR) },
  });
  // Another technician (not the author, not a keeper) never reverses.
  await assert.rejects(reverse(electrician, recent.id), { message: reverseDenied, status: 403 });
  await assert.rejects(reverse(tech, old.id), { message: reverseDenied, status: 403 });
  await reverse(tech, recent.id);
  await reverse(keeper, old.id);
  const authored = await use(electrician, ticket.id, target.id);
  await db.stockMovement.update({
    where: { id: authored.id },
    data: { createdAt: new Date(Date.now() - 30 * 24 * HOUR) },
  });
  await reverse(admin, authored.id);
  assert.equal((await item(target.id)).balance.toString(), '10');
  assert.equal(
    await db.stockMovement.count({ where: { itemId: target.id, type: 'ESTORNO' } }),
    3,
  );
});
