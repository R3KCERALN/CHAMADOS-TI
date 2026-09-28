import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionUser } from './auth-service';
import { AppError } from './errors';
import type { Role } from '@/generated/prisma/client';
export const SESSION_COOKIE =
  process.env.COOKIE_SECURE !== 'false' ? '__Host-central_session' : 'central_session';
export async function requireUser(roles?: Role[], allowPasswordChange = false) {
  const user = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect('/login');
  if (user.mustChangePassword && !allowPasswordChange) redirect('/alterar-senha');
  if (roles && !roles.includes(user.role))
    throw new AppError('Você não tem permissão para acessar esta área.', 403);
  return user;
}
