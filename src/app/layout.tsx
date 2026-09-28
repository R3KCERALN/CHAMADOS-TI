import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PwaRegister } from '@/components/pwa-register';
import { connection } from 'next/server';
export const metadata: Metadata = {
  title: { default: 'Central de Suporte', template: '%s · Central de Suporte' },
  description: 'Seu ponto de apoio no dia a dia. Atendimento interno de TI.',
  applicationName: 'Central de Suporte',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Central' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
};
export const viewport: Viewport = { themeColor: '#176b57', width: 'device-width', initialScale: 1 };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <html lang="pt-BR">
      <body>
        <a className="skip-link" href="#main">
          Pular para o conteúdo
        </a>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
