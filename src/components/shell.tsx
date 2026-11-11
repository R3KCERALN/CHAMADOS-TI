import Link from 'next/link';
import { PushControl } from './push-control';
import { Headset, LogOut, KeyRound } from 'lucide-react';
import { logoutAction } from '@/app/actions';
import { roleLabels } from '@/lib/labels';
import type { Role } from '@/generated/prisma/client';
import { Submit } from './form';
import { AppNavigation, MobileNavigation } from './navigation';
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-icon">
        <Headset size={22} strokeWidth={1.8} />
      </span>
      <span>
        Central<span className="brand-sub">DE SUPORTE</span>
      </span>
    </span>
  );
}
export function Shell({
  user,
  children,
  lowStock = 0,
}: {
  user: { id: string; name: string; role: Role };
  children: React.ReactNode;
  lowStock?: number;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand-link" aria-label="Central de Suporte, início">
          <Brand />
        </Link>
        <AppNavigation role={user.role} lowStock={lowStock} />
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Link className="mobile-brand" href="/">
            <Brand />
          </Link>
          <div className="account">
            <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
            <span className="account-name">
              <strong>{user.name}</strong>
              <small>{roleLabels[user.role]}</small>
            </span>
            <Link
              href="/alterar-senha"
              className="icon-button"
              aria-label="Alterar senha"
              title="Alterar senha"
            >
              <KeyRound size={18} />
            </Link>
            <form action={logoutAction}>
              <Submit className="icon-button">
                <LogOut size={18} />
                <span className="sr-only">Sair</span>
              </Submit>
            </form>
          </div>
        </header>
        <MobileNavigation role={user.role} lowStock={lowStock} />
        <main id="main" className="main-content">
          <PushControl userId={user.id} />
          {children}
        </main>
      </div>
    </div>
  );
}
