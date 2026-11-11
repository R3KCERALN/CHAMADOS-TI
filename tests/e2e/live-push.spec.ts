import { test, expect, type Browser } from '@playwright/test';
import { randomBytes, createECDH } from 'node:crypto';
import { db } from '../../src/lib/db';
import { hashPassword, login } from '../../src/lib/auth-service';
import { APP_ORGANIZATION_ID } from '../../src/lib/config';
import * as service from '../../src/lib/services';
import { syntheticCnpj, teamId } from '../fixtures';
import type { Role } from '../../src/generated/prisma/client';
let employee: string, tech: string, tech2: string, tiTeam: string;
const password = process.env.TEST_PASSWORD!;
async function session(browser: Browser, id: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id } });
  const auth = await login(user.username, password);
  const context = await browser.newContext({
    baseURL: 'http://localhost:3100',
    viewport: { width: 390, height: 844 },
  });
  await context.addCookies([
    {
      name: process.env.COOKIE_SECURE === 'false' ? 'central_session' : '__Host-central_session',
      value: auth.token,
      url: 'http://localhost:3100',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  return context;
}
test.beforeAll(async () => {
  const organizationId = APP_ORGANIZATION_ID;
  tiTeam = await teamId(organizationId, 'TI');
  const company = await db.company.create({
    data: { organizationId, displayName: 'Local Atualização', cnpj: syntheticCnpj() },
  });
  const department = await db.department.create({
    data: { organizationId, name: 'Realtime ' + randomBytes(4).toString('hex') },
  });
  const hash = await hashPassword(password);
  [employee, tech, tech2] = await Promise.all(
    (['FUNCIONARIO', 'TI', 'TI'] as Role[]).map(
      async (role) =>
        (
          await db.user.create({
            data: {
              role,
              organizationId,
              departmentId: department.id,
              primaryCompanyId: company.id,
              name: `Realtime ${role}`,
              username: `live.${randomBytes(6).toString('hex')}`,
              passwordHash: hash,
              mustChangePassword: false,
              ...(role === 'TI' && { teamId: tiTeam }),
            },
          })
        ).id,
    ),
  );
});
test.afterAll(() => db.$disconnect());
test('fila, contadores e detalhes atualizam sem reload, preservando filtros e rascunho no mobile', async ({
  browser,
}) => {
  const context = await session(browser, tech);
  const page = await context.newPage();
  let documentRequests = 0;
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documentRequests++;
  });
  await page.goto('/chamados?filtro=novos&q=Teste-ao-vivo');
  await expect(page.getByText('Atualização automática ativa')).toBeVisible();
  const requests = documentRequests;
  const ticket = await service.createTicket(employee, {
    description: 'Teste-ao-vivo automático',
    impact: 'PARCIAL',
    teamId: tiTeam,
  });
  const row = page.locator(`.ticket-row[href="/chamados/${ticket.id}"]`);
  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(/filtro=novos&q=Teste-ao-vivo/);
  await expect(page.getByLabel('Buscar chamado')).toHaveValue('Teste-ao-vivo');
  expect(documentRequests).toBe(requests);
  await service.claimTicket(tech, ticket.id);
  await expect(row).toHaveCount(0, { timeout: 15000 });
  await page.goto('/');
  const ongoing = page.locator('a[href="/chamados?filtro=atendimento"]');
  await expect(ongoing.locator('strong')).toHaveText('01');
  await service.changeStatus(tech, ticket.id, { status: 'AGUARDANDO', waitingReason: 'USUARIO' });
  await expect(ongoing.locator('strong')).toHaveText('00', { timeout: 15000 });
  await page.goto(`/chamados/${ticket.id}`);
  const comment = page.getByLabel('Adicionar comentário');
  await comment.fill('Rascunho que precisa permanecer');
  await service.addComment(employee, ticket.id, 'Comentário remoto visível');
  await expect(page.getByText('Há atualizações disponíveis.')).toBeVisible({ timeout: 15000 });
  await expect(comment).toHaveValue('Rascunho que precisa permanecer');
  await page.getByRole('button', { name: 'Atualizar dados' }).click();
  await expect(page.getByText('Comentário remoto visível', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(comment).toHaveValue('Rascunho que precisa permanecer');
  await comment.fill('');
  await page.goto(`/chamados/${ticket.id}`);
  await service.setSupport(tech, ticket.id, tech2, true);
  await expect(page.locator('.timeline').getByText('Técnico de apoio adicionado')).toBeVisible({
    timeout: 15000,
  });
  await service.setSupport(tech, ticket.id, tech2, false);
  await expect(page.locator('.timeline').getByText('Técnico de apoio removido')).toBeVisible({
    timeout: 15000,
  });
  await service.assignTicket(tech, ticket.id, tech2);
  await expect(page.locator('.timeline').getByText('Responsável transferido')).toBeVisible({
    timeout: 15000,
  });
  await service.changeStatus(tech2, ticket.id, { status: 'RESOLVIDO' });
  await expect(page.locator('.status-RESOLVIDO')).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await context.close();
});
test('endpoints exigem autenticação/origem; inscrição não aceita terceiro; link conserva destino após login', async ({
  browser,
  request,
}) => {
  expect((await request.get('/api/operacao/revisao')).status()).toBe(401);
  expect((await request.get('/api/push/subscriptions')).status()).toBe(401);
  const context = await session(browser, tech);
  const key = createECDH('prime256v1');
  key.generateKeys();
  const input = {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(16).toString('hex')}`,
    keys: {
      p256dh: key.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
  const endpoint = '/api/push/subscriptions';
  expect(
    (
      await context.request.post(endpoint, {
        data: input,
        headers: { Origin: 'https://outro.example' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.post(endpoint, {
        data: { ...input, userId: tech2 },
        headers: { Origin: 'http://localhost:3100' },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await context.request.post(endpoint, {
        data: input,
        headers: { Origin: 'http://localhost:3100' },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await context.request.delete(endpoint, {
        data: { endpoint: input.endpoint },
        headers: { Origin: 'http://localhost:3100' },
      })
    ).status(),
  ).toBe(200);
  await context.close();
  const ticket = await service.createTicket(employee, {
    description: 'Destino do push após login',
    impact: 'BAIXO',
    teamId: tiTeam,
  });
  const clean = await browser.newContext();
  const page = await clean.newPage();
  await page.goto(`http://localhost:3100/notificacoes/${ticket.id}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  const user = await db.user.findUniqueOrThrow({ where: { id: employee } });
  await page.getByLabel('Usuário', { exact: true }).fill(user.username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/chamados/${ticket.id}$`));
  await clean.close();
});
test('permissão push só é solicitada por clique e estado negado é explicado', async ({
  browser,
}) => {
  const context = await session(browser, tech);
  await context.addInitScript(() => {
    let count = 0;
    Object.defineProperty(Notification, 'requestPermission', {
      value: async () => {
        count++;
        (window as unknown as { permissionCalls: number }).permissionCalls = count;
        return 'denied';
      },
    });
    (window as unknown as { permissionCalls: number }).permissionCalls = 0;
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Ativar notificações' })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { permissionCalls: number }).permissionCalls),
  ).toBe(0);
  await page.getByRole('button', { name: 'Ativar notificações' }).click();
  await expect(page.getByText(/Notificações bloqueadas/)).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { permissionCalls: number }).permissionCalls),
  ).toBe(1);
  await context.close();
  const unsupported = await session(browser, tech);
  await unsupported.addInitScript(() => {
    Reflect.deleteProperty(window, 'PushManager');
  });
  const unsupportedPage = await unsupported.newPage();
  await unsupportedPage.goto('/');
  await expect(
    unsupportedPage.getByText(/Notificações indisponíveis neste navegador/),
  ).toBeVisible();
  await expect(unsupportedPage.getByRole('button', { name: 'Ativar notificações' })).toHaveCount(0);
  await unsupported.close();
});

test('service worker mostra payload mínimo e deduplica evento mesmo após fechar aviso', async ({
  browser,
}) => {
  const context = await session(browser, tech);
  await context.grantPermissions(['notifications']);
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const worker = context.serviceWorkers().find((candidate) => candidate.url().endsWith('/sw.js'))!;
  expect(worker).toBeTruthy();
  const payload = {
    title: 'CS-0001 · Novo chamado',
    body: 'Filial teste',
    tag: 'receipt-test-event',
    url: '/notificacoes/test-ticket',
  };
  await worker.evaluate(async (value) => {
    await (
      globalThis as unknown as {
        showPush: (event: { data: { json: () => unknown } }) => Promise<void>;
      }
    ).showPush({ data: { json: () => value } });
  }, payload);
  expect(
    await worker.evaluate(
      async () =>
        (
          await (
            globalThis as unknown as { registration: ServiceWorkerRegistration }
          ).registration.getNotifications()
        ).length,
    ),
  ).toBe(1);
  await worker.evaluate(async () => {
    for (const notice of await (
      globalThis as unknown as { registration: ServiceWorkerRegistration }
    ).registration.getNotifications())
      notice.close();
  });
  await worker.evaluate(async (value) => {
    await (
      globalThis as unknown as {
        showPush: (event: { data: { json: () => unknown } }) => Promise<void>;
      }
    ).showPush({ data: { json: () => value } });
  }, payload);
  expect(
    await worker.evaluate(
      async () =>
        (
          await (
            globalThis as unknown as { registration: ServiceWorkerRegistration }
          ).registration.getNotifications()
        ).length,
    ),
  ).toBe(0);
  await context.close();
});
