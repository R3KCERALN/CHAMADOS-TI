import type { Prisma, StockAlert } from '@/generated/prisma/client';
export async function queueStockAlertNotifications(
  tx: Prisma.TransactionClient,
  alert: StockAlert,
  actorId: string | null,
) {
  const subscriptions = await tx.pushSubscription.findMany({
    where: {
      active: true,
      organizationId: alert.organizationId,
      user: {
        role: { in: ['TI', 'GESTOR', 'ADMIN'] },
        active: true,
        mustChangePassword: false,
        organizationId: alert.organizationId,
        organization: { active: true },
        ...(actorId && { id: { not: actorId } }),
      },
    },
    select: { id: true },
  });
  if (subscriptions.length)
    await tx.pushDelivery.createMany({
      data: subscriptions.map((s) => ({ stockAlertId: alert.id, subscriptionId: s.id })),
      skipDuplicates: true,
    });
}
