import Link from 'next/link';
import {
  Headset,
  LayoutGrid,
  ListTodo,
  Users,
  ChartNoAxesCombined,
  Plus,
  ArrowUpRight,
  LogOut,
  KeyRound,
} from 'lucide-react';
import { logoutAction } from '@/app/actions';
import { organizationLabels as labels } from '@/lib/organization-labels';
import { roleLabels } from '@/lib/labels';
import type { Role } from '@/generated/prisma/client';
import { Submit } from './form';
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
}: {
  user: { name: string; role: Role };
  children: React.ReactNode;
}) {
  const tech = user.role === 'TI' || user.role === 'ADMIN';
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand-link" aria-label="Central de Suporte, início">
          <Brand />
        </Link>
        <p className="nav-label">ESPAÇO DE TRABALHO</p>
        <nav aria-label="Navegação principal">
          <Link href="/">
            <LayoutGrid size={19} /> Visão geral
          </Link>
          {user.role !== 'GESTOR' && (
            <Link href="/chamados">
              <ListTodo size={19} /> {user.role === 'FUNCIONARIO' ? 'Meus chamados' : 'Chamados'}
            </Link>
          )}
          {user.role === 'ADMIN' && (
            <Link href="/admin/usuarios">
              <Users size={19} /> Usuários
            </Link>
          )}
          {user.role === 'ADMIN' && (
            <>
              <Link href="/admin/filiais">
                <ListTodo size={19} />
                {labels.companies}
              </Link>
              <Link href="/admin/unidades">
                <ListTodo size={19} />
                {labels.units}
              </Link>
            </>
          )}
          {['GESTOR', 'ADMIN'].includes(user.role) && (
            <Link href="/gestor">
              <ChartNoAxesCombined size={19} /> Indicadores
            </Link>
          )}
          {user.role === 'ADMIN' && (
            <Link href="/admin/categorias">
              <ListTodo size={19} /> Categorias
            </Link>
          )}
        </nav>
        {tech && (
          <Link href="/atendimento-rapido" className="quick-sidebar">
            <Plus size={19} /> Atendimento rápido <ArrowUpRight size={16} />
          </Link>
        )}
        <div className="sidebar-bottom">
          <span className="connection-dot" /> Ambiente interno
          <span className="version">VERSÃO 1.2</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="workspace-label">Atendimento próximo. Trabalho em movimento.</span>
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
        <nav className="mobile-nav" aria-label="Navegação mobile">
          <Link href="/">Início</Link>
          {user.role !== 'GESTOR' && <Link href="/chamados">Chamados</Link>}
          {tech && <Link href="/atendimento-rapido">+ Rápido</Link>}
          {user.role === 'ADMIN' && (
            <>
              <Link href="/admin/usuarios">Usuários</Link>
              <Link href="/admin/filiais">{labels.companies}</Link>
              <Link href="/admin/unidades">{labels.units}</Link>
            </>
          )}
          {['GESTOR', 'ADMIN'].includes(user.role) && <Link href="/gestor">Indicadores</Link>}
        </nav>
        <main id="main" className="main-content">
          {children}
        </main>
        <footer className="footer">
          Central de Suporte <span>Um registro simples. Um atendimento que faz a diferença.</span>
        </footer>
      </div>
    </div>
  );
}
