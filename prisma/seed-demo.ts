import 'dotenv/config';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth-service';
import type {
  Role,
  TicketStatus,
  Complexity,
  WaitingReason,
  Prisma,
} from '../src/generated/prisma/client';
async function main() {
  const name = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  if (process.env.SEED_DEMO !== 'true' || !name.endsWith('_demo'))
    throw new Error(
      'Seed fictício permitido somente com SEED_DEMO=true em banco terminado em _demo.',
    );
  if (!process.env.DEMO_PASSWORD) throw new Error('Configure DEMO_PASSWORD.');
  if (await db.user.findUnique({ where: { username: 'demo.gestor' } })) {
    console.log('Demonstração já existente; nenhum dado foi recriado.');
    return;
  }
  const hash = await hashPassword(process.env.DEMO_PASSWORD);
  const departments = await db.department.findMany({ orderBy: { name: 'asc' } });
  const categories = await db.category.findMany({ orderBy: { name: 'asc' } });
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
  ] as const;
  const users = [];
  for (let i = 0; i < people.length; i++) {
    const [username, name, role] = people[i];
    users.push(
      await db.user.create({
        data: {
          username,
          name,
          role: role as Role,
          departmentId: role === 'TI' ? ti.id : departments[i % departments.length].id,
          passwordHash: hash,
          mustChangePassword: true,
          active: username !== 'demo.inativo',
        },
      }),
    );
  }
  const technicians = users.slice(1, 5),
    requesters = users.slice(5);
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
  console.log(
    'Demonstração criada em banco separado: 54 chamados, 4 técnicos (1 inativo), 3 funcionários e 1 gestor. Senha: DEMO_PASSWORD do .env.demo; troca obrigatória.',
  );
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : 'Falha no seed demo');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
