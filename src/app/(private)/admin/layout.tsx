import { AdminNavigation } from '@/components/navigation';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminNavigation />
      {children}
    </>
  );
}
