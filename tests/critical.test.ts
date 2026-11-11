import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { syntheticCnpj, teamId } from './fixtures';
import { APP_ORGANIZATION_ID } from '../src/lib/config';
import { db } from '../src/lib/db';
import {
  hashPassword,
  login,
  logout,
  getSessionUser,
  changePassword,
} from '../src/lib/auth-service';
import * as service from '../src/lib/services';
import { AppError } from '../src/lib/errors';
import { ticketNumber } from '../src/lib/labels';
import type { Role } from '../src/generated/prisma/client';
const password = process.env.TEST_PASSWORD!;
let admin: string,
  employee: string,
  other: string,
  tech: string,
  tech2: string,
  eletricista: string,
  eletricista2: string,
  manager: string,
  departmentId: string,
  primaryCompanyId: string;
const organizationId = APP_ORGANIZATION_ID;
let hash: string, tiTeam: string, eletricaTeam: string;
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
      ...(role === 'TI' && { teamId: await teamId(organizationId, 'TI') }),
      ...options,
    },
  });
}
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/central_test_\d+_[a-f0-9]{8}$/);
  tiTeam = await teamId(organizationId, 'TI');
  eletricaTeam = await teamId(organizationId, 'ELETRICA');
  primaryCompanyId = (
    await db.company.create({
      data: {
        organizationId,
        displayName: 'Local de teste ' + randomBytes(4).toString('hex'),
        cnpj: syntheticCnpj(),
      },
    })
  ).id;
  departmentId = (await db.department.create({ data: { organizationId, name: 'Setor de teste' } }))
    .id;
  hash = await hashPassword(password);
  [admin, employee, other, tech, tech2, manager] = await Promise.all(
    (['ADMIN', 'FUNCIONARIO', 'FUNCIONARIO', 'TI', 'TI', 'GESTOR'] as Role[]).map(
      async (role) => (await makeUser(role)).id,
    ),
  );
  [eletricista, eletricista2] = await Promise.all(
    [1, 2].map(async () => (await makeUser('TI', { teamId: eletricaTeam })).id),
  );
});
after(() => db.$disconnect());
const newTicket = () =>
  service.createTicket(employee, {
    description: 'Meu computador não inicia.',
    impact: 'BLOQUEADO',
    teamId: tiTeam,
  });
test('login válido cria sessão server-side, guarda somente hash do token e logout revoga', async () => {
  const user = await db.user.findUniqueOrThrow({ where: { id: employee } });
  assert.match(user.passwordHash, /^\$argon2id\$/);
  const result = await login(user.username, password);
  assert.equal((await getSessionUser(result.token))?.id, employee);
  const session = await db.session.findFirstOrThrow({ where: { userId: employee } });
  assert.notEqual(session.tokenHash, result.token);
  await logout(result.token);
  assert.equal(await getSessionUser(result.token), null);
});
test('senha incorreta e usuário inexistente não fazem login', async () => {
  const user = await db.user.findUniqueOrThrow({ where: { id: employee } });
  await assert.rejects(login(user.username, 'SenhaErrada12345'), /inválidos/);
  await assert.rejects(login('inexistente', password), /inválidos/);
});
test('usuário inativo não faz login nem usa sessão antiga', async () => {
  const user = await makeUser('FUNCIONARIO');
  const session = await login(user.username, password);
  await service.updateUser(admin, user.id, {
    name: user.name,
    username: user.username,
    primaryCompanyId,
    departmentId,
    role: user.role,
    active: false,
  });
  await assert.rejects(login(user.username, password), /inválidos/);
  assert.equal(await getSessionUser(session.token), null);
});
test('sessão expirada não autentica', async () => {
  const user = await makeUser('FUNCIONARIO');
  const session = await login(user.username, password);
  await db.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(0) } });
  assert.equal(await getSessionUser(session.token), null);
});
test('troca obrigatória impede operações e nova senha revoga todas as sessões', async () => {
  const user = await makeUser('FUNCIONARIO', { mustChangePassword: true });
  const session = await login(user.username, password);
  await assert.rejects(
    service.createTicket(user.id, { description: 'Teste de acesso', impact: 'BAIXO' }),
    /sessão/,
  );
  const next = randomBytes(18).toString('hex');
  await changePassword(user.id, password, next);
  assert.equal(await getSessionUser(session.token), null);
  const result = await login(user.username, next);
  assert.equal(result.mustChangePassword, false);
});
test('funcionário não lê ou comenta chamado de outra pessoa (IDOR)', async () => {
  const ticket = await newTicket();
  await assert.rejects(service.getTicket(other, ticket.id), /não encontrado/);
  await assert.rejects(service.addComment(other, ticket.id, 'Intrusão'), /não encontrado/);
  const result = await service.listTickets(other);
  assert.ok(!result.tickets.some((t) => t.id === ticket.id));
});
test('somente ADMIN lista e cria usuários; role enviada não promove o autor', async () => {
  const input = {
    name: 'Nova pessoa',
    username: 'nova.pessoa',
    primaryCompanyId,
    departmentId,
    role: 'TI',
    teamId: await teamId(organizationId, 'TI'),
    password,
  };
  await assert.rejects(service.createUser(employee, input), /permissão/);
  await assert.rejects(service.adminUsers(employee), /permissão/);
  await assert.rejects(service.createUser(tech, input), /permissão/);
  const user = await service.createUser(admin, input);
  assert.equal(user.role, 'TI');
  assert.equal(user.mustChangePassword, true);
  assert.equal(
    await db.userAudit.count({ where: { subjectId: user.id, action: 'USUARIO_CRIADO' } }),
    1,
  );
});
test('técnico exige equipe ativa da própria organização; outros papéis não têm equipe', async () => {
  const base = {
    name: 'Pessoa com equipe',
    primaryCompanyId,
    departmentId,
    password,
  };
  const username = () => `equipe.${randomBytes(4).toString('hex')}`;
  await assert.rejects(
    service.createUser(admin, { ...base, username: username(), role: 'TI' }),
    /Selecione a equipe/,
  );
  const foreignOrg = await db.organization.create({ data: { name: 'Equipes de outra org' } });
  await assert.rejects(
    service.createUser(admin, {
      ...base,
      username: username(),
      role: 'TI',
      teamId: await teamId(foreignOrg.id, 'TI'),
    }),
    /Selecione a equipe/,
  );
  const eletrica = await teamId(organizationId, 'ELETRICA');
  const electrician = await service.createUser(admin, {
    ...base,
    username: username(),
    role: 'TI',
    teamId: eletrica,
  });
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: electrician.id } })).teamId,
    eletrica,
  );
  const employeeWithTeam = await service.createUser(admin, {
    ...base,
    username: username(),
    role: 'FUNCIONARIO',
    teamId: eletrica,
  });
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: employeeWithTeam.id } })).teamId,
    null,
  );
});
test('troca de equipe é bloqueada enquanto o técnico for responsável por chamados não resolvidos', async () => {
  const technician = await makeUser('TI');
  const ticket = await newTicket();
  await service.claimTicket(technician.id, ticket.id);
  const eletrica = await teamId(organizationId, 'ELETRICA');
  const change = (teamId: string) =>
    service.updateUser(admin, technician.id, {
      name: technician.name,
      username: technician.username,
      primaryCompanyId,
      departmentId,
      role: 'TI',
      teamId,
      active: true,
    });
  await assert.rejects(change(eletrica), /Transfira os 1 chamado/);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: technician.id } })).teamId,
    technician.teamId,
  );
  await service.changeStatus(technician.id, ticket.id, { status: 'RESOLVIDO', note: 'Feito.' });
  await change(eletrica);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: technician.id } })).teamId,
    eletrica,
  );
  const audit = await db.userAudit.findFirstOrThrow({
    where: { subjectId: technician.id, action: 'USUARIO_ATUALIZADO' },
    orderBy: { createdAt: 'desc' },
  });
  const metadata = audit.metadata as { before: { teamId: string }; after: { teamId: string } };
  assert.equal(metadata.before.teamId, technician.teamId);
  assert.equal(metadata.after.teamId, eletrica);
});
test('rebaixar técnico para funcionário limpa a equipe', async () => {
  const technician = await makeUser('TI');
  assert.ok(technician.teamId);
  await service.updateUser(admin, technician.id, {
    name: technician.name,
    username: technician.username,
    primaryCompanyId,
    departmentId,
    role: 'FUNCIONARIO',
    active: true,
  });
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: technician.id } })).teamId, null);
});
test('username é normalizado e duplicidade recusada', async () => {
  const input = {
    name: 'Nome duplicado',
    username: ' Nome.Unico ',
    primaryCompanyId,
    departmentId,
    role: 'FUNCIONARIO',
    password,
  };
  const user = await service.createUser(admin, input);
  assert.equal(user.username, 'nome.unico');
  await assert.rejects(service.createUser(admin, { ...input, username: 'nome.unico' }));
});
test('TI assume chamado e fluxo NOVO → EM_ATENDIMENTO → RESOLVIDO persiste histórico', async () => {
  const ticket = await newTicket();
  assert.equal(ticket.status, 'NOVO');
  await service.claimTicket(tech, ticket.id);
  await service.changeStatus(tech, ticket.id, { status: 'RESOLVIDO', note: 'Fonte substituída.' });
  const result = await service.getTicket(employee, ticket.id);
  assert.equal(result.status, 'RESOLVIDO');
  assert.equal(result.assigneeId, tech);
  assert.ok(result.startedAt);
  assert.ok(result.resolvedAt);
  assert.deepEqual(
    result.events.map((e) => e.type),
    ['CRIADO', 'ASSUMIDO', 'RESOLVIDO'],
  );
  assert.equal(result.events.at(-1)?.note, 'Fonte substituída.');
});
test('dois técnicos concorrentes: exatamente um assume e um evento é gravado', async () => {
  const ticket = await newTicket();
  const results = await Promise.allSettled([
    service.claimTicket(tech, ticket.id),
    service.claimTicket(tech2, ticket.id),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  const result = await service.getTicket(employee, ticket.id);
  assert.ok([tech, tech2].includes(result.assigneeId!));
  assert.equal(result.events.filter((e) => e.type === 'ASSUMIDO').length, 1);
});
test('funcionário e GESTOR não assumem; técnico não responsável não muda status', async () => {
  const ticket = await newTicket();
  await assert.rejects(service.claimTicket(employee, ticket.id), /permissão/);
  await assert.rejects(service.claimTicket(manager, ticket.id), /permissão/);
  await service.claimTicket(tech, ticket.id);
  await assert.rejects(
    service.changeStatus(tech2, ticket.id, { status: 'RESOLVIDO' }),
    /responsável/,
  );
  await assert.rejects(service.getTicket(manager, ticket.id), /não encontrado/);
});
test('espera exige motivo, retomada limpa motivo atual e preserva duração pelos eventos', async () => {
  const ticket = await newTicket();
  await service.claimTicket(tech, ticket.id);
  await assert.rejects(service.changeStatus(tech, ticket.id, { status: 'AGUARDANDO' }), /motivo/);
  await assert.rejects(
    service.changeStatus(tech, ticket.id, { status: 'AGUARDANDO', waitingReason: 'OUTRO' }),
    /motivo/,
  );
  await service.changeStatus(tech, ticket.id, {
    status: 'AGUARDANDO',
    waitingReason: 'PECA',
    note: 'Fonte solicitada.',
  });
  await service.changeStatus(tech, ticket.id, { status: 'EM_ATENDIMENTO' });
  const result = await service.getTicket(employee, ticket.id);
  assert.equal(result.waitingReason, null);
  assert.equal(result.status, 'EM_ATENDIMENTO');
  assert.equal(result.events.find((e) => e.type === 'AGUARDANDO')?.waitingReason, 'PECA');
  assert.equal(result.events.at(-1)?.type, 'RETOMADO');
});
test('apoio é relacional, distinto do responsável e adição/remoção são auditadas', async () => {
  const ticket = await newTicket();
  await service.claimTicket(tech, ticket.id);
  await assert.rejects(service.setSupport(tech, ticket.id, tech, true), /principal/);
  await service.setSupport(tech, ticket.id, tech2, true);
  let result = await service.getTicket(tech, ticket.id);
  assert.equal(result.assigneeId, tech);
  assert.equal(result.participants[0].userId, tech2);
  await service.setSupport(tech, ticket.id, tech2, false);
  result = await service.getTicket(tech, ticket.id);
  assert.equal(result.participants.length, 0);
  assert.deepEqual(
    result.events.slice(-2).map((e) => e.type),
    ['APOIO_ADICIONADO', 'APOIO_REMOVIDO'],
  );
});
test('transferência de técnico de apoio para principal preserva eventos', async () => {
  const ticket = await newTicket();
  await service.claimTicket(tech, ticket.id);
  await service.setSupport(tech, ticket.id, tech2, true);
  await service.assignTicket(tech, ticket.id, tech2);
  const result = await service.getTicket(employee, ticket.id);
  assert.equal(result.assigneeId, tech2);
  assert.equal(result.participants.length, 0);
  assert.equal(result.events.at(-1)?.type, 'RESPONSAVEL_ALTERADO');
});
test('comentário grava conteúdo, autor e evento na mesma transação', async () => {
  const ticket = await newTicket();
  await service.addComment(employee, ticket.id, 'Mais informações aqui.');
  const result = await service.getTicket(employee, ticket.id);
  assert.equal(result.comments[0].authorId, employee);
  assert.equal(result.events.at(-1)?.type, 'COMENTARIO');
});
test('atendimento rápido atribui técnico, solicitante, setor, origem e timestamps', async () => {
  const ticket = await service.createTicket(
    tech,
    { description: 'Ajuda por telefone.', impact: 'BAIXO' },
    employee,
  );
  assert.equal(ticket.status, 'EM_ATENDIMENTO');
  assert.equal(ticket.requesterId, employee);
  assert.equal(ticket.assigneeId, tech);
  assert.equal(ticket.departmentId, departmentId);
  assert.equal(ticket.origin, 'ATENDIMENTO_RAPIDO');
  assert.ok(ticket.startedAt);
  await assert.rejects(
    service.createTicket(employee, { description: 'Tentativa indevida.', impact: 'BAIXO' }, other),
    /permissão/,
  );
  assert.deepEqual(
    (await service.getTicket(employee, ticket.id)).events.map((e) => e.type),
    ['CRIADO', 'ASSUMIDO'],
  );
});
test('desativar preserva histórico e impede novos atendimentos para o usuário', async () => {
  const user = await makeUser('FUNCIONARIO');
  const ticket = await service.createTicket(user.id, {
    description: 'Preservar este registro.',
    impact: 'PARCIAL',
    teamId: tiTeam,
  });
  await service.updateUser(admin, user.id, {
    name: user.name,
    username: user.username,
    primaryCompanyId,
    departmentId,
    role: user.role,
    active: false,
  });
  const result = await service.getTicket(tech, ticket.id);
  assert.equal(result.requester!.name, user.name);
  assert.equal(result.events.length, 1);
  await assert.rejects(
    service.createTicket(tech, { description: 'Novo atendimento.', impact: 'BAIXO' }, user.id),
    /ativo/,
  );
});
test('reset administrativo revoga sessão e exige troca; admin não remove o próprio acesso', async () => {
  const user = await makeUser('FUNCIONARIO');
  const session = await login(user.username, password);
  await service.resetPassword(admin, user.id, randomBytes(18).toString('hex'));
  assert.equal(await getSessionUser(session.token), null);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).mustChangePassword,
    true,
  );
  const adm = await db.user.findUniqueOrThrow({ where: { id: admin } });
  await assert.rejects(
    service.updateUser(admin, admin, {
      name: adm.name,
      username: adm.username,
      organizationId,
      primaryCompanyId,
      departmentId,
      role: 'FUNCIONARIO',
      active: true,
    }),
    /próprio/,
  );
});
test('transição inválida não altera chamado nem cria evento', async () => {
  const ticket = await newTicket();
  await assert.rejects(
    service.changeStatus(admin, ticket.id, { status: 'RESOLVIDO' }),
    /transição/,
  );
  const result = await service.getTicket(admin, ticket.id);
  assert.equal(result.status, 'NOVO');
  assert.equal(result.events.length, 1);
});
test('limite de tentativas de login é persistente', async () => {
  const user = await makeUser('FUNCIONARIO');
  for (let i = 0; i < 10; i++)
    await assert.rejects(login(user.username, 'SenhaIncorreta123'), /inválidos/);
  await assert.rejects(login(user.username, password), /Muitas tentativas/);
});
test('limite por conta e IP não bloqueia login correto de outro IP', async () => {
  const user = await makeUser('FUNCIONARIO');
  for (let i = 0; i < 10; i++)
    await assert.rejects(login(user.username, 'SenhaIncorreta123', '192.0.2.1'), /inválidos/);
  await assert.rejects(login(user.username, 'SenhaIncorreta123', '192.0.2.1'), /Muitas tentativas/);
  await assert.rejects(login(user.username, password, '192.0.2.1'), /Muitas tentativas/);
  const session = await login(user.username, password, '192.0.2.2');
  assert.equal((await getSessionUser(session.token))?.id, user.id);
});
test('limite por conta e IP não é contornado trocando o host dentro da /64', async () => {
  const user = await makeUser('FUNCIONARIO');
  for (let i = 1; i <= 10; i++)
    await assert.rejects(
      login(user.username, 'SenhaIncorreta123', `2001:db8:1:2::${i}`),
      /inválidos/,
    );
  await assert.rejects(login(user.username, password, '2001:db8:1:2:ffff::1'), /Muitas tentativas/);
  const session = await login(user.username, password, '2001:db8:1:3::1');
  assert.equal((await getSessionUser(session.token))?.id, user.id);
});
test('limite global bloqueia tentativas distribuídas entre IPs', async () => {
  const user = await makeUser('FUNCIONARIO');
  for (let i = 1; i <= 50; i++)
    await assert.rejects(login(user.username, 'SenhaIncorreta123', `192.0.2.${i}`), /inválidos/);
  await assert.rejects(
    login(user.username, 'SenhaIncorreta123', '192.0.2.51'),
    /Muitas tentativas/,
  );
  await assert.rejects(login(user.username, password, '192.0.2.52'), /Muitas tentativas/);
});

const WRONG_PASSWORD = 'SenhaIncorreta123';
test('troca de senha limita tentativas da senha atual sem alterar a senha', async () => {
  const user = await makeUser('FUNCIONARIO');
  for (let i = 0; i < 10; i++)
    await assert.rejects(changePassword(user.id, WRONG_PASSWORD, 'NovaSenha123'), /incorreta/);
  await assert.rejects(changePassword(user.id, password, 'NovaSenha123'), /Muitas tentativas/);
  await login(user.username, password);
  // Findo o prazo, a própria pessoa volta a conseguir trocar.
  const key = createHash('sha256')
    .update(`${APP_ORGANIZATION_ID}:change-password:${user.id}`)
    .digest('hex');
  await db.loginThrottle.update({ where: { key }, data: { expiresAt: new Date(0) } });
  await changePassword(user.id, password, 'NovaSenha123');
  await login(user.username, 'NovaSenha123');
});
test('senha atual errada não calcula hash da senha nova', async (t) => {
  const user = await makeUser('FUNCIONARIO');
  const hashSpy = t.mock.method(argon2, 'hash');
  await assert.rejects(changePassword(user.id, WRONG_PASSWORD, 'NovaSenha123'), /incorreta/);
  assert.equal(hashSpy.mock.callCount(), 0);
});
test('senha nova inválida não consome tentativas da troca de senha', async () => {
  const user = await makeUser('FUNCIONARIO');
  for (let i = 0; i < 11; i++) await assert.rejects(changePassword(user.id, password, '12345'));
  await changePassword(user.id, password, 'NovaSenha123');
  await login(user.username, 'NovaSenha123');
});
test('troca de senha bem-sucedida zera o contador de tentativas', async () => {
  const user = await makeUser('FUNCIONARIO');
  for (let i = 0; i < 5; i++)
    await assert.rejects(changePassword(user.id, WRONG_PASSWORD, 'NovaSenha123'), /incorreta/);
  await changePassword(user.id, password, 'NovaSenha123');
  for (let i = 0; i < 10; i++)
    await assert.rejects(changePassword(user.id, WRONG_PASSWORD, 'OutraSenha123'), /incorreta/);
});
test('trocas simultâneas de senha: só uma vence e a senha atual deixa de valer', async () => {
  const user = await makeUser('FUNCIONARIO');
  const results = await Promise.allSettled([
    changePassword(user.id, password, 'NovaSenhaUm123'),
    changePassword(user.id, password, 'NovaSenhaDois123'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const winner = results[0].status === 'fulfilled' ? 'NovaSenhaUm123' : 'NovaSenhaDois123';
  await login(user.username, winner);
  await assert.rejects(login(user.username, password), /inválidos/);
});
test('lista de usuários do admin é paginada e busca no servidor por nome, username e setor', async () => {
  const marker = `Paginação ${randomBytes(4).toString('hex')}`;
  const sector = await db.department.create({
    data: { organizationId, name: `Setor ${randomBytes(4).toString('hex')}` },
  });
  const people = [];
  for (let i = 0; i < 23; i++)
    people.push(
      await makeUser('FUNCIONARIO', {
        name: `${marker} ${String(i).padStart(2, '0')}`,
        ...(i === 7 && { departmentId: sector.id }),
      }),
    );
  const first = await service.adminUsers(admin, { q: marker });
  const second = await service.adminUsers(admin, { q: marker, page: 2 });
  assert.equal(first.total, 23);
  assert.equal(first.users.length, 20);
  assert.equal(second.users.length, 3);
  assert.deepEqual(
    [...first.users, ...second.users].map((u) => u.name),
    people.map((u) => u.name),
  );
  const byUsername = await service.adminUsers(admin, { q: people[3].username.toUpperCase() });
  assert.deepEqual(
    byUsername.users.map((u) => u.id),
    [people[3].id],
  );
  const bySector = await service.adminUsers(admin, { q: sector.name.toLowerCase() });
  assert.deepEqual(
    bySector.users.map((u) => u.id),
    [people[7].id],
  );
  assert.equal((await service.adminUsers(admin, { q: marker, page: 999 })).page, 999);
  assert.equal((await service.adminUsers(admin, { q: `${marker} inexistente` })).total, 0);
  assert.equal((await service.adminUsers(admin, { page: -4 })).page, 1);
  await assert.rejects(service.adminUsers(employee, { q: marker }), /permissão/);
});

// Races run several rounds: one round can serialize by chance and hide a missing lock.
const RACE_ROUNDS = 6;
test('dois ADMINs desativando um ao outro ao mesmo tempo deixam um ADMIN ativo', async () => {
  for (let round = 0; round < RACE_ROUNDS; round++) {
    const org = await db.organization.create({ data: { name: `Org corrida ${round}` } });
    const sector = await db.department.create({
      data: { organizationId: org.id, name: 'Setor da corrida' },
    });
    const [a, b] = await Promise.all(
      [0, 1].map(() =>
        makeUser('ADMIN', {
          organizationId: org.id,
          departmentId: sector.id,
          primaryCompanyId: null,
        }),
      ),
    );
    const deactivate = (by: typeof a, target: typeof a) =>
      service.updateUser(by.id, target.id, {
        name: target.name,
        username: target.username,
        departmentId: sector.id,
        role: 'ADMIN',
        active: false,
      });
    const results = await Promise.allSettled([deactivate(a, b), deactivate(b, a)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, `rodada ${round}`);
    // The loser must be serialized and refused by the app, not aborted by a database deadlock.
    const refused = results.find((r) => r.status === 'rejected')!;
    assert.ok(refused.reason instanceof AppError, `rodada ${round}: ${refused.reason}`);
    assert.equal(
      await db.user.count({ where: { organizationId: org.id, role: 'ADMIN', active: true } }),
      1,
      `rodada ${round}`,
    );
  }
});
const eventTypes = async (ticketId: string) =>
  (await db.ticketEvent.findMany({ where: { ticketId }, orderBy: { sequence: 'asc' } })).map(
    (e) => e.type,
  );
test('resolver e transferir ao mesmo tempo: só uma ação vale e o histórico bate com o estado', async () => {
  for (let round = 0; round < RACE_ROUNDS; round++) {
    const ticket = await newTicket();
    await service.claimTicket(tech, ticket.id);
    const results = await Promise.allSettled([
      service.changeStatus(tech, ticket.id, { status: 'RESOLVIDO' }),
      service.assignTicket(admin, ticket.id, tech2),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, `rodada ${round}`);
    const final = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    const types = await eventTypes(ticket.id);
    if (results[0].status === 'fulfilled') {
      assert.equal(final.status, 'RESOLVIDO');
      assert.equal(final.assigneeId, tech);
      assert.deepEqual(types, ['CRIADO', 'ASSUMIDO', 'RESOLVIDO']);
    } else {
      assert.equal(final.status, 'EM_ATENDIMENTO');
      assert.equal(final.assigneeId, tech2);
      assert.equal(final.resolvedAt, null);
      assert.deepEqual(types, ['CRIADO', 'ASSUMIDO', 'RESPONSAVEL_ALTERADO']);
    }
  }
});
test('resolver e adicionar apoio ao mesmo tempo não deixa apoio em chamado resolvido', async () => {
  for (let round = 0; round < RACE_ROUNDS; round++) {
    const ticket = await newTicket();
    await service.claimTicket(tech, ticket.id);
    const results = await Promise.allSettled([
      service.changeStatus(tech, ticket.id, { status: 'RESOLVIDO' }),
      service.setSupport(tech, ticket.id, tech2, true),
    ]);
    const final = await db.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: { participants: true },
    });
    assert.equal(results[0].status, 'fulfilled', `rodada ${round}`);
    assert.equal(final.status, 'RESOLVIDO');
    const types = await eventTypes(ticket.id);
    if (results[1].status === 'fulfilled') {
      // Apoio entrou antes da resolução: fica registrado na ordem certa.
      assert.equal(final.participants.length, 1);
      assert.deepEqual(types, ['CRIADO', 'ASSUMIDO', 'APOIO_ADICIONADO', 'RESOLVIDO']);
    } else {
      assert.equal(final.participants.length, 0);
      assert.deepEqual(types, ['CRIADO', 'ASSUMIDO', 'RESOLVIDO']);
    }
  }
});
test('redefinição de senha pelo ADMIN libera a troca de senha bloqueada', async () => {
  const user = await makeUser('FUNCIONARIO');
  for (let i = 0; i < 10; i++)
    await assert.rejects(changePassword(user.id, WRONG_PASSWORD, 'NovaSenha123'), /incorreta/);
  await assert.rejects(changePassword(user.id, password, 'NovaSenha123'), /Muitas tentativas/);
  await service.resetPassword(admin, user.id, 'Temporaria123');
  await changePassword(user.id, 'Temporaria123', 'NovaSenha123');
  assert.equal((await login(user.username, 'NovaSenha123')).mustChangePassword, false);
});
test('abertura comum exige equipe e grava a escolhida', async () => {
  const input = { description: 'Tomada sem energia na bancada.', impact: 'BAIXO' };
  await assert.rejects(service.createTicket(employee, input), /Selecione a equipe/);
  const eletrica = await teamId(organizationId, 'ELETRICA');
  const ticket = await service.createTicket(employee, { ...input, teamId: eletrica });
  assert.equal(ticket.teamId, eletrica);
  const foreignOrg = await db.organization.create({ data: { name: 'Equipes alheias' } });
  await assert.rejects(
    service.createTicket(employee, { ...input, teamId: await teamId(foreignOrg.id, 'TI') }),
    /Selecione a equipe/,
  );
});
test('atendimento rápido usa a equipe de quem registra; ADMIN escolhe', async () => {
  const eletrica = await teamId(organizationId, 'ELETRICA');
  const ti = await teamId(organizationId, 'TI');
  const electrician = await makeUser('TI', { teamId: eletrica });
  const input = { description: 'Disjuntor desarmando.', impact: 'BAIXO' as const };
  const byElectrician = await service.createTicket(
    electrician.id,
    { ...input, teamId: ti },
    employee,
  );
  assert.equal(byElectrician.teamId, eletrica);
  await assert.rejects(service.createTicket(admin, input, employee), /Selecione a equipe/);
  const before = await db.ticket.count();
  await assert.rejects(
    service.createTicket(admin, { ...input, teamId: 'equipe-inexistente' }, employee),
    /Selecione a equipe/,
  );
  assert.equal(await db.ticket.count(), before);
  const byAdmin = await service.createTicket(admin, { ...input, teamId: ti }, employee);
  assert.equal(byAdmin.teamId, ti);
});
const notFound = (error: unknown) => error instanceof AppError && error.status === 404;
const queueFilters = [
  'todos',
  'novos',
  'meus',
  'aguardando',
  'atendimento',
  'minha-espera',
  'apoio',
  'resolvidos-hoje',
  'filtro-desconhecido',
];
const teamTicket = (team: string, description: string) =>
  service.createTicket(employee, { description, impact: 'PARCIAL', teamId: team });
test('técnico só vê a fila e o detalhe da própria equipe', async () => {
  const marker = `Equipe ${randomBytes(4).toString('hex')}`;
  const tiNew = await teamTicket(tiTeam, `${marker} rede caiu`);
  const tiWaiting = await teamTicket(tiTeam, `${marker} impressora`);
  await service.claimTicket(tech, tiWaiting.id);
  await service.changeStatus(tech, tiWaiting.id, { status: 'AGUARDANDO', waitingReason: 'PECA' });
  const eletrica = await teamTicket(eletricaTeam, `${marker} tomada queimada`);
  for (const filter of queueFilters) {
    const result = await service.listTickets(eletricista, filter, 1, { q: marker });
    assert.ok(
      !result.tickets.some((t) => t.teamId === tiTeam),
      `eletricista vê chamado da TI em ${filter}`,
    );
    const asTech = await service.listTickets(tech, filter, 1, { q: marker, teamId: eletricaTeam });
    assert.ok(
      !asTech.tickets.some((t) => t.id === eletrica.id),
      `técnico da TI vê chamado da Elétrica em ${filter}`,
    );
  }
  assert.deepEqual(
    (await service.listTickets(eletricista, 'todos', 1, { q: marker })).tickets.map((t) => t.id),
    [eletrica.id],
  );
  assert.equal((await service.listTickets(tech, 'todos', 1, { q: marker })).total, 2);
  for (const ticket of [tiNew, tiWaiting]) {
    await assert.rejects(service.getTicket(eletricista, ticket.id), notFound);
    await assert.rejects(service.addComment(eletricista, ticket.id, 'Intrusão'), notFound);
    await assert.rejects(
      service.classifyTicket(eletricista, ticket.id, { categoryId: null, complexity: 'BAIXA' }),
      notFound,
    );
    await assert.rejects(
      service.relocateTicket(eletricista, ticket.id, { companyId: primaryCompanyId }),
      notFound,
    );
  }
  assert.equal(await db.ticketComment.count({ where: { ticketId: tiNew.id } }), 0);
  assert.equal((await db.ticket.findUniqueOrThrow({ where: { id: tiNew.id } })).complexity, null);
  const byTeam = await service.listTickets(admin, 'todos', 1, { q: marker, teamId: eletricaTeam });
  assert.deepEqual(
    byTeam.tickets.map((t) => t.id),
    [eletrica.id],
  );
  assert.equal((await service.listTickets(admin, 'todos', 1, { q: marker })).total, 3);
  const detail = await service.getTicket(eletricista, eletrica.id);
  assert.deepEqual(detail.team, { id: eletricaTeam, key: 'ELETRICA', name: 'Elétrica' });
});
test('busca por número não revela chamado de outra equipe', async () => {
  const ticket = await teamTicket(tiTeam, 'Monitor sem imagem.');
  const q = ticketNumber(ticket.number);
  assert.equal((await service.listTickets(eletricista, 'todos', 1, { q })).total, 0);
  assert.equal((await service.listTickets(eletricista, 'novos', 1, { q })).total, 0);
  assert.equal((await service.listTickets(tech, 'todos', 1, { q })).total, 1);
});
test('ajudante de outra equipe vê e comenta só o chamado em que está, e perde acesso ao sair', async () => {
  const ticket = await teamTicket(tiTeam, 'Quadro elétrico da sala de servidores.');
  const otherTicket = await teamTicket(tiTeam, 'Outro chamado da TI.');
  await service.claimTicket(tech, ticket.id);
  await service.setSupport(tech, ticket.id, eletricista, true);
  assert.equal((await service.getTicket(eletricista, ticket.id)).id, ticket.id);
  for (const filter of ['apoio', 'meus'])
    assert.ok(
      (await service.listTickets(eletricista, filter)).tickets.some((t) => t.id === ticket.id),
      filter,
    );
  await service.addComment(eletricista, ticket.id, 'Disjuntor verificado.');
  await assert.rejects(service.getTicket(eletricista, otherTicket.id), notFound);
  await assert.rejects(service.getTicket(eletricista2, ticket.id), notFound);
  await service.setSupport(tech, ticket.id, eletricista, false);
  await assert.rejects(service.getTicket(eletricista, ticket.id), notFound);
  await assert.rejects(service.addComment(eletricista, ticket.id, 'Depois de sair'), notFound);
  for (const filter of ['apoio', 'meus'])
    assert.ok(
      !(await service.listTickets(eletricista, filter)).tickets.some((t) => t.id === ticket.id),
      filter,
    );
});
test('assumir e transferir só dentro da equipe do chamado', async () => {
  const ticket = await teamTicket(tiTeam, 'Computador do caixa travado.');
  await assert.rejects(service.claimTicket(eletricista, ticket.id));
  assert.equal((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status, 'NOVO');
  await service.claimTicket(tech, ticket.id);
  await assert.rejects(
    service.assignTicket(tech, ticket.id, eletricista),
    /Selecione um técnico ativo da equipe do chamado/,
  );
  await service.assignTicket(tech, ticket.id, tech2);
  await service.assignTicket(tech2, ticket.id, admin);
  const final = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
  assert.equal(final.assigneeId, admin);
  const eletrica = await teamTicket(eletricaTeam, 'Lâmpada piscando.');
  await assert.rejects(service.claimTicket(tech, eletrica.id));
  await service.claimTicket(eletricista, eletrica.id);
  await service.assignTicket(eletricista, eletrica.id, eletricista2);
});
const forbidden = (error: unknown) => error instanceof AppError && error.status === 403;
test('responsável ou ADMIN move o chamado para a outra equipe, que o recebe como novo', async () => {
  const category = await db.category.create({
    data: { organizationId, teamId: tiTeam, name: `Rede ${randomBytes(4).toString('hex')}` },
  });
  const ticket = await teamTicket(tiTeam, 'Na verdade é a tomada do computador.');
  await service.claimTicket(tech, ticket.id);
  await service.classifyTicket(tech, ticket.id, { categoryId: category.id, complexity: 'MEDIA' });
  await service.changeStatus(tech, ticket.id, { status: 'AGUARDANDO', waitingReason: 'PECA' });
  await service.setSupport(tech, ticket.id, eletricista, true);
  await service.moveTicketTeam(tech, ticket.id, eletricaTeam);
  const final = await db.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    include: { participants: true },
  });
  assert.equal(final.status, 'NOVO');
  assert.equal(final.assigneeId, null);
  assert.equal(final.startedAt, null);
  assert.equal(final.waitingReason, null);
  assert.equal(final.waitingNote, null);
  assert.equal(final.categoryId, null);
  assert.equal(final.teamId, eletricaTeam);
  assert.deepEqual(
    final.participants.map((p) => p.userId),
    [eletricista],
  );
  const last = await db.ticketEvent.findFirstOrThrow({
    where: { ticketId: ticket.id },
    orderBy: { sequence: 'desc' },
  });
  assert.equal(last.type, 'EQUIPE_ALTERADA');
  assert.equal(last.actorId, tech);
  assert.equal(last.fromStatus, 'AGUARDANDO');
  assert.equal(last.toStatus, 'NOVO');
  assert.equal(last.previousCategoryId, category.id);
  assert.equal(last.nextCategoryId, null);
  assert.deepEqual(last.metadata, {
    previousTeamId: tiTeam,
    nextTeamId: eletricaTeam,
    previousAssigneeId: tech,
    previousCategoryId: category.id,
  });
  // The old team loses access; the support technician keeps it.
  await assert.rejects(service.getTicket(tech, ticket.id), notFound);
  assert.equal((await service.getTicket(eletricista, ticket.id)).id, ticket.id);
  // ADMIN moves a NOVO ticket back.
  await service.moveTicketTeam(admin, ticket.id, tiTeam);
  assert.equal((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).teamId, tiTeam);
});
test('não move para a mesma equipe, nem chamado resolvido, nem quem não é responsável', async () => {
  const ticket = await teamTicket(tiTeam, 'Teclado sem resposta.');
  await service.claimTicket(tech, ticket.id);
  await service.setSupport(tech, ticket.id, eletricista, true);
  await assert.rejects(service.moveTicketTeam(tech, ticket.id, tiTeam), /já é desta equipe/);
  await assert.rejects(service.moveTicketTeam(tech2, ticket.id, eletricaTeam), forbidden);
  await assert.rejects(service.moveTicketTeam(eletricista, ticket.id, eletricaTeam), forbidden);
  await assert.rejects(service.moveTicketTeam(employee, ticket.id, eletricaTeam));
  await assert.rejects(service.moveTicketTeam(tech, ticket.id, 'equipe-inexistente'), /equipe/);
  await service.changeStatus(tech, ticket.id, { status: 'RESOLVIDO' });
  await assert.rejects(
    service.moveTicketTeam(admin, ticket.id, eletricaTeam),
    /resolvido não pode mudar de equipe/,
  );
  const final = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
  assert.equal(final.teamId, tiTeam);
  assert.equal(final.status, 'RESOLVIDO');
  assert.ok(!(await eventTypes(ticket.id)).includes('EQUIPE_ALTERADA'));
});
test('após mover, só a nova equipe assume; mudanças concorrentes geram um único evento', async () => {
  const ticket = await teamTicket(tiTeam, 'Disjuntor do rack desarmando.');
  await service.moveTicketTeam(admin, ticket.id, eletricaTeam);
  await assert.rejects(service.claimTicket(tech, ticket.id));
  await service.claimTicket(eletricista, ticket.id);
  assert.equal(
    (await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assigneeId,
    eletricista,
  );
  for (let round = 0; round < RACE_ROUNDS; round++) {
    const raced = await teamTicket(tiTeam, `Corrida de equipe ${round}`);
    const results = await Promise.allSettled([
      service.moveTicketTeam(admin, raced.id, eletricaTeam),
      service.moveTicketTeam(admin, raced.id, eletricaTeam),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, `rodada ${round}`);
    const refused = results.find((r) => r.status === 'rejected')!;
    assert.ok(refused.reason instanceof AppError, `rodada ${round}: ${refused.reason}`);
    assert.deepEqual(await eventTypes(raced.id), ['CRIADO', 'EQUIPE_ALTERADA'], `rodada ${round}`);
  }
});
test('quem era apoio e assume o chamado movido deixa de ser apoio, com evento', async () => {
  const ticket = await teamTicket(tiTeam, 'Fiação do switch esquentando.');
  await service.claimTicket(tech, ticket.id);
  await service.setSupport(tech, ticket.id, eletricista, true);
  await service.moveTicketTeam(tech, ticket.id, eletricaTeam);
  await service.claimTicket(eletricista, ticket.id);
  assert.equal(await db.ticketParticipant.count({ where: { ticketId: ticket.id } }), 0);
  assert.deepEqual(await eventTypes(ticket.id), [
    'CRIADO',
    'ASSUMIDO',
    'APOIO_ADICIONADO',
    'EQUIPE_ALTERADA',
    'APOIO_REMOVIDO',
    'ASSUMIDO',
  ]);
  const removed = await db.ticketEvent.findFirstOrThrow({
    where: { ticketId: ticket.id, type: 'APOIO_REMOVIDO' },
  });
  assert.equal(removed.actorId, eletricista);
  assert.equal(removed.targetUserId, eletricista);
  assert.ok(
    !(await service.listTickets(eletricista, 'apoio')).tickets.some((t) => t.id === ticket.id),
  );
});
