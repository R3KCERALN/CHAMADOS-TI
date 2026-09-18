import { publicUserSelect } from './auth-service';
import { AppError } from './errors';
import type { Prisma, Role } from '@/generated/prisma/client';
type Tx = Prisma.TransactionClient;
export async function actor(tx: Tx, id: string, roles?: Role[]) {
  const user = await tx.user.findUnique({ where: { id }, select: publicUserSelect });
  if (!user?.active || !user.organization.active || user.mustChangePassword)
    throw new AppError('Sua sessão não permite esta operação. Entre novamente.', 401);
  if (roles && !roles.includes(user.role))
    throw new AppError('Você não tem permissão para esta operação.', 403);
  return user;
}
