import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { db } from '../src/lib/db';
import { APP_ORGANIZATION_ID } from '../src/lib/config';
import { hashPassword, login, getSessionUser } from '../src/lib/auth-service';
import { syntheticCnpj } from './fixtures';
import { normalizeCnpj, validCnpj, formatCnpj } from '../src/lib/cnpj';
import { saveCompany, saveUnit, locationOptions } from '../src/lib/organization-service';
import * as services from '../src/lib/services';
import {
  overview,
  analyticsOptions,
  exportRows,
  teamReport,
  technicianDetail,
  companiesReport,
  managementTickets,
} from '../src/lib/analytics-service';
import { csvHeader, csvRow } from '../src/lib/csv';
import type { Role } from '../src/generated/prisma/client';
const organizationId = APP_ORGANIZATION_ID;
const token = () => randomBytes(6).toString('hex');
let departmentId: string,
  companyId: string,
  secondCompanyId: string,
  unitId: string,
  otherUnitId: string;
let admin: string, employee: string, tech: string, manager: string;
let foreignOrg: string,
  foreignAdmin: string,
  foreignCompany: string,
  foreignUnit: string,
  foreignDepartment: string,
  foreignCategory: string,
  foreignTicket: string;
let passwordHash: string;
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/central_test_/);
  passwordHash = await hashPassword('123456');
  departmentId = (
    await db.department.create({ data: { organizationId, name: 'Organização ' + token() } })
  ).id;
  companyId = (
    await db.company.create({
      data: { organizationId, displayName: 'Sem unidades ' + token(), cnpj: syntheticCnpj() },
    })
  ).id;
  secondCompanyId = (
    await db.company.create({
      data: { organizationId, displayName: 'Com unidades ' + token(), cnpj: syntheticCnpj() },
    })
  ).id;
  unitId = (await db.unit.create({ data: { companyId: secondCompanyId, name: 'Depósito' } })).id;
  otherUnitId = (await db.unit.create({ data: { companyId: secondCompanyId, name: 'Matriz' } })).id;
  [admin, employee, tech, manager] = await Promise.all(
    (['ADMIN', 'FUNCIONARIO', 'TI', 'GESTOR'] as Role[]).map(
      async (role) =>
        (
          await db.user.create({
            data: {
              organizationId,
              departmentId,
              primaryCompanyId: role === 'FUNCIONARIO' ? companyId : null,
              role,
              name: 'Pessoa ' + role,
              username: 'org.' + token(),
              passwordHash,
              mustChangePassword: false,
            },
          })
        ).id,
    ),
  );
  foreignOrg = (await db.organization.create({ data: { name: 'Outra organização' } })).id;
  foreignDepartment = (
    await db.department.create({ data: { organizationId: foreignOrg, name: 'Outro setor' } })
  ).id;
  foreignCompany = (
    await db.company.create({
      data: { organizationId: foreignOrg, displayName: 'Local externo', cnpj: syntheticCnpj() },
    })
  ).id;
  foreignUnit = (
    await db.unit.create({ data: { companyId: foreignCompany, name: 'Unidade externa' } })
  ).id;
  foreignCategory = (
    await db.category.create({ data: { organizationId: foreignOrg, name: 'Categoria externa' } })
  ).id;
  foreignAdmin = (
    await db.user.create({
      data: {
        organizationId: foreignOrg,
        departmentId: foreignDepartment,
        role: 'ADMIN',
        name: 'Admin externo',
        username: 'externo.' + token(),
        passwordHash,
        mustChangePassword: false,
      },
    })
  ).id;
  foreignTicket = (
    await services.createTicket(foreignAdmin, {
      description: 'Registro de outra organização.',
      impact: 'BAIXO',
      companyId: foreignCompany,
    })
  ).id;
});
after(() => db.$disconnect());
const ticket = () =>
  services.createTicket(employee, {
    description: 'Abertura normal com localização automática.',
    impact: 'PARCIAL',
  });
const manual = () =>
  services.createTicket(tech, {
    quick: true,
    requesterName: 'João - Reposição',
    companyId,
    description: 'Coletor não conecta no Wi-Fi.',
    impact: 'PARCIAL',
  });
test('Organization inicial existe; dados de referência da instalação têm escopo obrigatório', async () => {
  assert.ok(await db.organization.findUnique({ where: { id: organizationId } }));
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: employee } })).organizationId,
    organizationId,
  );
  assert.equal(
    (await db.department.findUniqueOrThrow({ where: { id: departmentId } })).organizationId,
    organizationId,
  );
});
test('CNPJ formatado é normalizado e dígitos verificadores são validados localmente', () => {
  const cnpj = syntheticCnpj();
  assert.equal(normalizeCnpj(formatCnpj(cnpj)), cnpj);
  assert.ok(validCnpj(cnpj));
  for (const bad of [
    '11111111111111',
    '123',
    'abc12345678901',
    cnpj.slice(0, 13) + (cnpj[13] === '0' ? '1' : '0'),
  ])
    assert.equal(validCnpj(bad), false);
});
test('ADMIN cria/edita/inativa Company sem Unit; duplicidade de CNPJ é por organização', async () => {
  const cnpj = syntheticCnpj();
  const company = await saveCompany(admin, {
    displayName: 'Filial de teste',
    cnpj: formatCnpj(cnpj),
  });
  assert.equal(company.cnpj, cnpj);
  assert.equal(await db.unit.count({ where: { companyId: company.id } }), 0);
  await assert.rejects(saveCompany(admin, { displayName: 'Duplicada', cnpj }));
  await assert.rejects(saveCompany(admin, { displayName: 'Inválida', cnpj: '12345678901234' }));
  assert.ok(await saveCompany(foreignAdmin, { displayName: 'Mesmo CNPJ em outro escopo', cnpj }));
  assert.equal(
    (await saveCompany(admin, { id: company.id, displayName: 'Renomeada', cnpj, active: false }))
      .active,
    false,
  );
});
test('ADMIN cria Unit vinculada à Company correta; localização não muda de empresa', async () => {
  const unit = await saveUnit(admin, {
    companyId: secondCompanyId,
    name: 'CD ' + token(),
    code: 'CD',
  });
  assert.equal(unit.companyId, secondCompanyId);
  assert.equal(
    (
      await saveUnit(admin, {
        id: unit.id,
        companyId: secondCompanyId,
        name: 'Centro de distribuição',
        active: false,
      })
    ).active,
    false,
  );
  await assert.rejects(saveUnit(admin, { id: unit.id, companyId, name: 'Movida' }));
});
test('TI, GESTOR e funcionário não administram Company ou Unit', async () => {
  for (const actor of [tech, manager, employee]) {
    await assert.rejects(
      saveCompany(actor, { displayName: 'Indevida', cnpj: syntheticCnpj() }),
      /permissão/,
    );
    await assert.rejects(saveUnit(actor, { companyId, name: 'Indevida' }), /permissão/);
  }
});
test('funcionário com uma Company abre sem escolher; openedBy e solicitante são independentes', async () => {
  const t = await ticket();
  assert.equal(t.companyId, companyId);
  assert.equal(t.unitId, null);
  assert.equal(t.openedByUserId, employee);
  assert.equal(t.requesterId, employee);
});
test('funcionário com várias Companies escolhe somente autorizadas', async () => {
  await db.userCompanyAccess.create({ data: { userId: employee, companyId: secondCompanyId } });
  const t = await services.createTicket(employee, {
    description: 'Demanda no segundo local.',
    impact: 'BAIXO',
    companyId: secondCompanyId,
    unitId,
  });
  assert.equal(t.companyId, secondCompanyId);
  assert.equal(t.unitId, unitId);
  const denied = await saveCompany(admin, { displayName: 'Não autorizada', cnpj: syntheticCnpj() });
  await assert.rejects(
    services.createTicket(employee, {
      description: 'Não autorizada.',
      impact: 'BAIXO',
      companyId: denied.id,
    }),
    /permissão/,
  );
});
test('restrição de Units é aplicada no servidor e nas opções do funcionário', async () => {
  await db.userUnitAccess.create({ data: { userId: employee, unitId } });
  await assert.rejects(
    services.createTicket(employee, {
      description: 'Unidade não permitida.',
      impact: 'BAIXO',
      companyId: secondCompanyId,
      unitId: otherUnitId,
    }),
    /permissão/,
  );
  assert.deepEqual(
    (await locationOptions(employee)).find((c) => c.id === secondCompanyId)?.units.map((u) => u.id),
    [unitId],
  );
  await assert.rejects(
    services.createTicket(employee, {
      description: 'Unidade de outra filial.',
      impact: 'BAIXO',
      companyId,
      unitId,
    }),
  );
});
test('Atendimento Rápido com usuário preenche a Company e registra TI como openedBy', async () => {
  const t = await services.createTicket(
    tech,
    { description: 'Atendimento para usuário cadastrado.', impact: 'BAIXO' },
    employee,
  );
  assert.equal(t.openedByUserId, tech);
  assert.equal(t.requesterId, employee);
  assert.equal(t.companyId, companyId);
  assert.equal(t.origin, 'ATENDIMENTO_RAPIDO');
  assert.equal(t.status, 'EM_ATENDIMENTO');
});
test('Atendimento Rápido textual não cria User e preserva nome e autoria', async () => {
  const before = await db.user.count();
  const t = await manual();
  assert.equal(await db.user.count(), before);
  assert.equal(t.requesterId, null);
  assert.equal(t.departmentId, null);
  assert.equal(t.requesterName, 'João - Reposição');
  assert.equal(t.openedByUserId, tech);
  assert.equal(t.assigneeId, tech);
  const detail = await services.getTicket(tech, t.id);
  assert.equal(detail.requesterName, 'João - Reposição');
  assert.equal(detail.openedByUser?.id, tech);
  assert.equal(detail.events[0].actorId, tech);
});
test('texto livre exige Company explícita e identificação; funcionário não usa esse fluxo', async () => {
  await db.user.update({
    where: { id: tech },
    data: { primaryCompanyId: secondCompanyId, primaryUnitId: unitId },
  });
  try {
    const t = await services.createTicket(tech, {
      quick: true,
      requesterName: 'Nome avulso',
      companyId: secondCompanyId,
      description: 'Sem unidade especificada.',
      impact: 'BAIXO',
    });
    assert.equal(t.unitId, null, 'Solicitante manual não herda unidade administrativa do técnico.');
  } finally {
    await db.user.update({
      where: { id: tech },
      data: { primaryCompanyId: null, primaryUnitId: null },
    });
  }

  await assert.rejects(
    services.createTicket(tech, {
      quick: true,
      requesterName: 'João',
      description: 'Impressora parada.',
      impact: 'BAIXO',
    }),
    /filial/,
  );
  await assert.rejects(
    services.createTicket(tech, {
      quick: true,
      companyId,
      description: 'Impressora parada.',
      impact: 'BAIXO',
    }),
    /nome/,
  );
  await assert.rejects(
    services.createTicket(employee, {
      quick: true,
      requesterName: 'João',
      companyId,
      description: 'Impressora parada.',
      impact: 'BAIXO',
    }),
    /permissão/,
  );
});
test('busca encontra snapshot e nome manual sem perder chamados', async () => {
  const t = await manual();
  const list = await services.listTickets(tech, 'todos', 1, { q: 'João - Reposição' });
  assert.ok(list.tickets.some((r) => r.id === t.id));
});
test('solicitante textual participa de métricas, Company e CSV com proteção contra injeção', async () => {
  const t = await manual();
  const filters = { periodo: 'hoje', company: companyId };
  const data = await overview(manager, filters);
  assert.ok(data.summary.opened > 0);
  assert.ok(data.companies.some((c) => c.id === companyId));
  const row = (await exportRows(manager, filters)).find((r) => r.number === t.number)!;
  assert.equal(row.manualRequester, 'João - Reposição');
  assert.equal(row.registeredRequester, null);
  assert.equal(row.requester, 'João - Reposição');
  assert.ok(row.openedBy);
  assert.match(csvHeader, /CNPJ/);
  assert.match(csvRow(row), /João - Reposição/);
  assert.match(csvRow({ ...row, requester: '=1+1' }), /'=1\+1/);
});
test('Company e Unit combinam filtros gerenciais e consultas paginadas', async () => {
  const t = await services.createTicket(tech, {
    quick: true,
    requesterName: 'Caixa 04',
    companyId: secondCompanyId,
    unitId,
    description: 'Caixa sem rede.',
    impact: 'PARCIAL',
  });
  const f = { periodo: 'hoje', company: secondCompanyId, unit: unitId };
  assert.ok((await exportRows(manager, f)).some((r) => r.number === t.number));
  assert.equal((await exportRows(manager, { ...f, company: companyId })).length, 0);
  assert.ok((await managementTickets(manager, f)).tickets.some((r) => r.id === t.id));
  assert.ok(
    (await companiesReport(manager, f)).rows.some((r) => r.id === secondCompanyId && r.opened > 0),
  );
});
test('dados históricos sem Company entram em Sem filial e no CSV', async () => {
  const t = await db.ticket.create({
    data: {
      organizationId,
      requesterId: employee,
      requesterName: 'Histórico preservado',
      openedByUserId: employee,
      departmentId,
      description: 'Chamado legado sem filial conhecida.',
      impact: 'BAIXO',
    },
  });
  const data = await overview(manager, { periodo: 'hoje', company: 'none' });
  assert.ok(data.companies.some((c) => c.id === 'none' && c.count > 0));
  assert.ok(
    (await exportRows(manager, { periodo: 'hoje', company: 'none' })).some(
      (r) => r.number === t.number,
    ),
  );
});
test('TI corrige Company/Unit com evento; funcionário não altera localização', async () => {
  const t = await manual();
  await services.relocateTicket(tech, t.id, { companyId: secondCompanyId, unitId });
  const detail = await services.getTicket(tech, t.id);
  assert.equal(detail.companyId, secondCompanyId);
  assert.equal(detail.events.at(-1)?.type, 'LOCALIZACAO_ALTERADA');
  await assert.rejects(services.relocateTicket(employee, t.id, { companyId }), /permissão/);
});
test('snapshots de nomes persistem após alteração de cadastro', async () => {
  const t = await ticket();
  const before = t.requesterName;
  await db.user.update({ where: { id: employee }, data: { name: 'Nome atualizado' } });
  assert.equal((await services.getTicket(tech, t.id)).requesterName, before);
});
test('Company inativa é preservada no histórico e recusada em novos chamados', async () => {
  const c = await saveCompany(admin, { displayName: 'Histórica', cnpj: syntheticCnpj() });
  const t = await services.createTicket(tech, {
    quick: true,
    requesterName: 'Pessoa',
    companyId: c.id,
    description: 'Registro antes da inativação.',
    impact: 'BAIXO',
  });
  await saveCompany(admin, { id: c.id, displayName: c.displayName, cnpj: c.cnpj, active: false });
  assert.equal((await services.getTicket(tech, t.id)).company?.active, false);
  await assert.rejects(
    services.createTicket(tech, {
      quick: true,
      requesterName: 'Pessoa',
      companyId: c.id,
      description: 'Registro após inativação.',
      impact: 'BAIXO',
    }),
  );
  await assert.rejects(db.company.delete({ where: { id: c.id } }));
});
test('isolamento impede ler/mutar chamados de outra Organization e atribuir referências externas', async () => {
  for (const person of [admin, tech, employee, manager])
    await assert.rejects(services.getTicket(person, foreignTicket));
  await assert.rejects(services.claimTicket(tech, foreignTicket));
  await assert.rejects(services.addComment(tech, foreignTicket, 'Comentário indevido'));
  await assert.rejects(
    services.classifyTicket(tech, foreignTicket, { categoryId: null, complexity: 'BAIXA' }),
  );
  const t = await manual();
  await assert.rejects(services.relocateTicket(tech, t.id, { companyId: foreignCompany }));
  await assert.rejects(
    services.classifyTicket(tech, t.id, { categoryId: foreignCategory, complexity: null }),
  );
  await assert.rejects(services.setSupport(tech, t.id, foreignAdmin, true));
  await assert.rejects(services.assignTicket(tech, t.id, foreignAdmin));
  await assert.rejects(
    services.createTicket(
      tech,
      { quick: true, description: 'Referência externa.', impact: 'BAIXO', companyId },
      foreignAdmin,
    ),
  );
});
test('isolamento cobre administração, filtros, analytics, equipe e exportação', async () => {
  const foreign = await db.user.findUniqueOrThrow({ where: { id: foreignAdmin } });
  assert.equal((await services.adminUsers(admin, { q: foreign.username })).total, 0);
  await assert.rejects(services.resetPassword(admin, foreignAdmin, '654321'));
  await assert.rejects(
    saveCompany(admin, { id: foreignCompany, displayName: 'Ataque', cnpj: syntheticCnpj() }),
  );
  await assert.rejects(saveUnit(admin, { companyId: foreignCompany, name: 'Ataque' }));
  await assert.rejects(services.saveCategory(admin, { id: foreignCategory, name: 'Ataque' }));
  const options = await analyticsOptions(manager);
  assert.ok(!options.companies.some((c) => c.id === foreignCompany));
  assert.ok(!options.departments.some((d) => d.id === foreignDepartment));
  assert.ok(!options.technicians.some((t) => t.id === foreignAdmin));
  assert.equal((await overview(manager, { company: foreignCompany })).summary.opened, 0);
  assert.equal((await exportRows(manager, { company: foreignCompany })).length, 0);
  assert.equal((await teamReport(manager, { technician: foreignAdmin })).rows.length, 0);
  await assert.rejects(technicianDetail(manager, foreignAdmin, {}));
  assert.equal(
    (await services.listTickets(tech, 'todos', 1, { companyId: foreignCompany })).total,
    0,
  );
});
test('banco rejeita vínculos cruzados mesmo em escrita direta sem passar pelos serviços', async () => {
  const t = await manual();
  await assert.rejects(
    db.ticket.update({ where: { id: t.id }, data: { companyId: foreignCompany } }),
  );
  await assert.rejects(
    db.ticket.update({ where: { id: t.id }, data: { organizationId: foreignOrg } }),
  );
  await assert.rejects(
    db.ticketComment.create({
      data: { ticketId: t.id, authorId: foreignAdmin, content: 'Comentário externo' },
    }),
  );
  await assert.rejects(
    db.ticketEvent.create({ data: { ticketId: t.id, actorId: foreignAdmin, type: 'COMENTARIO' } }),
  );
  await assert.rejects(
    db.userCompanyAccess.create({ data: { userId: employee, companyId: foreignCompany } }),
  );
  await assert.rejects(
    db.userUnitAccess.create({ data: { userId: employee, unitId: foreignUnit } }),
  );
  await assert.rejects(db.ticket.update({ where: { id: t.id }, data: { unitId } }));
});
test('login permanece vinculado à organização da instalação; organização inativa revoga sessão', async () => {
  const outsider = await db.user.findUniqueOrThrow({ where: { id: foreignAdmin } });
  await assert.rejects(login(outsider.username, '123456'), /inválidos/);
  const user = await db.user.findUniqueOrThrow({ where: { id: employee } });
  const session = await login(user.username, '123456');
  await db.organization.update({ where: { id: organizationId }, data: { active: false } });
  try {
    assert.equal(await getSessionUser(session.token), null);
    await assert.rejects(services.listTickets(tech));
    await assert.rejects(login(user.username, '123456'), /inválidos/);
  } finally {
    await db.organization.update({ where: { id: organizationId }, data: { active: true } });
  }
});

test('desativação de usuário continua possível quando a Company está inativa', async () => {
  const company = await saveCompany(admin, {
    displayName: 'Vínculo antigo',
    cnpj: syntheticCnpj(),
  });
  const user = await services.createUser(admin, {
    name: 'Pessoa de filial inativa',
    username: 'inactive.' + token(),
    role: 'FUNCIONARIO',
    departmentId,
    primaryCompanyId: company.id,
    password: '123456',
  });
  await saveCompany(admin, {
    id: company.id,
    displayName: company.displayName,
    cnpj: company.cnpj,
    active: false,
  });
  await services.updateUser(admin, user.id, {
    name: user.name,
    username: user.username,
    role: user.role,
    departmentId,
    active: false,
  });
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).active, false);
});
test('ADMIN associa usuário a Company e Units somente da própria Organization', async () => {
  const data = {
    name: 'Novo funcionário',
    username: 'new.' + token(),
    role: 'FUNCIONARIO',
    departmentId,
    password: '123456',
  };
  await assert.rejects(services.createUser(admin, data), /filial/);
  await assert.rejects(services.createUser(admin, { ...data, primaryCompanyId: foreignCompany }));
  await assert.rejects(
    services.createUser(admin, {
      ...data,
      primaryCompanyId: companyId,
      departmentId: foreignDepartment,
    }),
  );
  await assert.rejects(
    services.createUser(admin, { ...data, primaryCompanyId: companyId, primaryUnitId: unitId }),
  );
  const user = await services.createUser(admin, {
    ...data,
    primaryCompanyId: companyId,
    additionalCompanyIds: [secondCompanyId],
    additionalUnitIds: [unitId],
  });
  assert.equal(user.organizationId, organizationId);
  assert.equal(await db.userCompanyAccess.count({ where: { userId: user.id } }), 1);
  assert.equal(await db.userUnitAccess.count({ where: { userId: user.id } }), 1);
});
