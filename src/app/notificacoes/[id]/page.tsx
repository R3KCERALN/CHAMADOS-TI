import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getSessionUser } from '@/lib/auth-service';
import { SESSION_COOKIE } from '@/lib/auth';
import { ticketReturnTo } from '@/lib/return-to';
import { getTicket } from '@/lib/services';
import { AppError } from '@/lib/errors';
export default async function NotificationLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const destination = ticketReturnTo(`/chamados/${id}`);
  if (destination === '/') notFound();
  const user = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  const next = encodeURIComponent(destination);
  if (!user) redirect(`/login?next=${next}`);
  if (user.mustChangePassword) redirect(`/alterar-senha?next=${next}`);
  await getTicket(user.id, id).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  redirect(destination);
}
