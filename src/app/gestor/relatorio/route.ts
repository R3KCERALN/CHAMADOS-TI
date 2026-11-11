import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/auth-service';
import { SESSION_COOKIE } from '@/lib/auth';
import { managementAccess } from '@/lib/analytics-service';
import { analyticsFilters } from '@/lib/analytics-query';
import { AppError } from '@/lib/errors';
import { buildManagementPdf, pdfScreens, type PdfScreen } from '@/lib/management-pdf';
import { renderReportPdf } from '@/lib/pdf-report';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const user = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) return new Response('Autenticação necessária.', { status: 401 });
  if (user.mustChangePassword || !['GESTOR', 'ADMIN'].includes(user.role))
    return new Response('Acesso não permitido.', { status: 403 });
  await managementAccess(user.id);
  const input = Object.fromEntries(new URL(request.url).searchParams);
  const screen = input.tela as PdfScreen;
  if (!pdfScreens.includes(screen)) return new Response('Relatório inválido.', { status: 400 });
  const now = new Date();
  try {
    analyticsFilters(input, now);
  } catch {
    return new Response('Filtros inválidos.', { status: 400 });
  }
  try {
    const report = await buildManagementPdf(user.id, screen, input, input.id, { now });
    const pdf = await renderReportPdf(report);
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="central-suporte-${screen}.pdf"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof AppError && error.status < 500)
      return new Response(error.message, { status: error.status });
    return new Response('Não foi possível gerar o PDF. Tente novamente.', { status: 500 });
  }
}
