'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  LayoutGrid,
  ListTodo,
  Plus,
  Settings2,
  Boxes,
} from 'lucide-react';
import type { Role } from '@/generated/prisma/client';
import { organizationLabels as labels } from '@/lib/organization-labels';

type Item = {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  exact?: boolean;
  quick?: boolean;
  activePrefix?: string;
  mobileLabel?: string;
};

function current(pathname: string, item: Item) {
  if (item.exact) return pathname === item.href;
  return pathname.startsWith(item.activePrefix || item.href);
}

export function AppNavigation({ role, lowStock = 0 }: { role: Role; lowStock?: number }) {
  const pathname = usePathname();
  const tech = role === 'TI' || role === 'ADMIN';
  const items = navigationItems(role);
  return (
    <>
      <nav className="desktop-nav" aria-label="Navegação principal">
        {items.map((item) => {
          const Icon = item.icon;
          const active = current(pathname, item);
          return (
            <Link
              href={item.href}
              key={item.href}
              className={active ? 'active' : undefined}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={19} aria-hidden="true" />
              {item.label}
              {item.href === '/estoque' && lowStock > 0 && (
                <span className="nav-badge" aria-label={`${lowStock} materiais acabando`}>
                  {lowStock}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {tech && (
        <Link
          href="/atendimento-rapido"
          className={`quick-sidebar${pathname === '/atendimento-rapido' ? ' active' : ''}`}
          aria-current={pathname === '/atendimento-rapido' ? 'page' : undefined}
        >
          <Plus size={19} aria-hidden="true" /> Atendimento rápido{' '}
          <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      )}
    </>
  );
}

function navigationItems(role: Role): Item[] {
  return [
    ...(role === 'GESTOR'
      ? []
      : [{ href: '/', label: 'Visão geral', icon: LayoutGrid, exact: true }]),
    ...(role !== 'GESTOR'
      ? [
          {
            href: '/chamados',
            label: role === 'FUNCIONARIO' ? 'Meus chamados' : 'Chamados',
            icon: ListTodo,
          },
        ]
      : []),
    ...(['TI', 'ADMIN', 'GESTOR'].includes(role)
      ? [{ href: '/estoque', label: 'Estoque', icon: Boxes }]
      : []),
    ...(role === 'ADMIN'
      ? [
          {
            href: '/admin/usuarios',
            label: 'Administração',
            mobileLabel: 'Admin',
            icon: Settings2,
            activePrefix: '/admin',
          },
        ]
      : []),
    ...(['GESTOR', 'ADMIN'].includes(role)
      ? [{ href: '/gestor', label: 'Indicadores', icon: ChartNoAxesCombined }]
      : []),
  ];
}

export function MobileNavigation({ role, lowStock = 0 }: { role: Role; lowStock?: number }) {
  const pathname = usePathname();
  const tech = role === 'TI' || role === 'ADMIN';
  const mobileItems: Item[] = [
    ...navigationItems(role),
    ...(tech ? [{ href: '/atendimento-rapido', label: '+ Rápido', icon: Plus, quick: true }] : []),
  ];
  if (tech) {
    const quick = mobileItems.pop()!;
    mobileItems.splice(Math.min(2, mobileItems.length), 0, quick);
  }
  return (
    <nav className="mobile-nav" aria-label="Navegação principal">
      {mobileItems.slice(0, 6).map((item) => {
        const active = current(pathname, item);
        return (
          <Link
            href={item.href}
            key={item.href}
            className={`${item.quick ? 'quick' : ''}${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {item.mobileLabel || item.label}
            {item.href === '/estoque' && lowStock > 0 && (
              <span className="nav-badge" aria-label={`${lowStock} materiais acabando`}>
                {lowStock}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminNavigation() {
  const pathname = usePathname();
  const items = [
    ['/admin/usuarios', 'Usuários'],
    ['/admin/filiais', labels.companies],
    ['/admin/unidades', labels.units],
    ['/admin/categorias', 'Categorias'],
  ];
  return (
    <nav className="admin-section-nav" aria-label="Cadastros da administração">
      {items.map(([href, label]) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            href={href}
            key={href}
            className={active ? 'active' : undefined}
            aria-current={active ? 'page' : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
