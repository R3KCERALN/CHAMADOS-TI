import { cookies } from 'next/headers';
import { getSessionUser } from './auth-service';
import { SESSION_COOKIE } from './auth';
import { AppError } from './errors';
import { ZodError } from 'zod';
export function verifyOrigin(origin: string | null) {
  if (origin !== new URL(process.env.APP_URL || 'http://localhost:3000').origin)
    throw new AppError('Origem da solicitação inválida.', 403);
}
export async function operationalSession({ allowManager = false } = {}) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  if (!user || !token) throw new AppError('Autenticação necessária.', 401);
  if (user.mustChangePassword || (user.role === 'GESTOR' && !allowManager))
    throw new AppError('Acesso não permitido.', 403);
  return { user, token };
}
export const privateHeaders = { 'Cache-Control': 'private, no-store' };
export function apiError(error: unknown) {
  const status = error instanceof AppError ? error.status : error instanceof ZodError ? 400 : 500;
  if (status === 500) console.error('notification_api_failed');
  return Response.json(
    {
      error:
        error instanceof AppError
          ? error.message
          : status === 400
            ? 'Dados inválidos.'
            : 'Não foi possível concluir a operação.',
    },
    { status, headers: privateHeaders },
  );
}
