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
} from '../src/lib/stock-service';
import { updateUser } from '../src/lib/services';
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
