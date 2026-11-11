import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { syntheticCnpj, teamId } from './fixtures';
import { APP_ORGANIZATION_ID } from '../src/lib/config';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth-service';
import { createTicket, claimTicket } from '../src/lib/services';
import { renderReportPdf } from '../src/lib/pdf-report';
import { buildManagementPdf } from '../src/lib/management-pdf';
import type { Role } from '../src/generated/prisma/client';
const organizationId = APP_ORGANIZATION_ID;
const id = () => randomBytes(8).toString('hex');
let manager: string,
  tech: string,
  employee: string,
  tiTeam: string,
  eletrica: string,
  department: string,
  companyId: string;
const user = async (role: Role, team?: string, org = organizationId, dept = department) =>
  (
    await db.user.create({
      data: {
        name: `Pessoa ${role} ${id()}`,
        username: `test.${id()}`,
        role,
        organizationId: org,
        departmentId: dept,
        primaryCompanyId: companyId,
        passwordHash: await hashPassword('123456'),
        mustChangePassword: false,
        teamId: team,
      },
    })
  ).id;
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/central_test_/);
  tiTeam = await teamId(organizationId, 'TI');
  eletrica = await teamId(organizationId, 'ELETRICA');
  department = (await db.department.create({ data: { organizationId, name: `PDF ${id()}` } })).id;
  companyId = (
    await db.company.create({
      data: { organizationId, displayName: `Local PDF ${id()}`, cnpj: syntheticCnpj() },
    })
  ).id;
  manager = await user('GESTOR');
  tech = await user('TI', tiTeam);
  employee = await user('FUNCIONARIO');
});
after(() => db.$disconnect());
const open = (teamId: string, text = 'Chamado') =>
  createTicket(employee, { description: `${text} ${id()}`, impact: 'BAIXO', teamId });
const cells = (report: Awaited<ReturnType<typeof buildManagementPdf>>) =>
  report.sections.flatMap((s) => s.table?.rows.flat() ?? []);

test('renderReportPdf gera PDF válido com acentos', async () => {
  const buf = await renderReportPdf({
    title: 'Panorama — Elétrica',
    organizationName: 'Organização de teste',
    generatedBy: 'Ação Gestão',
    generatedAt: new Date('2026-09-18T15:00:00Z'),
    filters: ['18/09/2026 a 18/09/2026 · America/Belem', 'Equipe: Elétrica'],
    sections: [{ heading: 'Volume', kpis: [['Abertos', '3']] }],
  });
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buf.length > 500);
});
test('renderReportPdf quebra tabelas longas em páginas e aceita caracteres fora do WinAnsi', async () => {
  const rows = Array.from({ length: 120 }, (_, i) => [String(i), `Linha ${i} 日本語 😀 ação`, 'x']);
  const buf = await renderReportPdf({
    title: 'Longo',
    organizationName: 'Org',
    generatedBy: 'Pessoa',
    generatedAt: new Date(),
    filters: [],
    notice: 'Use o CSV.',
    sections: [{ heading: 'Tabela', table: { columns: ['Nº', 'Texto', 'Valor'], rows } }],
  });
  const pages = buf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;
  assert.ok(pages >= 3, `páginas: ${pages}`);
});
test('buildManagementPdf aplica filtros e escopo', async () => {
  await open(eletrica, 'Tomada');
  await open(eletrica, 'Quadro');
  await open(tiTeam, 'Rede');
  const input = { periodo: 'hoje', department };
  const report = await buildManagementPdf(manager, 'chamados', { ...input, team: eletrica });
  const table = report.sections.find((s) => s.table)!.table!;
  assert.equal(table.rows.length, 2);
  assert.ok(report.filters.includes('Equipe: Elétrica'));
  assert.equal(report.organizationName.length > 0, true);
  assert.equal(report.notice, undefined);
  assert.equal(
    (await buildManagementPdf(manager, 'chamados', input)).sections[0].table!.rows.length,
    3,
  );
  await assert.rejects(buildManagementPdf(tech, 'panorama', {}), { status: 403 });
  const other = (await db.organization.create({ data: { name: `Outra ${id()}` } })).id;
  const foreign = (
    await db.company.create({
      data: { organizationId: other, displayName: `Fora ${id()}`, cnpj: syntheticCnpj() },
    })
  ).id;
  await assert.rejects(buildManagementPdf(manager, 'filial', {}, foreign), { status: 404 });
  await assert.rejects(buildManagementPdf(manager, 'tecnico', {}, 'inexistente'), { status: 404 });
});
test('indisponível vira "—" nas telas de equipe e de técnico', async () => {
  const idle = await user('TI', tiTeam);
  const input = { periodo: 'hoje', department, team: tiTeam };
  const team = await buildManagementPdf(manager, 'equipe', { ...input, technician: idle });
  const row = team.sections
    .find((s) => s.table)!
    .table!.rows.find((r) => r[0].startsWith('Pessoa TI'));
  assert.ok(row);
  assert.ok(
    row!.slice(-3).every((cell) => cell === '—'),
    row!.join('|'),
  );
  const detail = await buildManagementPdf(
    manager,
    'tecnico',
    { periodo: 'hoje', department },
    idle,
  );
  const kpis = detail.sections.flatMap((s) => s.kpis ?? []);
  assert.equal(kpis.find(([label]) => label.includes('primeira resposta'))![1], '—');
  assert.equal(kpis.find(([label]) => label.includes('até resolução'))![1], '—');
});
test('telas panorama, filiais e filial geram seções com os números do período', async () => {
  const ticket = await open(tiTeam, 'Impressora');
  await claimTicket(tech, ticket.id);
  const input = { periodo: 'hoje', department, company: companyId };
  const panorama = await buildManagementPdf(manager, 'panorama', { periodo: 'hoje', department });
  const resumo = panorama.sections[0];
  assert.equal(resumo.heading, 'Resumo');
  assert.ok(Number(resumo.kpis!.find(([l]) => l === 'Abertos no período')![1]) >= 1);
  const filiais = await buildManagementPdf(manager, 'filiais', input);
  assert.ok(filiais.sections[0].table!.columns.length > 3);
  const filial = await buildManagementPdf(manager, 'filial', { periodo: 'hoje' }, companyId);
  assert.ok(filial.title.includes('Local PDF'));
  assert.ok(filial.sections[0].kpis);
});
test('PDF de chamados corta no limite e avisa; pendências ignoram a data de abertura', async () => {
  const dept = (await db.department.create({ data: { organizationId, name: `Corte ${id()}` } })).id;
  const filters = { periodo: 'hoje', department: dept };
  const requester = await user('FUNCIONARIO', undefined, organizationId, dept);
  for (let i = 0; i < 4; i++)
    await createTicket(requester, {
      description: `Corte ${i} ${id()}`,
      impact: 'BAIXO',
      teamId: tiTeam,
    });
  const cut = await buildManagementPdf(manager, 'chamados', filters, undefined, { maxRows: 3 });
  assert.equal(cut.sections.find((s) => s.table)!.table!.rows.length, 3);
  assert.match(cut.notice!, /CSV/);
  const whole = await buildManagementPdf(manager, 'chamados', filters, undefined, { maxRows: 4 });
  assert.equal(whole.sections.find((s) => s.table)!.table!.rows.length, 4);
  assert.equal(whole.notice, undefined);
  const future = new Date(Date.now() + 40 * 86400000);
  const outside = await buildManagementPdf(manager, 'chamados', filters, undefined, {
    now: future,
  });
  assert.equal(outside.sections.find((s) => s.table)!.table!.rows.length, 0);
  const pending = await buildManagementPdf(
    manager,
    'chamados',
    { ...filters, carteira: 'pendentes' },
    undefined,
    { now: future },
  );
  assert.equal(pending.sections.find((s) => s.table)!.table!.rows.length, 4);
  assert.ok(cells(pending).includes('Novo'));
});
