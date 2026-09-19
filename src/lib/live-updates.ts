import { actor } from './access';
import { db } from './db';
import { localDate } from './period';
export async function operationalRevision(userId: string) {
  const user = await actor(db, userId, ['TI', 'ADMIN', 'FUNCIONARIO']);
  const row =
    user.role === 'FUNCIONARIO'
      ? await db.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { ticketRevision: true },
        })
      : await db.organization.findUniqueOrThrow({
          where: { id: user.organizationId },
          select: { ticketRevision: true },
        });
  return `${row.ticketRevision}:${localDate(new Date())}`;
}
