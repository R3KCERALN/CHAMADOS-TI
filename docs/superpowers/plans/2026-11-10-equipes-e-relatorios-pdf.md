# Equipes (TI/Elétrica) e relatórios PDF — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** levar a equipe de eletricistas para a Central de Suporte, com fila, apoio entre equipes, mudança de equipe, avisos por equipe e indicadores filtráveis por equipe. Toda tela gerencial ganha PDF.

**Arquitetura:**

- A equipe é uma tabela `Team` por organização, com chave fixa `TI` ou `ELETRICA`, criada pela migration e por trigger em toda Organization nova.
- O técnico (`Role.TI`, exibido como "Técnico") tem `teamId` obrigatório. Chamado e categoria também têm `teamId` obrigatório; o legado é preenchido com TI.
- O escopo por equipe é aplicado nos serviços (`src/lib/services.ts`) e na revalidação do push. A organização continua protegida por triggers.
- O PDF é gerado em memória com `pdfkit` numa rota GET de leitura, reaproveitando as consultas gerenciais existentes.

**Stack:** Next.js 16 App Router (webpack), TypeScript strict, Prisma 7 + adapter-pg, PostgreSQL 17, node:test via `tsx`, Playwright, `pdfkit` (nova dependência).

**Spec:** `docs/superpowers/specs/2026-11-10-equipes-e-relatorios-pdf-design.md`. Leia também `AGENTS.md`, `docs/organization-model.md` e `docs/metrics.md`.

## Restrições globais

- PT-BR em toda a interface. Os rótulos de equipe são exatamente **"TI"** e **"Elétrica"**. O papel `TI` aparece como **"Técnico"**.
- Na abertura comum, a escolha de equipe é obrigatória e **sem valor pré-marcado**.
- O responsável principal é **ADMIN ou técnico da equipe do chamado**. Técnico de outra equipe entra só como apoio. _(Interpretação deste plano: o ADMIN não tem equipe e continua podendo assumir chamados das duas.)_
- Técnico vê um chamado se ele é da sua equipe **ou** se ele está em `TicketParticipant`. ADMIN vê tudo. GESTOR continua sem detalhe operacional.
- Organização vem do ator, nunca do cliente. Escopo inclusive em opções, busca, contadores, SQL, CSV e PDF.
- Mutações só por Server Action com `sameOrigin()`, nunca por GET. A rota de PDF é GET somente leitura.
- As migrations são incrementais: `202611100001_teams` e `202611100002_ticket_teams`. Nunca editar migrations já aplicadas.
- Ticket, evento e outbox na mesma transação (`recordTicketEvent`). Assumir com UPDATE condicional; demais mutações com `lockedTicket` (FOR UPDATE).
- Payload de push sem descrição, comentários ou nomes pessoais.
- A revisão de atualização automática continua por organização para TI/ADMIN. Recarregar a mais é aceitável (spec); nada muda em `live-updates`.
- Filtro gerencial de equipe: parâmetro `team` (id da equipe), usando a **equipe atual do chamado**.
- PDF de Chamados: **até 2.000 linhas**. Acima disso, avisar o corte e indicar o CSV.
- Indicador indisponível sai como **"—"**, nunca zero.
- Testes só em bancos `central_test_*`, via `npm test`. Validação final: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` e `npm audit`.

## Foco de revisão

1. **URL direta para chamado de outra equipe.** Um eletricista que abre `/chamados/<id-da-TI>` ou `/notificacoes/<id>` deve receber 404, e comentar, classificar ou relocalizar deve falhar. Teste na Tarefa 3.
2. **Apoio removido perde o acesso na hora.** Depois de `setSupport(..., false)`, o ajudante da outra equipe recebe 404 e deixa de ver o chamado em "meus" e "apoio". Teste na Tarefa 3.
3. **Corrida entre mover e assumir.** Depois que o chamado é movido para Elétrica, um técnico da TI não consegue assumi-lo, e o eletricista consegue. Duas mudanças simultâneas geram um único evento. Teste na Tarefa 4.
4. **Formulário forjado.** `teamId` de outra organização, categoria de outra equipe ou ADMIN sem equipe no atendimento rápido devem gerar erro de validação claro, sem 500 e sem gravar nada. Teste na Tarefa 2.
5. **Busca por número de outra equipe.** `q=CS-0042`, com o chamado 42 sendo de outra equipe, não deve aparecer na fila do técnico. Teste na Tarefa 3.

---

### Tarefa 1: Equipes e técnicos com equipe

**Arquivos:**

- Criar: `prisma/migrations/202611100001_teams/migration.sql`, `src/lib/teams.ts`
- Modificar: `prisma/schema.prisma`, `src/lib/validation.ts`, `src/lib/services.ts` (`createUser`, `updateUser`, `adminUsers`), `src/lib/labels.ts`, `src/components/user-fields.tsx`, `src/app/actions.ts` (`createUserAction`, `updateUserAction`), `src/app/(private)/admin/usuarios/{novo,[id]}/page.tsx`, `src/app/(private)/admin/usuarios/page.tsx`, `prisma/seed-demo.ts`, `scripts/test-runner.mjs`, `tests/fixtures.ts`
- Testes: `tests/migration.test.ts`, `tests/critical.test.ts`, mais os helpers `makeUser`/`person` em `tests/{critical,management,notifications,organization}.test.ts` e `tests/e2e/*.spec.ts`

**Interfaces:**

- Produz:
  - `src/lib/teams.ts`:
    - `export const TEAM_KEYS = ['TI', 'ELETRICA'] as const`
    - `export type TeamKey = (typeof TEAM_KEYS)[number]`
    - `export const teamLabels: Record<TeamKey, string> = { TI: 'TI', ELETRICA: 'Elétrica' }`
    - `export async function teamOptions(client: Tx | typeof db, organizationId: string): Promise<{ id: string; key: TeamKey; name: string }[]>`: equipes ativas na ordem de `TEAM_KEYS`.
    - `export async function requireTeam(client: Tx, organizationId: string, teamId: string | null | undefined): Promise<{ id: string; key: TeamKey }>`: lança `AppError('Selecione a equipe.')` se a equipe não for ativa da organização.
  - Prisma:
    - `model Team { id, organizationId, key String, name, active Boolean @default(true), createdAt }` com `@@unique([organizationId, key])`.
    - `User.teamId String?`.
  - `userSchema` ganha `teamId: z.string().max(100).nullable().optional()`.
  - Fixture `tests/fixtures.ts`: `export async function teamId(organizationId: string, key: 'TI' | 'ELETRICA'): Promise<string>`.

- [ ] **Passo 1: o test runner aceita arquivos.** Em `scripts/test-runner.mjs`, se `process.argv` tiver argumentos terminando em `.test.ts`, rodar só esses; senão, todos. Depois disso, `npm test -- tests/migration.test.ts` roda um arquivo só.

- [ ] **Passo 2: escrever o teste de migration que falha.** Em `tests/migration.test.ts`, criar o teste `migration de equipes cria TI/Elétrica por organização e coloca técnicos legados na TI`. Seguir o padrão do teste existente: schema temporário, aplicar migrations até antes de `202611100001_teams`, inserir duas organizations, um técnico legado (`role 'TI'`) e um funcionário, e aplicar o resto. Asserções:

```ts
const teams = await client.query(
  'SELECT "organizationId", key, name FROM "Team" ORDER BY "organizationId", key',
);
assert.deepEqual(teams.rows.map((r) => [r.key, r.name]).slice(0, 2), [
  ['ELETRICA', 'Elétrica'],
  ['TI', 'TI'],
]);
assert.equal(teams.rowCount, 4); // 2 por organização
const tech = (
  await client.query('SELECT t.key FROM "User" u JOIN "Team" t ON t.id=u."teamId" WHERE u.id=$1', [
    'legacy-tech',
  ])
).rows[0];
assert.equal(tech.key, 'TI');
assert.equal(
  (await client.query('SELECT "teamId" FROM "User" WHERE id=$1', ['legacy-user'])).rows[0].teamId,
  null,
);
await client.query(
  `INSERT INTO "Organization"(id,name,"updatedAt") VALUES ('org-nova','Nova',CURRENT_TIMESTAMP)`,
); // ajuste as colunas ao schema atual
assert.equal(
  (await client.query(`SELECT count(*) FROM "Team" WHERE "organizationId"='org-nova'`)).rows[0]
    .count,
  '2',
);
await assert.rejects(
  client.query(`UPDATE "User" SET "teamId"=NULL WHERE id='legacy-tech'`),
  /User_technician_team/,
);
```

Também incluir uma asserção de que `UPDATE "User" SET "teamId"=<equipe da outra organização>` é rejeitado com `Organizational reference mismatch`.

- [ ] **Passo 3: rodar e ver falhar.** `npm test -- tests/migration.test.ts`. Esperado: FAIL, porque a relação `"Team"` não existe.

- [ ] **Passo 4: escrever a migration `202611100001_teams`.**
  - `CREATE TABLE "Team"`:
    - colunas `id` TEXT PK, `organizationId` TEXT NOT NULL com FK `Organization` (ON DELETE RESTRICT), `key` TEXT NOT NULL `CHECK (key IN ('TI','ELETRICA'))`, `name` TEXT NOT NULL, `active` BOOLEAN NOT NULL DEFAULT true, `createdAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    - `UNIQUE ("organizationId", key)`.
  - Inserir as duas equipes para cada Organization existente, com `id = 'team_' || md5(o.id || ':' || key)` e nomes `'TI'` e `'Elétrica'`.
  - Criar a função `create_organization_teams()` e o trigger `AFTER INSERT ON "Organization"`, que inserem as duas equipes com o mesmo esquema de id. O mesmo vale para o seed e para organizations de testes.
  - `ALTER TABLE "User" ADD COLUMN "teamId" TEXT` com FK para `Team`, mais o índice `User_teamId_idx`.
  - Backfill: `UPDATE "User" SET "teamId"=<TI da organização> WHERE role='TI'`.
  - `ADD CONSTRAINT "User_technician_team" CHECK ((role='TI') = ("teamId" IS NOT NULL))`.
  - `CREATE OR REPLACE FUNCTION enforce_organization_boundary()`:
    - copiar o corpo vigente de `202609190001_organization_locations`;
    - incluir `'Team'` na lista de tabelas com `organizationId` imutável;
    - no ramo `User`, adicionar `PERFORM assert_org_reference(org,'Team',NEW."teamId")`.
  - `CREATE TRIGGER "Team_organization_boundary"`.
  - Atualizar `prisma/schema.prisma` para refletir a migration e rodar `npm run db:generate`.

- [ ] **Passo 5: atualizar os helpers de teste e os seeds.**
  - Adicionar a fixture `teamId()` em `tests/fixtures.ts`.
  - Todo helper que cria usuário com `role: 'TI'` passa a usar `teamId: await teamId(orgId, 'TI')`. Os demais papéis ficam com `teamId` ausente.
  - Em `prisma/seed-demo.ts`, os técnicos demo vão para a TI e um técnico novo, "demo.eletricista", vai para a Elétrica.
  - O E2E `createUser` passa a escolher a equipe (Passo 8).

- [ ] **Passo 6: rodar até passar.** `npm test -- tests/migration.test.ts`. Esperado: PASS.

- [ ] **Passo 7: escrever os testes de serviço que falham.** Em `tests/critical.test.ts`:
  - `técnico exige equipe ativa da própria organização; outros papéis não têm equipe`:
    - `createUser(admin, { ...base, role: 'TI' })` sem `teamId` rejeita com `/Selecione a equipe/`;
    - com `teamId` de outra organização, rejeita;
    - com a equipe Elétrica, grava `teamId`;
    - `role: 'FUNCIONARIO'` com `teamId` informado grava `teamId === null`.
  - `troca de equipe é bloqueada enquanto o técnico for responsável por chamados não resolvidos`:
    - o técnico assume um chamado e `updateUser(..., { teamId: eletrica })` rejeita com `/Transfira os 1 chamado/`;
    - depois de resolver, a troca funciona;
    - a `UserAudit` registra `before.teamId` e `after.teamId`.
  - `rebaixar técnico para funcionário limpa a equipe`: depois de `updateUser` com `role 'FUNCIONARIO'`, `teamId` fica `null`.

- [ ] **Passo 8: implementar.**
  - `createUser` e `updateUser`:
    - com `role === 'TI'`, `teamId = (await requireTeam(tx, org, data.teamId)).id`; senão, `null`;
    - em `updateUser`, se o técnico já existia e a equipe muda, contar `ticket` com `assigneeId = userId` e `status <> 'RESOLVIDO'`; se for maior que 0, lançar `AppError(\`Transfira os ${n} chamado(s) em que esta pessoa é responsável antes de trocar a equipe.\`)`;
    - incluir `teamId` no `before` da auditoria.
  - `adminUsers` passa a selecionar `team: { select: { name: true } }`.
  - `roleLabels.TI` vira `'Técnico'`.
  - `user-fields.tsx` ganha o select "Equipe" (`name="teamId"`), visível e `required` só quando o papel é Técnico. As páginas de usuário passam `teamOptions` como prop.
  - A lista de usuários mostra a equipe.
  - As actions de usuário leem `teamId` do form.

- [ ] **Passo 9: rodar a suíte inteira.** `npm test`. Esperado: PASS, sem regressão (99 testes anteriores + novos).

- [ ] **Passo 10: commit.** `git commit -m "feat: teams table and technician team assignment"`

### Tarefa 2: chamado e categoria nascem com equipe

**Arquivos:**

- Criar: `prisma/migrations/202611100002_ticket_teams/migration.sql`
- Modificar: `prisma/schema.prisma`, `src/lib/validation.ts` (`ticketSchema`), `src/lib/services.ts` (`createTicket`, `saveCategory`, `classifyTicket`), `src/components/ticket-form.tsx`, `src/app/(private)/chamados/novo/page.tsx`, `src/app/(private)/atendimento-rapido/page.tsx`, `src/app/(private)/admin/categorias/page.tsx`, `src/app/(private)/chamados/[id]/page.tsx` (select de categoria), `src/app/actions.ts` (`createTicketAction`, `categoryAction`), `prisma/seed.ts`, `prisma/seed-demo.ts`, `src/lib/labels.ts` (`eventLabels.EQUIPE_ALTERADA`)
- Testes: `tests/migration.test.ts`, `tests/management.test.ts`, `tests/critical.test.ts`, mais os `ticket.create`/`category.create` diretos em `tests/{management,organization}.test.ts`

**Interfaces:**

- Consome: `requireTeam`, `teamOptions` e a fixture `teamId` (Tarefa 1).
- Produz:
  - `Ticket.teamId String` e `Category.teamId String`, ambos NOT NULL, com relação `team Team`.
  - Valor novo `EventType.EQUIPE_ALTERADA`, usado na Tarefa 4.
  - `ticketSchema` ganha `teamId: z.string().max(100).optional()`.
  - `saveCategory` exige `teamId` na criação e mantém a equipe na edição. A equipe de uma categoria não muda.

- [ ] **Passo 1: escrever os testes que falham.**
  - Em `tests/migration.test.ts`, teste `migration de chamados põe legado e categorias na TI e exige equipe`:
    - o ticket e a categoria legados ficam com a chave `'TI'`;
    - `UPDATE "Ticket" SET "teamId"=NULL` rejeita;
    - ticket com categoria de outra equipe rejeita com `Team/category mismatch`.
  - Em `tests/critical.test.ts`, teste `abertura comum exige equipe e grava a escolhida`:
    - `createTicket(employee, { description, impact: 'BAIXO' })` rejeita com `/Selecione a equipe/`;
    - com `teamId: eletrica`, `ticket.teamId === eletrica`;
    - com `teamId` de outra organização, rejeita com `/Selecione a equipe/`.
  - Em `tests/critical.test.ts`, teste `atendimento rápido usa a equipe de quem registra; ADMIN escolhe`:
    - quando o eletricista registra, o chamado fica na Elétrica e o `teamId` enviado pelo form é ignorado;
    - ADMIN sem `teamId` rejeita com `/Selecione a equipe/`;
    - ADMIN com TI grava TI.
  - Em `tests/management.test.ts`, teste `categoria pertence a uma equipe e só classifica chamados dessa equipe`:
    - `saveCategory(admin, { name, teamId: eletrica })` grava;
    - o mesmo nome na TI também é aceito (unicidade por equipe);
    - `classifyTicket` de um chamado da TI com categoria da Elétrica rejeita com `/Selecione uma categoria ativa/`.

- [ ] **Passo 2: rodar e ver falhar.** `npm test -- tests/migration.test.ts tests/critical.test.ts tests/management.test.ts`. Esperado: FAIL, porque a coluna `teamId` não existe.

- [ ] **Passo 3: escrever a migration `202611100002_ticket_teams`.**
  - `ALTER TYPE "EventType" ADD VALUE 'EQUIPE_ALTERADA'`.
  - Adicionar `teamId` em `Ticket` e `Category`, com FK, backfill para a TI da organização e depois `SET NOT NULL`.
  - Índices `Ticket_teamId_status_idx ("teamId", status)`, `Ticket_teamId_createdAt_idx` e `Category_teamId_idx`.
  - Trocar a unicidade de categoria:
    - remover `Category_organizationId_name_key` e `Category_name_normalized_key`;
    - criar `Category_teamId_name_normalized_key ON "Category"("teamId", lower(trim(name)))`;
    - no Prisma, `@@unique([teamId, name])`.
    - Antes de remover, procurar com `grep organizationId_name` os usos de `organizationId_name` no seed e ajustar.
  - `CREATE OR REPLACE FUNCTION enforce_organization_boundary()`, partindo da versão da Tarefa 1:
    - `'Category'` passa a fazer `PERFORM assert_org_reference(org,'Team',NEW."teamId")`;
    - `'Ticket'` faz o mesmo e, se `NEW."categoryId"` não for nulo, verifica se `Category.teamId = NEW."teamId"`; senão, `RAISE EXCEPTION 'Team/category mismatch'`;
    - `'Category'` em UPDATE rejeita a mudança de `teamId` com `'Category team is immutable'`.
  - Atualizar `schema.prisma` e rodar `npm run db:generate`.
  - Ajustar os `ticket.create` e `category.create` diretos dos testes e dos seeds com `teamId`.

- [ ] **Passo 4: implementar.**
  - `createTicket`:
    - se não é rápido, `teamId = (await requireTeam(tx, org, data.teamId)).id`;
    - se é rápido e o ator é técnico, `teamId = user.teamId`;
    - se é rápido e o ator é ADMIN, `requireTeam(tx, org, data.teamId)`.
  - `classifyTicket` passa a filtrar a categoria por `teamId: ticket.teamId`.
  - `saveCategory`: `teamId` é obrigatório na criação via `requireTeam`; na edição, a equipe é ignorada.
  - `ticket-form.tsx` (abertura comum) ganha um `<fieldset>` com a legenda "Para qual equipe é o chamado?" e dois `input type="radio" name="teamId" required`, sem `defaultChecked`. Usar o mesmo padrão visual de `impact-options`, com rótulos "TI" e "Elétrica" e uma linha de ajuda curta em cada um ("Computador, sistema, internet, impressora" / "Tomada, iluminação, disjuntor, fiação").
  - O texto final muda de "O TI receberá seu chamado." para "A equipe escolhida receberá seu chamado."
  - Atendimento rápido: só o ADMIN vê o select de equipe.
  - A tela de categorias agrupa por equipe e tem o select de equipe na criação.
  - O select de categoria no detalhe lista só as categorias da equipe do chamado.

- [ ] **Passo 5: rodar a suíte inteira.** `npm test`. Esperado: PASS.

- [ ] **Passo 6: commit.** `git commit -m "feat: tickets and categories belong to a team"`

### Tarefa 3: escopo por equipe na fila, no detalhe e nas ações

**Arquivos:**

- Modificar: `src/lib/services.ts` (`visible`, `getTicket`, `listTickets`, `claimTicket`, `assignTicket`, `setSupport`, `classifyTicket`, `relocateTicket`, `addComment`), `src/app/(private)/chamados/page.tsx`, `src/app/(private)/chamados/[id]/page.tsx`, `src/components/tickets.tsx`, `src/app/(private)/page.tsx` (contadores, se houver)
- Testes: `tests/critical.test.ts`

**Interfaces:**

- Consome: `Ticket.teamId` e `User.teamId`.
- Produz:
  - `function canSee(user: { id: string; role: Role; teamId: string | null }, ticket: Ticket & { participants: { userId: string }[] }): boolean`, interna a `services.ts`, que substitui `visible`. Ela lança 404 quando a resposta é falsa, pelo mesmo caminho de `visible`.
  - `listTickets` aceita `input.teamId`, mas só para ADMIN.
  - `getTicket` devolve `team: { id, key, name }`.

- [ ] **Passo 1: escrever os testes que falham** em `tests/critical.test.ts`. Criar `eletricista` e `eletricista2` (Elétrica) e usar `tech`/`tech2` (TI).
  - `técnico só vê a fila e o detalhe da própria equipe`:
    - com um chamado da TI, `listTickets(eletricista)` não o contém, em nenhum filtro;
    - `getTicket(eletricista, id)` rejeita com status 404;
    - `addComment`, `classifyTicket` e `relocateTicket` do eletricista rejeitam com 404;
    - `listTickets(admin, 'todos', 1, { teamId: eletrica })` contém só chamados da Elétrica.
  - `busca por número não revela chamado de outra equipe`: `listTickets(eletricista, 'todos', 1, { q: ticketNumber(n) })` tem `total === 0`. (Foco de revisão 5.)
  - `ajudante de outra equipe vê e comenta só o chamado em que está, e perde acesso ao sair`:
    - `tech` assume o chamado e adiciona `eletricista` como apoio;
    - `getTicket(eletricista)` resolve, e o chamado aparece em `listTickets(eletricista, 'apoio')` e em `'meus'`;
    - outro chamado da TI continua 404;
    - depois de `setSupport(tech, id, eletricista, false)`, `getTicket` volta a 404. (Foco de revisão 2.)
  - `assumir e transferir só dentro da equipe do chamado`:
    - `claimTicket(eletricista, chamadoTI)` rejeita;
    - `assignTicket(tech, id, eletricista)` rejeita com `/Selecione um técnico ativo da equipe do chamado/`;
    - `assignTicket(tech, id, tech2)` funciona;
    - `assignTicket(tech2, id, admin)` funciona (ADMIN é aceito).

- [ ] **Passo 2: rodar e ver falhar.** `npm test -- tests/critical.test.ts`. Esperado: FAIL nos quatro testes novos.

- [ ] **Passo 3: implementar.**
  - Escopo de leitura para `role === 'TI'`: `teamId = user.teamId OR participants.some(userId = user.id)`.
  - Em `listTickets`:
    - os filtros `novos`, `aguardando` e `todos` usam `where.teamId = user.teamId`;
    - `meus` e `apoio` mantêm o `OR` existente, que já inclui o chamado de apoio de outra equipe;
    - `atendimento`, `minha-espera` e `resolvidos-hoje` são por responsável e não mudam;
    - o ADMIN aplica `input.teamId` (validado por zod `.max(100)`) quando informado.
  - `claimTicket`: para TI, adicionar `teamId: user.teamId` ao `where` do `updateMany` condicional. A mensagem 409 de "já assumido" continua.
  - `assignTicket`: o destino deve ser ativo da organização e ser ADMIN ou ter `role 'TI'` com `teamId = ticket.teamId`. Senão, `AppError('Selecione um técnico ativo da equipe do chamado.')`.
  - `setSupport`: o destino continua sendo qualquer técnico ativo da organização, de qualquer equipe.
  - `classifyTicket`, `relocateTicket` e `addComment` passam pela checagem de leitura antes de mutar. `lockedTicket` precisa trazer `participants`.
  - UI:
    - selo de equipe na lista e no detalhe;
    - no detalhe, o select "Novo responsável principal" lista só ADMIN e técnicos da equipe do chamado;
    - "Adicionar apoio" lista técnicos de todas as equipes, com o rótulo da equipe na opção (`Fulano · Elétrica`);
    - o ADMIN tem um filtro "Equipe" na fila (`name="teamId"`).

- [ ] **Passo 4: rodar a suíte inteira.** `npm test`. Esperado: PASS.

- [ ] **Passo 5: commit.** `git commit -m "feat: scope queue, detail and actions by team"`

### Tarefa 4: mover chamado para a outra equipe

**Arquivos:**

- Modificar: `src/lib/services.ts` (nova `moveTicketTeam`), `src/app/actions.ts` (`ticketAction`, intent `team-move`), `src/app/(private)/chamados/[id]/page.tsx`, `src/lib/labels.ts`
- Testes: `tests/critical.test.ts`

**Interfaces:**

- Consome: `EventType.EQUIPE_ALTERADA` (Tarefa 2) e a checagem de leitura (Tarefa 3).
- Produz:
  - `export async function moveTicketTeam(actorId: string, ticketId: string, teamId: string): Promise<void>`.
  - O evento `EQUIPE_ALTERADA` tem `fromStatus`/`toStatus`, `metadata: { previousTeamId, nextTeamId, previousAssigneeId, previousCategoryId }`, `previousCategoryId` e `nextCategoryId: null`.

- [ ] **Passo 1: escrever os testes que falham.**
  - `responsável ou ADMIN move o chamado para a outra equipe, que o recebe como novo`:
    - `tech` assume um chamado da TI, classifica com uma categoria TI, põe em AGUARDANDO e adiciona `eletricista` como apoio;
    - `moveTicketTeam(tech, id, eletrica)` deixa: `status === 'NOVO'`, `assigneeId === null`, `startedAt === null`, `waitingReason === null`, `categoryId === null` e `teamId === eletrica`;
    - o participante continua;
    - o último evento é `EQUIPE_ALTERADA`, com `metadata.previousTeamId === ti`.
  - `não move para a mesma equipe, nem chamado resolvido, nem quem não é responsável`:
    - mover para a mesma equipe rejeita com `/já é desta equipe/`;
    - chamado `RESOLVIDO` rejeita;
    - `tech2` (não responsável) rejeita com 403;
    - `eletricista`, que é apoio, rejeita com 403.
  - `após mover, só a nova equipe assume; mudanças concorrentes geram um único evento` (Foco de revisão 3):
    - `claimTicket(tech, id)` rejeita, e `claimTicket(eletricista, id)` funciona;
    - com outro chamado, `Promise.allSettled([moveTicketTeam(admin, id, eletrica), moveTicketTeam(admin, id, eletrica)])`, repetido em 6 rodadas como nos testes de corrida existentes, tem exatamente 1 `fulfilled` e 1 evento `EQUIPE_ALTERADA`.

- [ ] **Passo 2: rodar e ver falhar.** `npm test -- tests/critical.test.ts`. Esperado: FAIL, porque `moveTicketTeam is not a function`.

- [ ] **Passo 3: implementar `moveTicketTeam`.**
  - Abrir com `actor(tx, actorId, techRoles)`, `lockedTicket` e `manages`.
  - Validar o destino com `requireTeam`. Rejeitar se for a mesma equipe (`'Este chamado já é desta equipe.'`) ou se o status for `RESOLVIDO` (`'Chamado resolvido não pode mudar de equipe.'`).
  - Fazer um único `tx.ticket.update`, que satisfaz os CHECKs `assignment_matches_status` e `waiting_reason_matches_status`, seguido de `recordTicketEvent`.
  - No detalhe, para o responsável ou o ADMIN, mostrar o botão "Mover para Elétrica" ou "Mover para TI", com uma frase explicando que o chamado volta como novo para a outra equipe.
  - Depois de mover, o técnico da TI deixa de ver o chamado (a não ser que seja apoio). O redirect da action vai para `/chamados`.
  - Adicionar `eventLabels.EQUIPE_ALTERADA = 'Equipe alterada'`. A timeline mostra "de TI para Elétrica".

- [ ] **Passo 4: rodar a suíte inteira.** `npm test`. Esperado: PASS.

- [ ] **Passo 5: commit.** `git commit -m "feat: move a ticket to the other team"`

### Tarefa 5: avisos por equipe

**Arquivos:**

- Modificar: `src/lib/ticket-events.ts` (`queueEventNotifications`), `src/lib/push-worker.ts` (revalidação e títulos)
- Testes: `tests/notifications.test.ts`

**Interfaces:**

- Consome: `Ticket.teamId`, `User.teamId` e `EQUIPE_ALTERADA`.

- [ ] **Passo 1: escrever os testes que falham** em `tests/notifications.test.ts`.
  - Ajustar o teste existente `novo chamado normal notifica TI ativos...` para criar o chamado com `teamId` TI e afirmar que **só** os técnicos da TI recebem.
  - Novo teste `chamado elétrico notifica só a Elétrica; mover avisa a nova equipe`:
    - um chamado da Elétrica gera `PushDelivery` só para subscriptions de eletricistas;
    - um chamado movido da TI para a Elétrica gera entregas do evento `EQUIPE_ALTERADA` só para eletricistas, sem o ator.
  - Novo teste `dispatcher cancela entrega quando o destinatário perde acesso pela equipe`:
    - enfileirar o aviso de apoio para `eletricista` num chamado da TI e removê-lo do apoio antes do dispatch;
    - com o `PushSender` controlado já usado no arquivo, a entrega termina `CANCELLED` e o sender não é chamado.

- [ ] **Passo 2: rodar e ver falhar.** `npm test -- tests/notifications.test.ts`.

- [ ] **Passo 3: implementar.**
  - Em `queueEventNotifications`, `CRIADO` vindo do PORTAL vai para `{ role: 'TI', teamId: ticket.teamId }`. `EQUIPE_ALTERADA` vai para `{ role: 'TI', teamId: ticket.teamId }`, que já é a equipe nova.
  - No `push-worker`:
    - incluir `participants` no ticket (já incluído);
    - para `role 'TI'`, `canRead = user.teamId === ticket.teamId || ticket.participants.some(p => p.userId === user.id)`;
    - `stillRecipient` para `CRIADO`/`EQUIPE_ALTERADA` exige `role 'TI'` e `teamId === ticket.teamId`;
    - adicionar o título `EQUIPE_ALTERADA: 'Chamado recebido de outra equipe'`.

- [ ] **Passo 4: rodar a suíte inteira.** `npm test`. Esperado: PASS.

- [ ] **Passo 5: commit.** `git commit -m "feat: notify only the ticket's team"`

### Tarefa 6: equipe nos indicadores e no CSV

**Arquivos:**

- Modificar: `src/lib/analytics-query.ts` (`analyticsFilters`, `metricsCTE`), `src/lib/analytics-service.ts` (`analyticsOptions`, `teamReport`, `technicianDetail` se listar técnicos, `ExportRow`, `exportRows`, `describeFilters`), `src/lib/csv.ts`, `src/components/management/filters.tsx`, `src/components/management/ticket-table.tsx`, `docs/metrics.md`
- Testes: `tests/management.test.ts`

**Interfaces:**

- Produz:
  - `AnalyticsFilters` ganha `team?: string`, lido do parâmetro `team` e validado com `z.string().max(100).optional()`.
  - `analyticsOptions` devolve `teams: { id; name }[]`.
  - `ExportRow` ganha `team: string`.
  - O CSV ganha a coluna `'Equipe'`, logo depois de `'Número'`.

- [ ] **Passo 1: escrever os testes que falham** em `tests/management.test.ts`.
  - `filtro de equipe recorta panorama, filiais, chamados e CSV pela equipe atual`:
    - criar 2 chamados TI e 1 Elétrica e mover 1 TI para a Elétrica;
    - `overview(manager, { periodo: 'hoje', team: eletrica })` conta 2 abertos;
    - `exportRows` com `team` devolve 2 linhas com `team === 'Elétrica'`;
    - sem `team`, conta 3.
  - `tela Equipe com filtro lista os técnicos da equipe e os apoios vindos de fora`:
    - com `team: eletrica`, `teamReport` contém os eletricistas ativos e o `tech` da TI que apoiou um chamado elétrico;
    - não contém `tech2`, da TI, que não participou;
    - não contém o ADMIN que não participou.
  - `CSV tem coluna Equipe`: `csvHeader.startsWith('"Número","Equipe"')`.

- [ ] **Passo 2: rodar e ver falhar.** `npm test -- tests/management.test.ts`.

- [ ] **Passo 3: implementar.**
  - Em `metricsCTE`: `if (f.team) conditions.push(Prisma.sql\`t."teamId" = ${f.team}\`)`. No `base`, fazer `LEFT JOIN "Team" tm ON tm.id=t."teamId"`e expor`tm.name AS team`.
  - No `eligible` de `teamReport`, a condição `u.role='TI' AND u.active` ganha `AND u."teamId" = ${f.team}` quando há filtro. As participações vêm de `m`, que já está filtrado.
  - `describeFilters` inclui "Equipe: X".
  - O filtro de equipe aparece nas telas gerenciais e o valor é preservado nos links e na paginação.
  - Documentar em `docs/metrics.md`:
    - o filtro de equipe usa a equipe atual do chamado;
    - na tela Equipe, o filtro recorta os chamados e não as pessoas;
    - o histórico de quem mudou de equipe segue a equipe de cada chamado.

- [ ] **Passo 4: rodar a suíte inteira.** `npm test`. Esperado: PASS.

- [ ] **Passo 5: commit.** `git commit -m "feat: team filter in management metrics and CSV"`

### Tarefa 7: relatórios em PDF

**Arquivos:**

- Criar: `src/lib/pdf-report.ts`, `src/lib/management-pdf.ts`, `src/app/gestor/relatorio/route.ts`, `src/components/management/pdf-link.tsx`
- Modificar: `package.json`/`package-lock.json` (`pdfkit` + `@types/pdfkit`), `next.config.ts` (se o build exigir `serverExternalPackages: ['pdfkit']`), as 6 páginas gerenciais
- Testes: `tests/pdf.test.ts` (novo)

**Interfaces:**

- Consome: `overview`, `companiesReport`, `teamReport`, `technicianDetail`, `managementTickets`, `exportRows`, `describeFilters`, `formatDuration` e `managementAccess` (Tarefa 6).
- Produz:
  - `pdf-report.ts`:
    - `export type PdfReport = { title: string; organizationName: string; generatedBy: string; generatedAt: Date; filters: string[]; sections: PdfSection[]; notice?: string }`
    - `export type PdfSection = { heading: string; kpis?: [label: string, value: string][]; table?: { columns: string[]; rows: string[][] } }`
    - `export async function renderReportPdf(report: PdfReport): Promise<Buffer>`
  - `management-pdf.ts`:
    - `export type PdfScreen = 'panorama' | 'filiais' | 'filial' | 'equipe' | 'tecnico' | 'chamados'`
    - `export async function buildManagementPdf(actorId: string, screen: PdfScreen, input: SearchParams, id?: string, options: { now?: Date; maxRows?: number } = {}): Promise<PdfReport>`, com `maxRows` padrão 2000
  - A rota é `GET /gestor/relatorio?tela=<PdfScreen>&id=<opcional>&<filtros>`.

- [ ] **Passo 1: instalar a dependência.** `npm install pdfkit@<última estável> && npm install -D @types/pdfkit`, com versão exata no `package.json`. Depois, `npm audit --omit=dev`. Esperado: 0 vulnerabilidades.

- [ ] **Passo 2: escrever os testes que falham** em `tests/pdf.test.ts`.
  - `renderReportPdf gera PDF válido com acentos`: o resultado de `renderReportPdf({ ..., title: 'Panorama — Elétrica', sections: [{ heading: 'Volume', kpis: [['Abertos', '3']] }] })` satisfaz `buf.subarray(0, 5).toString() === '%PDF-'` e `buf.length > 500`.
  - `buildManagementPdf aplica filtros e escopo` (dados como na Tarefa 6):
    - `buildManagementPdf(manager, 'chamados', { periodo: 'hoje', team: eletrica })` tem uma tabela com 2 linhas, e `filters` contém `'Equipe: Elétrica'`;
    - `indisponível vira "—"`: num técnico sem histórico, a célula de tempo é `'—'`;
    - `buildManagementPdf(tech, 'panorama', {})` rejeita com 403;
    - `buildManagementPdf(manager, 'filial', {}, idDeOutraOrganizacao)` rejeita com 404.
  - `PDF de chamados corta no limite e avisa`: `buildManagementPdf(manager, 'chamados', filtros, undefined, { maxRows: 3 })` com 4 chamados gera 3 linhas, e `notice` contém `'CSV'`. O padrão de produção é 2000.

- [ ] **Passo 3: rodar e ver falhar.** `npm test -- tests/pdf.test.ts`.

- [ ] **Passo 4: implementar.**
  - `renderReportPdf`:
    - pdfkit A4, margens de 40 e fonte Helvetica embutida no pdfkit, sem fonte externa. Os acentos do português estão em WinAnsi;
    - cabeçalho com organização, título, filtros e "Gerado em <data em APP_TIMEZONE> por <nome>";
    - KPIs em pares e tabela com quebra de página que repete o cabeçalho;
    - numeração "Página X de Y".
  - `buildManagementPdf` monta as seções de cada tela a partir das funções existentes. Para `chamados`, usar `exportRows` em `RepeatableRead` até `maxRows + 1`.
  - A rota segue a autenticação de `src/app/gestor/exportar/route.ts`. Filtro inválido devolve 400. Headers:
    - `Content-Type: application/pdf`;
    - `Content-Disposition: attachment; filename="central-suporte-<tela>.pdf"`;
    - `Cache-Control: private, no-store`;
    - `X-Content-Type-Options: nosniff`.
  - `PdfLink({ screen, params, id? })` é um link "Baixar PDF" ao lado do CSV, preservando os filtros, e aparece nas 6 telas.

- [ ] **Passo 5: rodar os testes e o build.**
  - `npm test -- tests/pdf.test.ts`. Esperado: PASS.
  - `npm run build`. Esperado: sucesso.
  - Se o build falhar por arquivo de fonte do pdfkit, adicionar `serverExternalPackages: ['pdfkit']` em `next.config.ts` e repetir.
  - Confirmar que `.next/standalone` contém `node_modules/pdfkit/js/data/Helvetica.afm`. Isso evita falha só em produção, já que a imagem usa standalone.

- [ ] **Passo 6: commit.** `git commit -m "feat: PDF reports for management screens"`

### Tarefa 8: documentação, E2E e validação completa

**Arquivos:**

- Modificar: `AGENTS.md`, `README.md`, `docs/organization-model.md`, `tests/e2e/workflow.spec.ts`, `tests/e2e/live-push.spec.ts`

- [ ] **Passo 1: atualizar o E2E.**
  - `workflow.spec.ts`:
    - o `createUser` de técnico escolhe a equipe;
    - criar um eletricista;
    - o funcionário abre um chamado escolhendo "Elétrica";
    - o eletricista vê e assume o chamado, e o técnico de TI não o vê na fila;
    - o eletricista adiciona o técnico de TI como apoio, e este passa a ver o chamado;
    - o gestor baixa o PDF do panorama: resposta 200 e `content-type` `application/pdf`.
  - Incluir a nova tela no axe já usado.
  - `live-push.spec.ts`: os técnicos de fixture recebem `teamId`.

- [ ] **Passo 2: atualizar a documentação.**
  - `AGENTS.md`:
    - equipes TI e Elétrica;
    - papel Técnico com equipe;
    - escopo de leitura por equipe ou apoio;
    - principal sempre ADMIN ou da equipe do chamado;
    - mudança de equipe com evento;
    - PDF gerencial com a mesma permissão do CSV.
  - `README.md`: abertura com escolha de equipe, cadastro de técnico com equipe, PDF e decisão de dependência (`pdfkit`).
  - `docs/organization-model.md`: Team por organização e trigger de criação.

- [ ] **Passo 3: rodar a validação completa.** `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e && npm audit --omit=dev`. Esperado: todos com sucesso e 0 vulnerabilidades.

- [ ] **Passo 4: commit.** `git commit -m "docs: teams and PDF reports; e2e coverage"`
