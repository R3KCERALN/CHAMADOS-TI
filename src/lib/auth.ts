import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionUser } from './auth-service';
import { AppError } from './errors';
import type { Role } from '@/generated/prisma/client';
export const SESSION_COOKIE =
  process.env.COOKIE_SECURE !== 'false' ? '__Host-central_session' : 'central_session';
// Render-only memo: the layout and the page of one request share a single session read.
const renderSessionUser = cache(getSessionUser);
async function currentUser(
  read: typeof getSessionUser,
  roles?: Role[],
  allowPasswordChange = false,
) {
  const user = await read((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect('/login');
  if (user.mustChangePassword && !allowPasswordChange) redirect('/alterar-senha');
  if (roles && !roles.includes(user.role))
    throw new AppError('Você não tem permissão para acessar esta área.', 403);
  return user;
}
// Pages and layouts.
export const requireUser = (roles?: Role[], allowPasswordChange = false) =>
  currentUser(renderSessionUser, roles, allowPasswordChange);
// Server Actions change sessions and users, and a redirect can render the next page in the
// same request: always read the session fresh so a revoked session is never reused.
export const requireActionUser = (roles?: Role[], allowPasswordChange = false) =>
  currentUser(getSessionUser, roles, allowPasswordChange);
