import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/auth-service';
import { SESSION_COOKIE } from '@/lib/auth';
import { db } from '@/lib/db';
export async function GET(request: Request) {
  const user = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) return new Response('Autenticação necessária.', { status: 401 });
  if (user.mustChangePassword || !['TI', 'ADMIN'].includes(user.role))
    return new Response('Acesso não permitido.', { status: 403 });
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (q.length > 100) return new Response('Busca inválida.', { status: 400 });
  const people = await db.user.findMany({
    where: {
      organizationId: user.organizationId,
      active: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { department: { name: { contains: q, mode: 'insensitive' } } },
      ],
    },
    select: {
      id: true,
      name: true,
      department: { select: { name: true } },
      primaryCompanyId: true,
      primaryUnitId: true,
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 15,
  });
  return Response.json(people, { headers: { 'Cache-Control': 'private, no-store' } });
}
