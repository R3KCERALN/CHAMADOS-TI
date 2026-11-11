import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { lowStockCount } from '@/lib/stock-service';
import { Shell } from '@/components/shell';
export const dynamic = 'force-dynamic';
export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Check before this segment's loading boundary starts streaming a 200 response.
  if (user.role === 'FUNCIONARIO') {
    const path = (await headers()).get('x-central-pathname') || '';
    if (path === '/estoque' || path.startsWith('/estoque/')) notFound();
  }
  const lowStock = user.role === 'FUNCIONARIO' ? 0 : await lowStockCount(user.id);
  return (
    <Shell user={user} lowStock={lowStock}>
      {children}
    </Shell>
  );
}
