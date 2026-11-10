import 'dotenv/config';
import { randomInt } from 'node:crypto';
import { APP_ORGANIZATION_ID } from '../src/lib/config';
import { validCnpj } from '../src/lib/cnpj';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth-service';
import type {
  Role,
  Company,
  TicketStatus,
  Complexity,
  WaitingReason,
  Prisma,
} from '../src/generated/prisma/client';
const organizationId = APP_ORGANIZATION_ID;
async function main() {
  const name = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  if (process.env.SEED_DEMO !== 'true' || !name.endsWith('_demo'))
    throw new Error(
      'Seed fictício permitido somente com SEED_DEMO=true em banco terminado em _demo.',
    );
  if (!process.env.DEMO_PASSWORD) throw new Error('Configure DEMO_PASSWORD.');
  if (await db.user.findUnique({ where: { username: 'demo.gestor' } })) {
    await addLocations();
    console.log(
      'Demonstração organizacional atualizada sem recriar contas ou chamados existentes.',
    );
    return;
  }
  const hash = await hashPassword(process.env.DEMO_PASSWORD);
  const departments = await db.department.findMany({
    where: { organizationId },
    orderBy: { name: 'asc' },
  });
  const categories = await db.category.findMany({
    where: { organizationId },
    orderBy: { name: 'asc' },
  });
  const ti = departments.find((d) => d.name === 'TI')!;
  const people = [
    ['demo.gestor', 'Gestora demonstração', 'GESTOR'],
    ['demo.carlos', 'Carlos Almeida', 'TI'],
    ['demo.luiza', 'Luiza Santos', 'TI'],
    ['demo.giovanni', 'Giovanni Costa', 'TI'],
    ['demo.inativo', 'Técnico histórico', 'TI'],
    ['demo.ana', 'Ana Financeiro', 'FUNCIONARIO'],
    ['demo.pedro', 'Pedro Comercial', 'FUNCIONARIO'],
    ['demo.julia', 'Júlia RH', 'FUNCIONARIO'],
    ['demo.eletricista', 'Eduardo Eletricista', 'TI'],
  ] as const;
  const teams = await db.team.findMany({ where: { organizationId } });
  const teamIdOf = (key: string) => teams.find((t) => t.key === key)!.id;
  const users = [];
  for (let i = 0; i < people.length; i++) {
    const [username, name, role] = people[i];
    users.push(
      await db.user.create({
        data: {
          organizationId,
          username,
          name,
          role: role as Role,
          teamId:
            role === 'TI' ? teamIdOf(username === 'demo.eletricista' ? 'ELETRICA' : 'TI') : null,
          departmentId: role === 'TI' ? ti.id : departments[i % departments.length].id,
          passwordHash: hash,
          mustChangePassword: true,
          active: username !== 'demo.inativo',
        },
      }),
    );
  }
  const technicians = users.slice(1, 5),
    requesters = users.slice(5, 8);
  const now = Date.now();
  const hour = 3600000;
  for (let i = 0; i < 54; i++) {
    const createdAt = new Date(now - ((i % 42) + 1) * 86400000 - (i % 8) * hour);
    const startedAt = new Date(createdAt.getTime() + (1 + (i % 3)) * hour);
    const resolved = i % 5 < 2;
    const status: TicketStatus = resolved
      ? 'RESOLVIDO'
      : i % 5 === 2
        ? 'NOVO'
        : i % 5 === 3
          ? 'EM_ATENDIMENTO'
          : 'AGUARDANDO';
    const principal = technicians[i % (resolved ? 4 : 3)],
      requester = requesters[i % 3];
    const category = i % 7 === 0 ? null : categories[i % categories.length];
    const complexity: Complexity | null = ([null, 'BAIXA', 'MEDIA', 'ALTA', 'CRITICA'] as const)[
      i % 5
    ];
    const reason: WaitingReason = (
      ['USUARIO', 'FORNECEDOR', 'PECA', 'APROVACAO', 'OUTRO'] as const
    )[i % 5];
    const resolvedAt = resolved ? new Date(startedAt.getTime() + (5 + (i % 9)) * hour) : null;
    const ticket = await db.ticket.create({
      data: {
        description: `Demonstração ${i + 1}: ${category?.name || 'Solicitação em análise'} — atendimento do setor.`,
        organizationId,
        teamId: teamIdOf('TI'),
        requesterName: requester.name,
        openedByUserId: requester.id,
        requesterId: requester.id,
        departmentId: departments[i % departments.length].id,
        impact: (['BLOQUEADO', 'PARCIAL', 'BAIXO'] as const)[i % 3],
        status,
        assigneeId: status === 'NOVO' ? null : principal.id,
        createdAt,
        startedAt: status === 'NOVO' ? null : startedAt,
        resolvedAt,
        categoryId: category?.id,
        complexity,
        waitingReason: status === 'AGUARDANDO' ? reason : null,
        waitingNote: status === 'AGUARDANDO' ? 'Aguardando retorno para prosseguir.' : null,
      },
    });
    const events: Prisma.TicketEventCreateManyInput[] = [
      { ticketId: ticket.id, actorId: requester.id, type: 'CRIADO', toStatus: 'NOVO', createdAt },
    ];
    if (status !== 'NOVO') {
      events.push({
        ticketId: ticket.id,
        actorId: principal.id,
        targetUserId: principal.id,
        type: 'ASSUMIDO',
        fromStatus: 'NOVO',
        toStatus: 'EM_ATENDIMENTO',
        createdAt: startedAt,
      });
      if (i % 3 === 0) {
        const support = technicians[(i + 1) % 3];
        events.push({
          ticketId: ticket.id,
          actorId: principal.id,
          targetUserId: support.id,
          type: 'APOIO_ADICIONADO',
          createdAt: new Date(startedAt.getTime() + hour / 2),
        });
        await db.ticketParticipant.create({
          data: {
            ticketId: ticket.id,
            userId: support.id,
            joinedAt: new Date(startedAt.getTime() + hour / 2),
          },
        });
      }
      if (resolved || status === 'AGUARDANDO')
        events.push({
          ticketId: ticket.id,
          actorId: principal.id,
          type: 'AGUARDANDO',
          fromStatus: 'EM_ATENDIMENTO',
          toStatus: 'AGUARDANDO',
          waitingReason: reason,
          createdAt: new Date(startedAt.getTime() + hour),
        });
      if (resolved) {
        events.push(
          {
            ticketId: ticket.id,
            actorId: principal.id,
            type: 'RETOMADO',
            fromStatus: 'AGUARDANDO',
            toStatus: 'EM_ATENDIMENTO',
            createdAt: new Date(startedAt.getTime() + 3 * hour),
          },
          {
            ticketId: ticket.id,
            actorId: principal.id,
            type: 'RESOLVIDO',
            fromStatus: 'EM_ATENDIMENTO',
            toStatus: 'RESOLVIDO',
            createdAt: resolvedAt!,
          },
        );
      }
    }
    await db.ticketEvent.createMany({
      data: events.sort(
        (a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime(),
      ),
    });
  }
  await addLocations();
  console.log(
    'Demonstração criada em banco separado: 54 chamados, 4 técnicos (1 inativo), 3 funcionários e 1 gestor. Senha: DEMO_PASSWORD do .env.demo; troca obrigatória.',
  );
}
async function addLocations() {
  await db.organization.update({
    where: { id: organizationId },
    data: { name: 'Grupo Demonstração' },
  });
  const companies: Company[] = [];
  for (const direction of ['Norte', 'Sul', 'Leste', 'Oeste']) {
    let company = await db.company.findFirst({
      where: { organizationId, displayName: `Filial ${direction}` },
    });
    if (!company) {
      const base = String(randomInt(10000000, 99999999)) + '0001';
      const cnpj = Array.from({ length: 100 }, (_, i) => base + String(i).padStart(2, '0')).find(
        validCnpj,
      )!;
      company = await db.company.create({
        data: {
          organizationId,
          displayName: `Filial ${direction}`,
          legalName: `Empresa Fictícia ${direction} — Demonstração`,
          cnpj,
        },
      });
    }
    companies.push(company);
  }
  for (const [i, names] of [
    [1, ['Matriz', 'Depósito']],
    [2, ['Loja Centro', 'Centro de Distribuição']],
  ] as const) {
    for (const name of names)
      await db.unit.upsert({
        where: { companyId_name: { companyId: companies[i].id, name } },
        create: { companyId: companies[i].id, name },
        update: {},
      });
  }
  const units = await db.unit.findMany({
    where: { companyId: { in: companies.map((c) => c.id) } },
    orderBy: { name: 'asc' },
  });
  const users = await db.user.findMany({
    where: { organizationId, username: { startsWith: 'demo.' } },
    orderBy: { username: 'asc' },
  });
  for (const [i, user] of users.entries())
    if (!user.primaryCompanyId) {
      const company = companies[i % 4];
      await db.user.update({
        where: { id: user.id },
        data: {
          primaryCompanyId: company.id,
          primaryUnitId: units.find((u) => u.companyId === company.id)?.id || null,
        },
      });
    }
  const tickets = await db.ticket.findMany({
    where: { organizationId, description: { startsWith: 'Demonstração ' }, companyId: null },
    orderBy: { number: 'asc' },
  });
  for (const [i, t] of tickets.entries())
    await db.ticket.update({
      where: { id: t.id },
      data: {
        companyId: companies[i % 4].id,
        unitId: units.find((u) => u.companyId === companies[i % 4].id)?.id || null,
      },
    });
  const tiTeam = await db.team.findUniqueOrThrow({
    where: { organizationId_key: { organizationId, key: 'TI' } },
  });
  const tech = users.find((u) => u.username === 'demo.carlos')!;
  const requester = users.find((u) => u.username === 'demo.ana')!;
  for (let i = 0; i < 6; i++) {
    const id = `demo-quick-location-${i}`;
    if (await db.ticket.findUnique({ where: { id } })) continue;
    const manual = i < 3,
      resolved = i % 2 === 0;
    const createdAt = new Date(Date.now() - (i + 1) * 86400000);
    const resolvedAt = resolved ? new Date(createdAt.getTime() + 3600000) : null;
    await db.$transaction(async (tx) => {
      await tx.ticket.create({
        data: {
          id,
          organizationId,
          teamId: tiTeam.id,
          openedByUserId: tech.id,
          requesterId: manual ? null : requester.id,
          requesterName: manual
            ? ['João - Reposição', 'Marcos - Caixa', 'Ana - Estoque'][i]
            : requester.name,
          departmentId: manual ? null : requester.departmentId,
          companyId: companies[i % 4].id,
          unitId: units.find((u) => u.companyId === companies[i % 4].id)?.id || null,
          description: manual
            ? 'Atendimento informal: impressora não responde.'
            : 'Atendimento rápido registrado para pessoa cadastrada.',
          impact: 'PARCIAL',
          origin: 'ATENDIMENTO_RAPIDO',
          status: resolved ? 'RESOLVIDO' : 'EM_ATENDIMENTO',
          assigneeId: tech.id,
          createdAt,
          startedAt: createdAt,
          resolvedAt,
        },
      });
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: tech.id,
          type: 'CRIADO',
          toStatus: 'EM_ATENDIMENTO',
          createdAt,
        },
      });
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: tech.id,
          targetUserId: tech.id,
          type: 'ASSUMIDO',
          toStatus: 'EM_ATENDIMENTO',
          createdAt,
        },
      });
      if (resolved)
        await tx.ticketEvent.create({
          data: {
            ticketId: id,
            actorId: tech.id,
            type: 'RESOLVIDO',
            fromStatus: 'EM_ATENDIMENTO',
            toStatus: 'RESOLVIDO',
            createdAt: resolvedAt!,
          },
        });
    });
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : 'Falha no seed demo');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
