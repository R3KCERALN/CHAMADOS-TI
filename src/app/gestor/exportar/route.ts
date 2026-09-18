import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/auth-service';
import { SESSION_COOKIE } from '@/lib/auth';
import { managementAccess, exportRows } from '@/lib/analytics-service';
import { analyticsFilters } from '@/lib/analytics-query';
import { csvHeader, csvRow } from '@/lib/csv';
import { db } from '@/lib/db';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const user = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) return new Response('Autenticação necessária.', { status: 401 });
  if (user.mustChangePassword || !['GESTOR', 'ADMIN'].includes(user.role))
    return new Response('Acesso não permitido.', { status: 403 });
  await managementAccess(user.id);
  const input = Object.fromEntries(new URL(request.url).searchParams);
  const now = new Date();
  try {
    analyticsFilters(input, now);
  } catch {
    return new Response('Filtros inválidos.', { status: 400 });
  }
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode('\uFEFF' + csvHeader));
        await db.$transaction(
          async (tx) => {
            let after = 0;
            while (!cancelled) {
              const rows = await exportRows(user.id, input, now, after, 500, tx);
              if (!rows.length) break;
              if (cancelled) break;
              controller.enqueue(encoder.encode(rows.map(csvRow).join('')));
              after = rows[rows.length - 1].number;
            }
          },
          { isolationLevel: 'RepeatableRead', timeout: 120000 },
        );
        if (!cancelled) controller.close();
      } catch {
        if (!cancelled)
          controller.error(new Error('Exportação interrompida. Tente um período menor.'));
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="central-suporte.csv"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
