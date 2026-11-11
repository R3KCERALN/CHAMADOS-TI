import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createECDH } from 'node:crypto';
import { db } from '../src/lib/db';
import { APP_ORGANIZATION_ID } from '../src/lib/config';
import { hashPassword, login, logout, changePassword } from '../src/lib/auth-service';
import { saveSubscription, removeSubscription } from '../src/lib/push-subscriptions';
import { queueEventNotifications, recordTicketEvent } from '../src/lib/ticket-events';
import { dispatchPushBatch } from '../src/lib/push-worker';
import { operationalRevision } from '../src/lib/live-updates';
import { validPushEndpoint } from '../src/lib/push-config';
import { ticketReturnTo } from '../src/lib/return-to';
import * as service from '../src/lib/services';
import { syntheticCnpj, teamId } from './fixtures';
import type { Role } from '../src/generated/prisma/client';
const org = APP_ORGANIZATION_ID;
let employee: string, tech: string, support: string, other: string, admin: string, foreign: string;
let company: string, department: string, hash: string, tiTeam: string, eletricaTeam: string;
let eletricista: string, eletricista2: string;
const sessions = new Map<string, string>();
const password = process.env.TEST_PASSWORD!;
function subscription() {
  const key = createECDH('prime256v1');
  key.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(16).toString('hex')}`,
    expirationTime: null,
    keys: {
      p256dh: key.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}
async function person(
  role: Role,
  organizationId = org,
  departmentId = department,
  team: 'TI' | 'ELETRICA' = 'TI',
) {
  const user = await db.user.create({
    data: {
      organizationId,
      departmentId,
      role,
      name: `Push ${role}`,
      username: `push.${randomBytes(6).toString('hex')}`,
      passwordHash: hash,
      mustChangePassword: false,
      ...(role === 'TI' && { teamId: await teamId(organizationId, team) }),
      primaryCompanyId: organizationId === org ? company : null,
    },
  });
  return user.id;
}
async function subscribe(id: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id } });
  const session = await login(user.username, password);
  sessions.set(id, session.token);
  const input = subscription();
  const row = await saveSubscription(id, session.token, input);
  return { ...row, input };
}
const open = () =>
  service.createTicket(employee, {
    description: 'Problema confidencial não deve aparecer no push',
    impact: 'PARCIAL',
    teamId: tiTeam,
  });
async function makeDue() {
  await db.pushDelivery.updateMany({
    where: { status: 'PENDING' },
    data: { availableAt: new Date(0) },
  });
}
async function recipients(ticketId: string, type: string) {
  return (
    await db.pushDelivery.findMany({
      where: { event: { ticketId, type: type as 'CRIADO' } },
      include: { subscription: true },
    })
  )
    .map((d) => d.subscription.userId)
    .sort();
}
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/central_test_/);
  tiTeam = await teamId(org, 'TI');
  eletricaTeam = await teamId(org, 'ELETRICA');
  company = (
    await db.company.create({
      data: { organizationId: org, displayName: 'Filial Push', cnpj: syntheticCnpj() },
    })
  ).id;
  department = (
    await db.department.create({
      data: { organizationId: org, name: 'Push ' + randomBytes(4).toString('hex') },
    })
  ).id;
  hash = await hashPassword(password);
  [employee, tech, support, other, admin] = await Promise.all(
    (['FUNCIONARIO', 'TI', 'TI', 'FUNCIONARIO', 'ADMIN'] as Role[]).map((r) => person(r)),
  );
  [eletricista, eletricista2] = await Promise.all([
    person('TI', org, department, 'ELETRICA'),
    person('TI', org, department, 'ELETRICA'),
  ]);
  for (const id of [employee, tech, support, other, admin, eletricista, eletricista2])
    await subscribe(id);
  const foreignOrg = await db.organization.create({ data: { name: 'Outro cliente push' } });
  const dept = await db.department.create({
    data: { name: 'Outro', organizationId: foreignOrg.id },
  });
  foreign = await person('TI', foreignOrg.id, dept.id);
});
after(() => db.$disconnect());
test('subscription exige sessão do próprio usuário, rejeita mass assignment e suporta vários dispositivos', async () => {
  await assert.rejects(
    saveSubscription(employee, sessions.get(tech)!, subscription()),
    /Sessão inválida/,
  );
  await assert.rejects(
    saveSubscription(employee, sessions.get(employee)!, { ...subscription(), userId: tech }),
  );
  await assert.rejects(
    saveSubscription(employee, sessions.get(employee)!, {
      ...subscription(),
      organizationId: 'outro',
    }),
  );
  const input = subscription();
  const first = await saveSubscription(employee, sessions.get(employee)!, input);
  const again = await saveSubscription(employee, sessions.get(employee)!, input);
  assert.equal(first.id, again.id);
  const ticket = await open();
  await service.claimTicket(tech, ticket.id);
  await service.addComment(tech, ticket.id, 'Aviso para os dois dispositivos');
  assert.deepEqual(await recipients(ticket.id, 'COMENTARIO'), [employee, employee]);
  const row = await db.pushSubscription.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(row.userId, employee);
  assert.equal(row.organizationId, org);
  await assert.rejects(saveSubscription(tech, sessions.get(tech)!, input), /outra conta/);
  await removeSubscription(tech, { endpoint: input.endpoint });
  assert.ok(await db.pushSubscription.findUnique({ where: { id: first.id } }));
  await removeSubscription(employee, { endpoint: input.endpoint });
});
test('subscription não aceita endpoints arbitrários, HTTP, credenciais ou chaves inválidas', async () => {
  for (const endpoint of [
    'http://fcm.googleapis.com/x',
    'https://127.0.0.1/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://user@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:444/x',
  ])
    assert.equal(validPushEndpoint(endpoint), false);
  await assert.rejects(
    saveSubscription(employee, sessions.get(employee)!, {
      ...subscription(),
      keys: { p256dh: 'a', auth: 'a' },
    }),
  );
});
test('novo chamado normal notifica só os técnicos da equipe; autor, ADMIN e outra Organization não recebem', async () => {
  const ticket = await open();
  assert.equal(ticket.teamId, tiTeam);
  assert.deepEqual(await recipients(ticket.id, 'CRIADO'), [support, tech].sort());
  const own = await service.createTicket(tech, {
    description: 'Solicitação do próprio TI',
    impact: 'BAIXO',
    teamId: tiTeam,
    companyId: company,
  });
  assert.deepEqual(await recipients(own.id, 'CRIADO'), [support]);
});
test('chamado elétrico notifica só a Elétrica; mover avisa a nova equipe', async () => {
  const electric = await service.createTicket(employee, {
    description: 'Tomada em curto',
    impact: 'PARCIAL',
    teamId: eletricaTeam,
  });
  assert.deepEqual(await recipients(electric.id, 'CRIADO'), [eletricista, eletricista2].sort());
  const moved = await open();
  assert.deepEqual(await recipients(moved.id, 'CRIADO'), [support, tech].sort());
  await service.claimTicket(tech, moved.id);
  await service.moveTicketTeam(tech, moved.id, eletricaTeam);
  assert.deepEqual(
    await recipients(moved.id, 'EQUIPE_ALTERADA'),
    [eletricista, eletricista2].sort(),
  );
  await service.claimTicket(eletricista, moved.id);
  await service.moveTicketTeam(eletricista, moved.id, tiTeam);
  assert.deepEqual(
    await recipients(moved.id, 'EQUIPE_ALTERADA'),
    [eletricista, eletricista2, support, tech].sort(),
  );
});
test('atendimento rápido registrado ou textual não alerta toda a equipe nem cria conta', async () => {
  for (const textual of [false, true]) {
    const count = await db.user.count();
    const ticket = await service.createTicket(
      tech,
      {
        description: 'Atendimento rápido',
        impact: 'BAIXO',
        companyId: company,
        quick: true,
        requesterName: textual ? 'Operador caixa' : undefined,
      },
      textual ? undefined : employee,
    );
    assert.deepEqual(await recipients(ticket.id, 'CRIADO'), []);
    if (textual) {
      await service.addComment(tech, ticket.id, 'Atendimento concluído');
      await service.changeStatus(tech, ticket.id, { status: 'RESOLVIDO' });
      assert.deepEqual(await recipients(ticket.id, 'COMENTARIO'), []);
      assert.deepEqual(await recipients(ticket.id, 'RESOLVIDO'), []);
      assert.equal(await db.user.count(), count);
    }
  }
});
test('transferência, apoio, comentários e resolução usam destinatários corretos', async () => {
  const ticket = await open();
  await service.claimTicket(tech, ticket.id);
  await service.setSupport(tech, ticket.id, support, true);
  assert.deepEqual(await recipients(ticket.id, 'APOIO_ADICIONADO'), [support]);
  await service.addComment(employee, ticket.id, 'Ainda preciso de ajuda');
  assert.deepEqual(await recipients(ticket.id, 'COMENTARIO'), [support, tech].sort());
  await service.setSupport(tech, ticket.id, support, false);
  await service.assignTicket(tech, ticket.id, support);
  assert.deepEqual(await recipients(ticket.id, 'RESPONSAVEL_ALTERADO'), [support]);
  await service.addComment(support, ticket.id, 'Vamos verificar');
  const comments = await recipients(ticket.id, 'COMENTARIO');
  assert.ok(comments.includes(employee));
  await service.changeStatus(support, ticket.id, { status: 'RESOLVIDO' });
  assert.deepEqual(await recipients(ticket.id, 'RESOLVIDO'), [employee]);
});
test('enfileiramento é idempotente por evento e dispositivo', async () => {
  const ticket = await open();
  const event = await db.ticketEvent.findFirstOrThrow({
    where: { ticketId: ticket.id, type: 'CRIADO' },
  });
  await db.$transaction((tx) => queueEventNotifications(tx, event));
  await db.$transaction((tx) => queueEventNotifications(tx, event));
  assert.equal(await db.pushDelivery.count({ where: { eventId: event.id } }), 2);
});
test('rollback não produz revisão nem push e dispatch não vê evento ainda sem commit', async () => {
  await makeDue();
  await dispatchPushBatch(async () => {});
  while (await dispatchPushBatch(async () => {})) {
    /* drain fixtures */
  }
  const ticket = await open();
  await makeDue();
  while (await dispatchPushBatch(async () => {})) {
    /* drain creation */
  }
  const revision = await operationalRevision(tech);
  const count = await db.pushDelivery.count();
  await assert.rejects(
    db.$transaction(async (tx) => {
      await recordTicketEvent(tx, {
        data: { ticketId: ticket.id, actorId: tech, type: 'COMENTARIO' },
      });
      let sends = 0;
      await dispatchPushBatch(async () => {
        sends++;
      });
      assert.equal(sends, 0);
      throw new Error('rollback proposital');
    }),
    /rollback proposital/,
  );
  assert.equal(await operationalRevision(tech), revision);
  assert.equal(await db.pushDelivery.count(), count);
});
test('revisão operacional muda em todos os eventos, somente no escopo permitido', async () => {
  const unrelated = await operationalRevision(other),
    outside = await operationalRevision(foreign);
  let previous = await operationalRevision(tech);
  const changed = async () => {
    const current = await operationalRevision(tech);
    assert.notEqual(current, previous);
    previous = current;
  };
  const own = await operationalRevision(employee);
  const ticket = await open();
  await changed();
  await service.claimTicket(tech, ticket.id);
  await changed();
  await service.setSupport(tech, ticket.id, support, true);
  await changed();
  await service.setSupport(tech, ticket.id, support, false);
  await changed();
  await service.assignTicket(tech, ticket.id, support);
  await changed();
  await service.addComment(employee, ticket.id, 'Comentário');
  await changed();
  await service.changeStatus(support, ticket.id, {
    status: 'AGUARDANDO',
    waitingReason: 'USUARIO',
  });
  await changed();
  await service.changeStatus(support, ticket.id, { status: 'EM_ATENDIMENTO' });
  await changed();
  await service.changeStatus(support, ticket.id, { status: 'RESOLVIDO' });
  await changed();
  assert.notEqual(await operationalRevision(employee), own);
  assert.equal(await operationalRevision(other), unrelated);
  assert.equal(await operationalRevision(foreign), outside);
});
test('banco rejeita subscription e entrega de Organization incompatível', async () => {
  const foreignUser = await db.user.findUniqueOrThrow({ where: { id: foreign } });
  const input = subscription();
  await assert.rejects(
    db.pushSubscription.create({
      data: {
        userId: foreign,
        organizationId: org,
        endpoint: input.endpoint,
        endpointHash: randomBytes(32).toString('hex'),
        ...input.keys,
        sessionHash: 'irrelevante',
      },
    }),
  );
  const sub = await db.pushSubscription.create({
    data: {
      userId: foreign,
      organizationId: foreignUser.organizationId,
      endpoint: input.endpoint,
      endpointHash: randomBytes(32).toString('hex'),
      ...input.keys,
      sessionHash: 'irrelevante',
    },
  });
  const ticket = await open();
  const event = await db.ticketEvent.findFirstOrThrow({ where: { ticketId: ticket.id } });
  await assert.rejects(
    db.pushDelivery.create({ data: { eventId: event.id, subscriptionId: sub.id } }),
  );
  assert.ok(!(await recipients(ticket.id, 'CRIADO')).includes(foreign));
});
test('dispatcher concorrente envia uma vez, payload mínimo, e 410 desativa subscription', async () => {
  await makeDue();
  while (await dispatchPushBatch(async () => {})) {
    /* drain earlier fixtures */
  }
  const ticket = await open();
  await makeDue();
  const sent: string[] = [];
  const sender = async (_: unknown, payload: string) => {
    sent.push(payload);
  };
  await Promise.all([dispatchPushBatch(sender), dispatchPushBatch(sender)]);
  assert.equal(sent.length, 2);
  for (const payload of sent) {
    assert.ok(!payload.includes(ticket.description));
    assert.ok(!payload.includes('requester'));
    assert.equal(JSON.parse(payload).body, 'Filial Push');
    assert.equal(JSON.parse(payload).url, `/notificacoes/${ticket.id}`);
  }
  assert.equal(await dispatchPushBatch(sender), 0);
  await open();
  await makeDue();
  await dispatchPushBatch(async () => {
    throw { statusCode: 410 };
  });
  assert.equal(
    await db.pushSubscription.count({ where: { userId: { in: [tech, support] }, active: true } }),
    0,
  );
  for (const id of [tech, support])
    await db.pushSubscription.updateMany({ where: { userId: id }, data: { active: true } });
});
test('falha transitória agenda retry limitado e mudança de permissão cancela envio', async () => {
  await open();
  await makeDue();
  await dispatchPushBatch(async () => {
    throw { statusCode: 503 };
  });
  const pending = await db.pushDelivery.findMany({ where: { status: 'PENDING' } });
  assert.equal(pending.length, 2);
  assert.ok(pending.every((p) => p.attempts === 1 && p.availableAt > new Date()));
  await db.pushDelivery.updateMany({
    where: { status: 'PENDING' },
    data: { attempts: 4, availableAt: new Date(0) },
  });
  await dispatchPushBatch(async () => {
    throw { statusCode: 503 };
  });
  assert.equal(await db.pushDelivery.count({ where: { status: 'PENDING' } }), 0);
  await open();
  await makeDue();
  await db.user.update({ where: { id: tech }, data: { active: false } });
  let sends = 0;
  await dispatchPushBatch(async () => {
    sends++;
  });
  assert.equal(sends, 1);
  await db.user.update({ where: { id: tech }, data: { active: true } });
});
test('dispatcher cancela entrega quando o destinatário perde acesso pela equipe', async () => {
  await makeDue();
  while (await dispatchPushBatch(async () => {})) {
    /* drain earlier fixtures */
  }
  const ticket = await open();
  await makeDue();
  while (await dispatchPushBatch(async () => {})) {
    /* drain creation */
  }
  await service.claimTicket(tech, ticket.id);
  await service.setSupport(tech, ticket.id, eletricista, true);
  assert.deepEqual(await recipients(ticket.id, 'APOIO_ADICIONADO'), [eletricista]);
  await service.setSupport(tech, ticket.id, eletricista, false);
  await db.pushDelivery.updateMany({
    where: { event: { ticketId: ticket.id, type: 'APOIO_ADICIONADO' } },
    data: { availableAt: new Date(0) },
  });
  const sent: string[] = [];
  while (await dispatchPushBatch(async (_, payload) => void sent.push(payload))) {
    /* drain */
  }
  assert.deepEqual(sent, []);
  const delivery = await db.pushDelivery.findFirstOrThrow({
    where: { event: { ticketId: ticket.id, type: 'APOIO_ADICIONADO' } },
  });
  assert.equal(delivery.status, 'CANCELLED');
});
test('logout remove só os dispositivos da sessão; troca de senha desativa os demais', async () => {
  const user = await person('TI');
  const first = await subscribe(user);
  const token1 = sessions.get(user)!;
  const second = await subscribe(user);
  await logout(token1);
  assert.equal(await db.pushSubscription.count({ where: { id: first.id } }), 0);
  assert.equal(await db.pushSubscription.count({ where: { id: second.id, active: true } }), 1);
  await changePassword(user, password, 'nova-senha-push');
  assert.equal(await db.pushSubscription.count({ where: { id: second.id, active: true } }), 0);
});
test('registro concorrente com logout não deixa dispositivo vinculado à sessão encerrada', async () => {
  const id = await person('TI');
  await subscribe(id);
  const token = sessions.get(id)!;
  await Promise.allSettled([saveSubscription(id, token, subscription()), logout(token)]);
  assert.equal(await db.pushSubscription.count({ where: { userId: id } }), 0);
});
test('retorno do login aceita somente chamado local, sem open redirect', () => {
  assert.equal(ticketReturnTo('/chamados/abc123'), '/chamados/abc123');
  for (const path of [
    'https://evil.example',
    '//evil.example',
    '/admin/usuarios',
    '/chamados/../admin',
    'javascript:alert(1)',
  ])
    assert.equal(ticketReturnTo(path), '/');
});
