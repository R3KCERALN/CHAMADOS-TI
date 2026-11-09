import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { syntheticCnpj } from './fixtures';
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
import type { Role } from '../src/generated/prisma/client';
const password = process.env.TEST_PASSWORD!;
let admin: string,
  employee: string,
  other: string,
  tech: string,
  tech2: string,
  manager: string,
  departmentId: string,
  primaryCompanyId: string;
const organizationId = APP_ORGANIZATION_ID;
let hash: string;
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
      ...options,
    },
  });
}
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/central_test_\d+_[a-f0-9]{8}$/);
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
});
after(() => db.$disconnect());
const newTicket = () =>
  service.createTicket(employee, {
    description: 'Meu computador não inicia.',
    impact: 'BLOQUEADO',
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
