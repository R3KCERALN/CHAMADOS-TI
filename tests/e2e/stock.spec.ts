import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { stockFixture } from '../stock-fixtures';
import { syntheticCnpj } from '../fixtures';
import { db } from '../../src/lib/db';
import { createTicket, claimTicket } from '../../src/lib/services';
import { createItem, recordOffTicketUse } from '../../src/lib/stock-service';
import { processAuthorizationPhoto } from '../../src/lib/stock-photo';
test.use({ viewport: { width: 390, height: 844 }, actionTimeout: 10000 });
let f: Awaited<ReturnType<typeof stockFixture>>, ticketId: string, privatePhoto: string;
const password = process.env.TEST_PASSWORD!;
async function login(page: Page, id: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id } });
  await page.goto('/login');
  await page.getByLabel('Usuário', { exact: true }).fill(user.username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?.*)?$/);
}
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await page.locator('.mobile-nav').evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(
    true,
  );
}
test.beforeAll(async () => {
  f = await stockFixture();
  const company = await db.company.create({
    data: { organizationId: f.organizationId, displayName: 'Estoque E2E', cnpj: syntheticCnpj() },
  });
  await db.user.update({ where: { id: f.employee }, data: { primaryCompanyId: company.id } });
  const ticket = await createTicket(f.employee, {
    description: 'Instalar cabo de rede na sala de manutenção',
    impact: 'PARCIAL',
    teamId: f.ti,
  });
  await claimTicket(f.tech, ticket.id);
  ticketId = ticket.id;
  const { item } = await createItem(f.admin, {
    kind: 'MATERIAL',
    name: 'Autorização privada ' + randomUUID(),
    teamId: f.ti,
    unit: 'METRO',
    initialQuantity: '5',
    requestId: randomUUID(),
  });
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  privatePhoto = (
    await recordOffTicketUse(
      f.other,
      { itemId: item.id, quantity: '1', requestId: randomUUID() },
      await processAuthorizationPhoto(png),
    )
  ).id;
});
test.afterAll(() => db.$disconnect());
test('estoque no celular: pegar ferramenta, usar material no chamado e fora dele com foto, conferência pelo gestor', async ({
  page,
}) => {
  await mkdir('test-results/screenshots', { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, f.admin);
  await page.goto(`/admin/usuarios/${f.tech}`);
  await page.getByLabel('Responsável de estoque', { exact: true }).check();
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Usuário atualizado');
  await logout(page);
  await login(page, f.tech);
  const toolName = 'Alicate E2E ' + randomUUID().slice(0, 8),
    materialName = 'Cabo E2E ' + randomUUID().slice(0, 8);
  for (const material of [false, true]) {
    await page.goto('/estoque/itens/novo');
    await page
      .getByLabel('Tipo', { exact: true })
      .selectOption(material ? 'MATERIAL' : 'FERRAMENTA');
    await page.getByLabel('Nome', { exact: true }).fill(material ? materialName : toolName);
    await page.getByLabel('Equipe', { exact: true }).selectOption(f.ti);
    if (material) {
      await page.getByLabel('Unidade (material)', { exact: true }).selectOption('METRO');
      await page.getByLabel('Estoque mínimo (material)', { exact: true }).fill('2');
      await page.getByLabel('Quantidade inicial (material)', { exact: true }).fill('3');
    }
    await page.getByRole('button', { name: 'Criar item', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Item cadastrado');
  }
  await page.goto('/estoque');
  const toolCard = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: toolName, exact: true }) });
  await toolCard.getByRole('button', { name: 'Peguei', exact: true }).click();
  await expect(toolCard).toContainText('Com Pessoa TI');
  await page.screenshot({
    path: 'test-results/screenshots/stock-tools-mobile.png',
    fullPage: true,
  });
  await noOverflow(page);
  await toolCard.getByRole('button', { name: 'Devolvi', exact: true }).click();
  await expect(toolCard).toContainText('Guardada');
  await page.goto(`/chamados/${ticketId}`);
  const materials = page.getByRole('region', { name: 'Materiais usados' });
  await materials
    .getByLabel('Material', { exact: true })
    .selectOption({ label: materialName + ' · TI' });
  await materials.getByLabel('Quantidade', { exact: true }).fill('1');
  await materials.getByRole('button', { name: 'Registrar material', exact: true }).click();
  await expect(materials.getByRole('status')).toContainText('Material registrado');
  await expect(page.locator('.mobile-nav').getByLabel(/materiais acabando/)).toBeVisible();
  await page.goto('/estoque?aba=materiais');
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: materialName, exact: true }) });
  await expect(card).toContainText('Acabando');
  await card.getByRole('link', { name: 'Usar fora de chamado' }).click();
  await page.getByLabel('Quantidade', { exact: true }).fill('1');
  await page.getByLabel('Foto da autorização').setInputFiles({
    name: 'autorizacao.png',
    mimeType: 'image/png',
    buffer: await sharp({ create: { width: 300, height: 200, channels: 3, background: '#ffffff' } })
      .png()
      .toBuffer(),
  });
  await page.getByRole('button', { name: 'Registrar uso', exact: true }).click();
  await expect(page).toHaveURL(/\/estoque\?aba=materiais$/);
  await page.screenshot({
    path: 'test-results/screenshots/stock-materials-mobile.png',
    fullPage: true,
  });
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await logout(page);
  await login(page, f.manager);
  await page.goto('/estoque/autorizacoes');
  const authorization = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: materialName, exact: true }) });
  await expect(authorization.getByRole('img')).toBeVisible();
  await authorization.getByRole('button', { name: 'Registrar conferência' }).click();
  await expect(authorization).toContainText('Estado: CONFERIDA');
  await page.screenshot({
    path: 'test-results/screenshots/stock-review-mobile.png',
    fullPage: true,
  });
  await page.goto('/gestor/estoque');
  await expect(page.getByRole('heading', { name: 'Relatórios de estoque' })).toBeVisible();
  const pdf = await page.request.get(
    (await page.getByRole('link', { name: 'Baixar PDF' }).getAttribute('href'))!,
  );
  expect(pdf.status()).toBe(200);
  await writeFile('test-results/screenshots/stock-report.pdf', await pdf.body());
  await logout(page);
  await login(page, f.admin);
  await page.goto('/estoque');
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.locator('.mobile-nav a').count()).toBeLessThanOrEqual(6);
  await noOverflow(page);
  await page.screenshot({ path: 'test-results/screenshots/stock-admin-360.png', fullPage: true });
  await logout(page);
  await login(page, f.employee);
  const denied = await page.goto('/estoque');
  expect(denied?.status()).toBe(404);
  expect((await page.request.get('/api/estoque/resumo')).status()).toBe(404);
  expect(errors).toEqual([]);
});
test('upload de autorização recusa outra origem, falta de tamanho e papel errado', async ({
  page,
  request,
}) => {
  expect(
    (
      await request.post('/api/estoque/uso-avulso', {
        headers: { origin: 'https://outro.example' },
      })
    ).status(),
  ).toBe(403);
  await login(page, f.tech);
  const cookies = await page.context().cookies();
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      'http://localhost:3100/api/estoque/uso-avulso',
      {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3100',
          'content-type': 'multipart/form-data; boundary=abc',
          'transfer-encoding': 'chunked',
          cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      },
    );
    req.on('error', reject);
    req.end('--abc--\r\n');
  });
  expect(status).toBe(411);
  expect((await page.request.get(`/api/estoque/fotos/${privatePhoto}`)).status()).toBe(404);
  await logout(page);
  await login(page, f.manager);
  expect((await page.request.get('/api/estoque/resumo')).status()).toBe(200);
  expect(
    (
      await page.request.post('/api/estoque/uso-avulso', {
        headers: { origin: 'http://localhost:3100' },
      })
    ).status(),
  ).toBe(403);
});

test('contador acompanha mudanças de outra sessão ao navegar por links e filtros', async ({
  page,
  browser,
}) => {
  const { item } = await createItem(f.admin, {
    kind: 'MATERIAL',
    name: 'Contador ' + randomUUID(),
    teamId: f.ti,
    unit: 'METRO',
    initialQuantity: '3',
    minimum: '2',
    requestId: randomUUID(),
  });
  const baseline = await db.stockAlert.count({
    where: { organizationId: f.organizationId, closedAt: null },
  });
  await login(page, f.tech);
  await page.goto('/estoque');
  const other = await browser.newPage();
  await login(other, f.admin);
  await other.goto(`/estoque/itens/${item.id}`);
  const adjustment = other
    .locator('section')
    .filter({ has: other.getByRole('heading', { name: 'Ajuste', exact: true }) });
  const count = async () => {
    await adjustment.getByLabel('Quantidade contada').fill('1');
    await adjustment.getByLabel('Motivo', { exact: true }).fill('Contagem por outra sessão');
    await adjustment.getByRole('button', { name: 'Ajustar contagem' }).click();
    await expect(adjustment.getByRole('status')).toContainText('Contagem registrada');
  };
  await count();
  await page.locator('.mobile-nav a[href="/chamados"]').click();
  await expect(
    page.locator('.mobile-nav').getByLabel(`${baseline + 1} materiais acabando`, { exact: true }),
  ).toBeVisible();
  const entry = other
    .locator('section')
    .filter({ has: other.getByRole('heading', { name: 'Entrada', exact: true }) });
  await entry.getByLabel('Quantidade', { exact: true }).fill('5');
  await entry.getByRole('button', { name: 'Registrar entrada' }).click();
  await expect(entry.getByRole('status')).toContainText('Entrada registrada');
  await page.locator('.mobile-nav a[href="/estoque"]').click();
  if (baseline)
    await expect(
      page.locator('.mobile-nav').getByLabel(`${baseline} materiais acabando`, { exact: true }),
    ).toBeVisible();
  else await expect(page.locator('.mobile-nav .nav-badge')).toHaveCount(0);
  await count();
  await page
    .getByRole('navigation', { name: 'Tipos de estoque' })
    .getByRole('link', { name: /^Materiais/ })
    .click();
  await expect(
    page.locator('.mobile-nav').getByLabel(`${baseline + 1} materiais acabando`, { exact: true }),
  ).toBeVisible();
  await other.close();
});
