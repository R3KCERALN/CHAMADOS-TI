import { test, expect, type Page } from '@playwright/test';
import { syntheticCnpj } from '../fixtures';
import { mkdir } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
const temporary = '123456';
const finalPassword = '456789';
async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
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
  await expect(page.getByRole('heading', { name: /^(Olá,|Panorama do suporte)/ })).toBeVisible();
}
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
}
async function createUser(
  page: Page,
  name: string,
  username: string,
  role: string,
  team?: 'TI' | 'Elétrica',
) {
  await page.goto('/admin/usuarios/novo');
  await page.getByLabel('Nome completo').fill(name);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page
    .getByLabel('Setor', { exact: true })
    .selectOption({ label: role === 'TI' ? 'TI' : 'Financeiro' });
  await page.getByLabel('Perfil de acesso').selectOption(role);
  if (role === 'TI') {
    await expect(page.getByLabel('Perfil de acesso')).toContainText('Técnico');
    await page.getByLabel('Equipe', { exact: true }).selectOption({ label: team! });
  } else await expect(page.getByLabel('Equipe', { exact: true })).toHaveCount(0);
  if (role === 'FUNCIONARIO')
    await page
      .getByLabel('Filial (opcional)', { exact: true })
      .selectOption({ label: 'E2E Castanhal' });
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
  await expect(page.locator('.login-story')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Central de Suporte', exact: true }),
  ).toBeVisible();
  await firstLogin(page, process.env.INITIAL_ADMIN_USERNAME!, process.env.INITIAL_ADMIN_PASSWORD!);
  await page.goto('/admin/filiais');
  await expect(page.getByText(/Organização atual:/)).toBeVisible();
  const companyForm = page.locator('form').filter({ has: page.locator('#display-new') });
  await companyForm.getByLabel('Nome de exibição').fill('Filial inválida preservada');
  await companyForm.getByLabel('CNPJ', { exact: true }).fill('11111111111111');
  await companyForm.getByRole('button', { name: 'Criar filial', exact: true }).click();
  await expect(companyForm.locator('#cnpj-new-error')).toContainText('CNPJ válido');
  await expect(companyForm.getByLabel('Nome de exibição')).toHaveValue(
    'Filial inválida preservada',
  );
  for (const name of ['E2E Castanhal', 'E2E Belém']) {
    await companyForm.getByLabel('Nome de exibição').fill(name);
    await companyForm.getByLabel('CNPJ', { exact: true }).fill(syntheticCnpj());
    await companyForm.getByRole('button', { name: 'Criar filial', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await accessible(page);
  await page.goto('/admin/unidades');
  await page.getByLabel('Filial', { exact: true }).selectOption({ label: 'E2E Belém' });
  await page.getByLabel('Nome da unidade', { exact: true }).fill('Depósito E2E');
  await page.getByRole('button', { name: 'Criar unidade', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Depósito E2E', exact: true })).toBeVisible();
  await accessible(page);
  await page.goto('/admin/categorias');
  await page.getByLabel('Equipe', { exact: true }).selectOption({ label: 'TI' });
  await page.getByLabel('Nome da categoria', { exact: true }).fill('E2E Rede');
  await page.getByRole('button', { name: 'Criar categoria', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Categoria salva');
  const categoryForm = page
    .locator('form')
    .filter({ has: page.locator('input[value="E2E Rede"]') });
  const categoryId = await categoryForm.locator('input[name="id"]').inputValue();
  await page.locator('#category-' + categoryId).fill('E2E Rede / Internet');
  await categoryForm.getByRole('button', { name: 'Salvar categoria' }).click();
  await expect(page.locator('#category-' + categoryId)).toHaveValue('E2E Rede / Internet');
  await page.goto('/gestor');
  await expect(page.getByRole('heading', { name: 'Panorama do suporte' })).toBeVisible();
  await createUser(page, 'Ana Financeiro', 'ana.financeiro', 'FUNCIONARIO');
  await createUser(page, 'Bruno Técnico', 'bruno.ti', 'TI', 'TI');
  await createUser(page, 'Carla Técnica', 'carla.ti', 'TI', 'TI');
  await page.goto('/admin/usuarios/novo');
  await page.getByLabel('Perfil de acesso').selectOption('TI');
  await accessible(page);
  await createUser(page, 'Eduardo Eletricista', 'eduardo.eletrica', 'TI', 'Elétrica');
  await createUser(page, 'Gustavo Gestor', 'gustavo.gestor', 'GESTOR');
  await page.screenshot({ path: 'test-results/screenshots/admin-desktop.png', fullPage: true });
  await accessible(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/usuarios');
  expect(await page.locator('.mobile-nav a').count()).toBeLessThanOrEqual(5);
  await expect(page.locator('.mobile-nav a[aria-current="page"]')).toHaveText('Admin');
  const mobileNavigation = page.locator('.mobile-nav');
  expect(
    await mobileNavigation.evaluate(
      (navigation) => navigation.scrollWidth <= navigation.clientWidth,
    ),
  ).toBe(true);
  await logout(page);
  await firstLogin(page, 'ana.financeiro', temporary);
  await noOverflow(page);
  await accessible(page);
  await page.screenshot({ path: 'test-results/screenshots/employee-mobile.png', fullPage: true });
  await page.goto('/admin/usuarios');
  await expect(page.getByRole('heading', { name: 'Não encontramos este registro.' })).toBeVisible();
  expect((await page.request.get('/api/pessoas')).status()).toBe(403);
  await page.goto('/chamados/novo');
  await expect(page.getByLabel('Onde está o problema?')).toHaveCount(0);
  const teamGroup = page.getByRole('group', { name: 'Para qual equipe é o chamado?' });
  await expect(teamGroup.getByRole('radio')).toHaveCount(2);
  await expect(teamGroup.getByRole('radio', { name: /^TI/ })).not.toBeChecked();
  await expect(teamGroup.getByRole('radio', { name: /^Elétrica/ })).not.toBeChecked();
  await expect(page.getByText('A equipe escolhida receberá seu chamado.')).toBeVisible();
  await accessible(page);
  await page
    .getByLabel('O que aconteceu?')
    .fill('Não consigo abrir o sistema financeiro para concluir os pagamentos.');
  await expect(page.getByLabel('Categoria técnica')).toHaveCount(0);
  await page.getByLabel('Estou bloqueado').check();
  // A escolha da equipe é obrigatória: sem ela o chamado não é enviado.
  await page.getByRole('button', { name: 'Enviar chamado' }).click();
  await expect(page).toHaveURL(/\/chamados\/novo/);
  await teamGroup.getByRole('radio', { name: /^TI/ }).check();
  await page.getByRole('button', { name: 'Enviar chamado' }).click();
  await expect(page.getByRole('status')).toContainText('Chamado registrado');
  const ticketUrl = page.url().split('?')[0];
  await expect(page.getByText('Novo', { exact: true })).toBeVisible();
  await page.goto('/chamados/novo');
  await page
    .getByLabel('O que aconteceu?')
    .fill('Tomada da bancada do financeiro está soltando faíscas.');
  await page.getByLabel('Estou bloqueado').check();
  await page
    .getByRole('group', { name: 'Para qual equipe é o chamado?' })
    .getByRole('radio', { name: /^Elétrica/ })
    .check();
  await page.getByRole('button', { name: 'Enviar chamado' }).click();
  await expect(page.getByRole('status')).toContainText('Chamado registrado');
  const electricUrl = page.url().split('?')[0];
  await expect(page.getByText('Elétrica', { exact: true }).first()).toBeVisible();
  await logout(page);
  await firstLogin(page, 'bruno.ti', temporary);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByText('Atendimento próximo. Trabalho em movimento.')).toHaveCount(0);
  await expect(page.getByText('VERSÃO 1.2')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/screenshots/ti-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/chamados?filtro=novos');
  await expect(page.getByRole('searchbox', { name: 'Buscar chamado' })).toBeVisible();
  await expect(page.getByText('Mais filtros', { exact: true })).toBeVisible();
  expect(await page.locator('.mobile-nav a').count()).toBeLessThanOrEqual(5);
  await expect(page.locator('.mobile-nav a[aria-current="page"]')).toHaveText('Chamados');
  await expect(
    page.getByRole('link').filter({ hasText: 'Não consigo abrir o sistema financeiro' }),
  ).toBeVisible();
  await expect(page.getByText('Tomada da bancada do financeiro')).toHaveCount(0);
  await page
    .getByRole('link')
    .filter({ hasText: 'Não consigo abrir o sistema financeiro' })
    .click();
  const description = page.locator('.description');
  const primaryAction = page.locator('.primary-actions');
  const ticketContext = page.locator('.ticket-context');
  await expect(description).toBeVisible();
  await expect(primaryAction).toBeVisible();
  await expect(ticketContext).toBeAttached();
  const [descriptionBox, actionBox, contextBox] = await Promise.all([
    description.boundingBox(),
    primaryAction.boundingBox(),
    ticketContext.boundingBox(),
  ]);
  expect(descriptionBox!.y).toBeLessThan(actionBox!.y);
  expect(actionBox!.y).toBeLessThan(contextBox!.y);
  await page
    .getByLabel('Categoria técnica', { exact: true })
    .selectOption({ label: 'E2E Rede / Internet' });
  await page.getByLabel('Complexidade operacional').selectOption('ALTA');
  await page.getByRole('button', { name: 'Salvar classificação' }).click();
  await expect(page.locator('.timeline')).toContainText('Categoria técnica alterada');
  await page.getByRole('button', { name: 'Assumir chamado' }).click();
  await expect(page.getByText('Em atendimento', { exact: true })).toBeVisible();
  await page
    .getByLabel('Adicionar apoio', { exact: true })
    .selectOption({ label: 'Carla Técnica · TI' });
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
  await page.getByRole('radio', { name: /Ana Financeiro/ }).click();
  await expect(page.locator('.picker-results')).toHaveCount(0);
  await expect(page.locator('.selected-person')).toContainText('Ana Financeiro');
  await expect(page.getByRole('button', { name: 'Trocar', exact: true })).toBeVisible();
  await page
    .getByLabel('O que está sendo atendido?')
    .fill('Orientação presencial sobre acesso à pasta compartilhada.');
  const quickSubmit = page.getByRole('button', { name: 'Iniciar atendimento' });
  await expect(quickSubmit).toBeVisible();
  expect((await quickSubmit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await noOverflow(page);
  await page.screenshot({ path: 'test-results/screenshots/quick-mobile.png', fullPage: true });
  await accessible(page);
  await page.getByRole('button', { name: 'Iniciar atendimento' }).click();
  await expect(page.getByText('Em atendimento', { exact: true })).toBeVisible();
  await expect(page.locator('.assignee-name')).toHaveText('Bruno Técnico');
  await expect(page.locator('.ticket-facts')).toContainText('Ana Financeiro');
  await expect(page.locator('.page-heading .eyebrow')).toContainText('ATENDIMENTO RÁPIDO');
  await logout(page);
  await login(page, 'bruno.ti', finalPassword);
  await page.goto('/atendimento-rapido');
  await page.getByRole('button', { name: 'Informar nome', exact: true }).click();
  await page.getByLabel('Nome de quem pediu').fill('João - Reposição');
  await page.getByLabel('Filial', { exact: true }).selectOption({ label: 'E2E Belém' });
  await page
    .getByLabel('Unidade (opcional)', { exact: true })
    .selectOption({ label: 'Depósito E2E' });
  await page.getByLabel('O que está sendo atendido?').fill('Coletor não conecta no Wi-Fi.');
  await accessible(page);
  await noOverflow(page);
  await page.screenshot({
    path: 'test-results/screenshots/quick-manual-mobile.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Iniciar atendimento', exact: true }).click();
  await expect(page.locator('.ticket-facts')).toContainText('João - Reposição');
  await expect(page.locator('.ticket-facts')).toContainText('E2E Belém');
  await expect(page.locator('.ticket-facts')).toContainText('Registrado por');
  await expect(page.locator('.timeline')).toContainText(
    'Atendimento rápido registrado por Bruno Técnico',
  );
  expect(await (await page.request.get('/api/pessoas?q=João')).json()).toEqual([]);
  await page.goto('/chamados?q=João%20-%20Reposição');
  await expect(page.locator('.ticket-row')).toContainText('João - Reposição');
  await logout(page);
  await firstLogin(page, 'eduardo.eletrica', temporary);
  await page.goto('/chamados?filtro=novos');
  await expect(page.getByText('Tomada da bancada do financeiro')).toBeVisible();
  await expect(page.getByText('Não consigo abrir o sistema financeiro')).toHaveCount(0);
  await expect(page.getByText('Coletor não conecta no Wi-Fi.')).toHaveCount(0);
  await page.goto(ticketUrl);
  await expect(page.getByRole('heading', { name: 'Não encontramos este registro.' })).toBeVisible();
  await page.goto(electricUrl);
  await expect(page.getByText('Elétrica', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Assumir chamado' }).click();
  await expect(page.getByText('Em atendimento', { exact: true })).toBeVisible();
  await page
    .getByLabel('Adicionar apoio', { exact: true })
    .selectOption({ label: 'Bruno Técnico · TI' });
  await page.getByRole('button', { name: 'Adicionar apoio', exact: true }).click();
  await expect(page.locator('.support-person')).toContainText('Bruno Técnico');
  await logout(page);
  await login(page, 'bruno.ti', finalPassword);
  await page.goto(electricUrl);
  await expect(page.getByText('Tomada da bancada do financeiro')).toBeVisible();
  await expect(page.locator('.assignee-name')).toHaveText('Eduardo Eletricista');
  await expect(page.getByRole('button', { name: 'Assumir chamado' })).toHaveCount(0);
  await page.goto('/chamados?filtro=apoio');
  await expect(page.getByText('Tomada da bancada do financeiro')).toBeVisible();
  await page.goto('/chamados');
  await expect(page.getByText('Tomada da bancada do financeiro')).toHaveCount(0);
  await logout(page);
  await firstLogin(page, 'gustavo.gestor', temporary);
  await expect(page.getByRole('heading', { name: 'Panorama do suporte' })).toBeVisible();
  await page.goto('/admin/usuarios');
  await expect(page.getByRole('heading', { name: 'Não encontramos este registro.' })).toBeVisible();
  await page.goto('/gestor');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Período', { exact: true }).selectOption('7dias');
  await page.getByLabel('Setor solicitante', { exact: true }).selectOption({ label: 'Financeiro' });
  await page.getByLabel('Técnico', { exact: true }).selectOption({ label: 'Bruno Técnico' });
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(page).toHaveURL(/periodo=7dias/);
  await expect(page.getByRole('navigation', { name: 'Seções do panorama' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Resumo', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Demanda', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Backlog', exact: true })).toBeVisible();
  await expect(page.locator('.active-filter-summary')).toContainText('Financeiro');
  await expect(page.locator('.active-filter-summary')).toContainText('Bruno Técnico');
  await expect(page.getByRole('heading', { name: 'Demanda por categoria' })).toBeVisible();
  await expect(page.getByText(/chamado\(s\) com histórico incompleto/)).toHaveCount(0);
  await accessible(page);
  await noOverflow(page);
  await page.screenshot({
    path: 'test-results/screenshots/management-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await expect(page.getByRole('navigation', { name: 'Seções do panorama' })).toBeVisible();
  await page.setViewportSize({ width: 667, height: 375 });
  await noOverflow(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const csvLink = await page.getByRole('link', { name: 'Exportar CSV' }).getAttribute('href');
  const csv = await page.request.get(csvLink!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('E2E Rede / Internet');
  const pdfLink = await page.getByRole('link', { name: 'Baixar PDF' }).getAttribute('href');
  const pdf = await page.request.get(pdfLink!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await page.getByRole('link', { name: 'Equipe técnica', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Equipe técnica', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Bruno Técnico', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bruno Técnico', exact: true })).toBeVisible();
  await expect(page.getByText('Participou como apoio', { exact: true })).toBeVisible();
  await accessible(page);
  await page.screenshot({
    path: 'test-results/screenshots/technician-desktop.png',
    fullPage: true,
  });
  const detailUrl = page.url();
  await page.goto('/gestor/filiais');
  await page.getByRole('link', { name: 'E2E Belém', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Belém', exact: true })).toBeVisible();
  await page
    .getByLabel('Unidade', { exact: true })
    .selectOption({ label: 'Depósito E2E — E2E Belém' });
  await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).click();
  await accessible(page);
  await page.getByRole('link', { name: 'Consultar chamados', exact: true }).click();
  await expect(page.locator('table')).toContainText('João - Reposição');
  const locationCsv = await page
    .getByRole('link', { name: 'Exportar período CSV', exact: true })
    .getAttribute('href');
  const exportResult = await page.request.get(locationCsv!);
  expect(exportResult.status()).toBe(200);
  const contents = await exportResult.text();
  expect(contents).toContain('E2E Belém');
  expect(contents).toContain('João - Reposição');
  expect(contents).toContain('Bruno Técnico');
  expect(contents).toContain('Registrado por');
  await page.screenshot({
    path: 'test-results/screenshots/location-report-desktop.png',
    fullPage: true,
  });

  await logout(page);
  await login(page, 'bruno.ti', finalPassword);
  for (const path of [
    '/gestor',
    '/gestor/equipe',
    '/gestor/filiais',
    '/gestor/chamados',
    '/admin/filiais',
    '/admin/unidades',
    detailUrl,
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: 'Não encontramos este registro.' }),
    ).toBeVisible();
  }
  expect((await page.request.get('/gestor/exportar')).status()).toBe(403);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await noOverflow(page);
  await expect(page.getByText('Meus aguardando', { exact: true })).toBeVisible();
  const queueBox = await page.locator('.list-panel').boundingBox();
  const secondaryStatsBox = await page.locator('.secondary-operational-stats').boundingBox();
  expect(queueBox!.y).toBeLessThan(secondaryStatsBox!.y);
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto('/atendimento-rapido');
  await noOverflow(page);
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
