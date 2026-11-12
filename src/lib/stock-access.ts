import { db } from './db';
import { actor } from './access';
import { AppError } from './errors';
import type { Prisma, Role } from '@/generated/prisma/client';
type Tx = Prisma.TransactionClient;
export type StockNeed = 'view' | 'operate' | 'keep' | 'review';
const needRoles: Record<StockNeed, Role[]> = {
  view: ['TI', 'ADMIN', 'GESTOR'],
  operate: ['TI', 'ADMIN'],
  keep: ['TI', 'ADMIN'],
  review: ['GESTOR', 'ADMIN'],
};
export async function stockActor(client: Tx | typeof db, actorId: string, need: StockNeed) {
  const user = await actor(client as Tx, actorId);
  const keeper = user.role === 'ADMIN' || (user.role === 'TI' && user.stockKeeper);
  if (!needRoles[need].includes(user.role) || (need === 'keep' && !keeper)) {
    throw user.role === 'FUNCIONARIO'
      ? new AppError('Página não encontrada.', 404)
      : new AppError('Você não tem permissão para esta operação.', 403);
  }
  return { ...user, stockKeeper: user.stockKeeper, keeper };
}
export async function teamsWithoutStockKeeper(
  organizationId: string,
): Promise<{ id: string; name: string }[]> {
  return db.team.findMany({
    where: {
      organizationId,
      active: true,
      users: { none: { role: 'TI', active: true, stockKeeper: true } },
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}
