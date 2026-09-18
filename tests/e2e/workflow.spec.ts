import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
const temporary = process.env.TEST_PASSWORD!;
const finalPassword = `${temporary}.nova`;
async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na Central' }).click();
  // Server Actions navigate asynchronously; wait for the authenticated destination before goto.
  await expect(page).not.toHaveURL(/\/login(?:\?.*)?$/);
}
async function firstLogin(page: Page, username: string, password: string) {
  await login(page, username, password);
  await expect(page.getByRole('heading', { name: 'Crie sua própria senha' })).toBeVisible();
  await page.getByLabel('Senha atual', { exact: true }).fill(password);
  await page.getByLabel('Nova senha', { exact: true }).fill(finalPassword);
  await page.getByLabel('Confirme a nova senha').fill(finalPassword);
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.getByRole('status')).toContainText('Senha alterada');
  await login(page, username, finalPassword);
  await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible();
}
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
}
async function createUser(page: Page, name: string, username: string, role: string) {
  await page.goto('/admin/usuarios/novo');
  await page.getByLabel('Nome completo').fill(name);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page
    .getByLabel('Setor', { exact: true })
    .selectOption({ label: role === 'TI' ? 'TI' : 'Financeiro' });
  await page.getByLabel('Perfil de acesso').selectOption(role);
  await page.getByLabel('Senha temporária', { exact: true }).fill(temporary);
  await page.getByRole('button', { name: 'Criar usuário', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Usuário criado');
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect.soft(result.violations).toEqual([]);
}
test('cenário completo no navegador: admin, funcionário, TI, histórico e atendimento rápido', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await mkdir('test-results/screenshots', { recursive: true });
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.screenshot({ path: 'test-results/screenshots/login-desktop.png', fullPage: true });
  await accessible(page);
  await firstLogin(page, process.env.INITIAL_ADMIN_USERNAME!, process.env.INITIAL_ADMIN_PASSWORD!);
  await createUser(page, 'Ana Financeiro', 'ana.financeiro', 'FUNCIONARIO');
  await createUser(page, 'Bruno Técnico', 'bruno.ti', 'TI');
  await createUser(page, 'Carla Técnica', 'carla.ti', 'TI');
  await createUser(page, 'Gustavo Gestor', 'gustavo.gestor', 'GESTOR');
  await page.screenshot({ path: 'test-results/screenshots/admin-desktop.png', fullPage: true });
  await accessible(page);
  await logout(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await firstLogin(page, 'ana.financeiro', temporary);
  await noOverflow(page);
  await accessible(page);
  await page.screenshot({ path: 'test-results/screenshots/employee-mobile.png', fullPage: true });
  await page.goto('/admin/usuarios');
  await expect(page.getByRole('heading', { name: 'Não encontramos este registro.' })).toBeVisible();
  await page.goto('/chamados/novo');
  await page
    .getByLabel('O que aconteceu?')
    .fill('Não consigo abrir o sistema financeiro para concluir os pagamentos.');
  await page.getByLabel('Estou bloqueado').check();
  await page.getByRole('button', { name: 'Enviar chamado' }).click();
  await expect(page.getByRole('status')).toContainText('Chamado registrado');
  const ticketUrl = page.url().split('?')[0];
  await expect(page.getByText('Novo', { exact: true })).toBeVisible();
  await logout(page);
  await firstLogin(page, 'bruno.ti', temporary);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/screenshots/ti-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/chamados?filtro=novos');
  await page
    .getByRole('link')
    .filter({ hasText: 'Não consigo abrir o sistema financeiro' })
    .click();
  await page.getByRole('button', { name: 'Assumir chamado' }).click();
  await expect(page.getByText('Em atendimento', { exact: true })).toBeVisible();
  await page
    .getByLabel('Adicionar apoio', { exact: true })
    .selectOption({ label: 'Carla Técnica' });
  await page.getByRole('button', { name: 'Adicionar apoio', exact: true }).click();
  await expect(page.locator('.support-person')).toContainText('Carla Técnica');
  await page
    .getByLabel('Adicionar comentário')
    .fill('Identificamos uma falha na fonte e estamos providenciando a substituição.');
  await page.getByRole('button', { name: 'Enviar comentário' }).click();
  await expect(page.locator('.comment')).toContainText('Identificamos uma falha');
  await page.getByText('Colocar em aguardando', { exact: true }).click();
  await page.getByLabel('Motivo da espera').selectOption('PECA');
  await page.getByLabel('Detalhes da espera').fill('Aguardando peça do estoque.');
  await page.getByRole('button', { name: 'Confirmar espera' }).click();
  await expect(page.getByText('Aguardando', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retomar atendimento' }).click();
  await expect(page.getByText('Em atendimento', { exact: true })).toBeVisible();
  await page.getByText('Resolver chamado', { exact: true }).click();
  await page
    .getByLabel('Como foi resolvido? (opcional)')
    .fill('Fonte substituída e sistema validado com a solicitante.');
  await page.getByRole('button', { name: 'Confirmar resolução' }).click();
  await expect(page.getByText('Resolvido', { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: 'test-results/screenshots/resolved-mobile.png', fullPage: true });
  await accessible(page);
  await logout(page);
  await login(page, 'ana.financeiro', finalPassword);
  await page.goto(ticketUrl);
  await expect(page.getByText('Resolvido', { exact: true })).toBeVisible();
  await expect(page.locator('.timeline')).toContainText('Atendimento iniciado');
  await expect(page.locator('.timeline')).toContainText('Técnico de apoio adicionado');
  await expect(page.locator('.timeline')).toContainText('Colocado em espera');
  await expect(page.locator('.timeline')).toContainText('Atendimento retomado');
  await expect(page.locator('.timeline')).toContainText('Chamado resolvido');
  await expect(page.locator('.comment')).toContainText('Identificamos uma falha');
  await expect(page.getByRole('button', { name: 'Assumir chamado' })).toHaveCount(0);
  await logout(page);
  await login(page, 'bruno.ti', finalPassword);
  await page.goto('/atendimento-rapido');
  await page.getByLabel('Busque pelo nome ou setor e selecione a pessoa').fill('Ana');
  await page.getByRole('radio', { name: /Ana Financeiro/ }).check();
  await page
    .getByLabel('O que está sendo atendido?')
    .fill('Orientação presencial sobre acesso à pasta compartilhada.');
  await noOverflow(page);
  await page.screenshot({ path: 'test-results/screenshots/quick-mobile.png', fullPage: true });
  await accessible(page);
  await page.getByRole('button', { name: 'Iniciar atendimento' }).click();
  await expect(page.getByText('Em atendimento', { exact: true })).toBeVisible();
  await expect(page.locator('.assignee-name')).toHaveText('Bruno Técnico');
  await expect(page.locator('.ticket-facts')).toContainText('Ana Financeiro');
  await expect(page.locator('.page-heading .eyebrow')).toContainText('ATENDIMENTO RÁPIDO');
  await logout(page);
  await firstLogin(page, 'gustavo.gestor', temporary);
  await expect(
    page.getByRole('heading', { name: 'Indicadores começam com bons registros.' }),
  ).toBeVisible();
  await page.goto('/admin/usuarios');
  await expect(page.getByRole('heading', { name: 'Não encontramos este registro.' })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
test('manifest, ícones e proteção contra POST de outra origem', async ({ request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  const data = await manifest.json();
  expect(data.display).toBe('standalone');
  expect(data.name).toBe('Central de Suporte');
  for (const icon of data.icons) expect((await request.get(icon.src)).status()).toBe(200);
  const response = await request.post('/login', {
    headers: { origin: 'https://outro-site.example', 'next-action': 'invalid-action-id' },
    data: '[]',
  });
  expect(response.status()).toBeGreaterThanOrEqual(400);
  const page = await request.get('/login');
  expect(page.headers()['x-frame-options']).toBe('DENY');
  expect(page.headers()['x-content-type-options']).toBe('nosniff');
});
