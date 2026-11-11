import type { Prisma, TicketEvent } from '@/generated/prisma/client';

export async function recordTicketEvent(
  tx: Prisma.TransactionClient,
  args: Prisma.TicketEventCreateArgs,
) {
  const event = await tx.ticketEvent.create(args);
  await queueEventNotifications(tx, event);
  return event;
}
// Subscription-level outbox is committed atomically with the event. No network in this transaction.
export async function queueEventNotifications(tx: Prisma.TransactionClient, event: TicketEvent) {
  const ticket = await tx.ticket.findUniqueOrThrow({
    where: { id: event.ticketId },
    include: { participants: true },
  });
  let recipients: Prisma.UserWhereInput | undefined;
  if (event.type === 'CRIADO' && ticket.origin === 'PORTAL')
    recipients = { role: 'TI', teamId: ticket.teamId };
  else if (event.type === 'EQUIPE_ALTERADA') recipients = { role: 'TI', teamId: ticket.teamId };
  else if (['RESPONSAVEL_ALTERADO', 'APOIO_ADICIONADO'].includes(event.type) && event.targetUserId)
    recipients = { id: event.targetUserId };
  else if (event.type === 'RESOLVIDO' && ticket.requesterId)
    recipients = { id: ticket.requesterId };
  else if (event.type === 'COMENTARIO') {
    if (event.actorId === ticket.requesterId)
      recipients = {
        id: {
          in: [ticket.assigneeId, ...ticket.participants.map((p) => p.userId)].filter(
            (v): v is string => !!v,
          ),
        },
      };
    else {
      const author = await tx.user.findUniqueOrThrow({
        where: { id: event.actorId },
        select: { role: true },
      });
      if (['TI', 'ADMIN'].includes(author.role) && ticket.requesterId)
        recipients = { id: ticket.requesterId };
    }
  }
  if (!recipients) return;
  const subscriptions = await tx.pushSubscription.findMany({
    where: {
      active: true,
      organizationId: ticket.organizationId,
      user: {
        AND: [
          recipients,
          {
            id: { not: event.actorId },
            active: true,
            mustChangePassword: false,
            organizationId: ticket.organizationId,
            organization: { active: true },
            OR: [
              { role: { in: ['TI', 'ADMIN'] } },
              { role: 'FUNCIONARIO', id: ticket.requesterId || '' },
            ],
          },
        ],
      },
    },
    select: { id: true },
  });
  if (subscriptions.length)
    await tx.pushDelivery.createMany({
      data: subscriptions.map((subscription) => ({
        eventId: event.id,
        subscriptionId: subscription.id,
      })),
      skipDuplicates: true,
    });
}
