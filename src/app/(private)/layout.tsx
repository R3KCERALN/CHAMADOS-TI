import { requireUser } from '@/lib/auth';
import { lowStockCount } from '@/lib/stock-service';
import { Shell } from '@/components/shell';
export const dynamic = 'force-dynamic';
export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const lowStock = user.role === 'FUNCIONARIO' ? 0 : await lowStockCount(user.id);
  return <Shell user={user} lowStock={lowStock}>{children}</Shell>;
}
