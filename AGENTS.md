# Central de Suporte — decisões para agentes

## Escopo

- Monólito Next.js 16/App Router, React, TS strict, Tailwind 4, Prisma 7/adapter-pg, PostgreSQL 17, npm. Webpack em dev/build por incompatibilidade local do Turbopack; validar antes de trocar.
- Sistema fechado: sem signup/auth externa, SaaS comercial, IA, microserviços, offline completo, integrações, reabertura, ranking/score. Deploy externo só mediante pedido.
- Estoque único de ferramentas e materiais de manutenção (sem preço, fornecedor, compra ou vários locais): leia `docs/superpowers/specs/2026-11-10-estoque-design.md`.

## Segurança e permissões

- `src/lib/auth.ts` protege rotas/actions; `src/lib/access.ts` relê ator ativo/role/organização. Escopo e autoria vêm do servidor; validar IDs por recurso, nunca confiar em role, registrador, setor ou responsável do cliente.
- FUNCIONARIO lê/comenta só os próprios chamados; TI/ADMIN veem fila; só principal/ADMIN altera status, apoios e responsável. Gestão/CSV/PDF: ADMIN/GESTOR (o PDF usa a mesma permissão, filtros e validações do CSV, sempre GET de leitura); GESTOR não acessa detalhe operacional, TI não acessa indicadores dos colegas. Cadastros: só ADMIN.
- Equipes: leia `docs/organization-model.md` (Team). Duas equipes por organização, **TI** e **Elétrica** (tabela `Team`, criada por trigger em cada Organization). `Role.TI` é exibido como “Técnico” e exige `teamId`; ADMIN, GESTOR e FUNCIONARIO não têm equipe. Todo Ticket tem `teamId` (NOT NULL); categorias pertencem a uma equipe.
- Leitura por equipe: técnico vê o chamado se é da sua equipe **ou** se está em `TicketParticipant`; remover o apoio remove o acesso na hora. Outra equipe responde 404 em detalhe, `/notificacoes/[id]`, comentário, classificação, localização e busca por número. ADMIN vê tudo (filtro por equipe na fila); GESTOR continua sem detalhe operacional. O principal é sempre ADMIN ou técnico da equipe do chamado; outra equipe entra só como apoio (a lista de apoio traz “Nome · Equipe”).
- Mudar de equipe: principal/ADMIN, chamado não resolvido, via `moveTicketTeam`; volta NOVO, sem responsável, categoria limpa, apoios mantidos, evento `EQUIPE_ALTERADA` e aviso só à equipe de destino. Assumir remove o assumidor do apoio. Não trocar a equipe de técnico que é principal de chamado aberto. Abertura comum exige escolha de equipe sem valor padrão; atendimento rápido usa a equipe de quem registra (ADMIN escolhe).
- Mutações: Server Actions ou endpoints push, com Origin contra APP_URL; nunca GET. Exceção às Server Actions: `POST /api/estoque/uso-avulso` (foto), com Origin contra APP_URL. Preservar login com limite persistente/erro genérico e erros sem stack trace.
- Senhas/PINs **6–128 caracteres**, inclusive só números, com Argon2id; parâmetros e sessão conforme README § Segurança/Modelo de dados. Novas/redefinidas exigem troca; alterações de usuário/senha revogam sessões. Persistir só hash do token; cookies HttpOnly/Lax, Secure fora de localhost; validade 8 h.

## Persistência e concorrência

- Ticket + evento + outbox na mesma transação. Assumir: UPDATE condicional (`NOVO`, responsável null); demais mutações: row lock. Sequência desempata eventos simultâneos; dados essenciais de auditoria em colunas, JSON auxiliar.
- Apoio é relação `TicketParticipant`, não principal; preservar eventos de apoio/transferência. Categoria/complexidade opcionais, alteradas por TI/ADMIN com evento.
- FKs/histórico preservados; usuários/filiais/unidades só desativados na interface. Advisory lock mantém ADMIN ativo; proibir auto-desativação/rebaixamento.
- Migrations SQL incrementais, preservando CHECKs/triggers; nunca resetar dados ou reescrever migrations aplicadas. Fontes: `prisma/schema.prisma`, `prisma/migrations/` e `src/lib/services.ts`.

## Organização e identidade

Leia **`docs/organization-model.md` antes de alterar isolamento, locais ou solicitantes**; regras executáveis em `src/lib/organization-service.ts`.

- Organização vem do ator, nunca do cliente; escopar inclusive opções, busca, contadores, SQL/CSV. Login/sessão usam APP_ORGANIZATION_ID e rejeitam organização inativa. Entidades principais têm organizationId; filhos podem derivar; triggers impedem relações cruzadas. Username/número do chamado continuam globalmente únicos.
- Company = CNPJ normalizado/validado localmente, único por organização; Unit física opcional, Company imutável. Labels: `src/lib/organization-labels.ts`. FUNCIONARIO usa locais autorizados conforme contrato; TI atende toda a organização. Validar combinação Company/Unit e atividade em novas aberturas.
- Novo Ticket exige Company, openedByUserId e requesterName imutável como snapshot; requesterId opcional. Abertura comum: logado é registrador/solicitante; setor capturado do solicitante, não recalculado ao editar User.
- Rápido textual: Company explícita, sem conta fictícia/setor inferido. Legados podem ter Company/registrador nulos: não inventar localização/autoria nem excluir de busca/métricas/CSV.

## Métricas

Leia **`docs/metrics.md` antes de alterar consultas/CSV**. Implementação: `src/lib/analytics-query.ts` e `src/lib/analytics-service.ts`.

- Respeitar coortes distintas: backlog atual, resolução só para responsável final, apoio removido permanece histórico. Ciclo ativo não é hora individual; histórico insuficiente é indisponível, nunca zero.
- Agregar no PostgreSQL com SQL parametrizado; JOINs opcionais preservam “Sem filial/unidade/setor”. CSV mantém filtros, neutraliza fórmulas e pagina em snapshot repeatable-read.
- Filtro gerencial `team` usa a equipe **atual** do chamado; CSV tem a coluna “Equipe”. PDF (`GET /gestor/relatorio`, pdfkit, fonte Helvetica embutida no PDF sem arquivos externos) reaproveita as consultas das telas, no máx. 2.000 linhas em Chamados (acima disso avisa e indica o CSV) e mostra “—” para indicador indisponível.

## Operação e UI

- PT-BR, funcionário/TI mobile-first. Abertura comum só descrição/impacto; Rápido curto/destacado. Sem fontes externas ou cache privado no SW/proxy; listas paginadas.
- UTC no banco; APP_TIMEZONE central em `src/lib/config.ts`, padrão America/Belem para exibição/filtros.
- **README § Atualização automática e Web Push** rege polling, destinatários e ciclo de subscriptions. Revisão transacional por organização (TI/ADMIN) ou solicitante (FUNCIONARIO), nunca global ao funcionário. Polling 5 s + router.refresh(), pausado em aba oculta/edição.
- Eventos via `src/lib/ticket-events.ts`; outbox evento/subscription atômico, sem rede na transação. Worker no Next persistente usa lease/retry limitado e revalida destinatário/organização; não substituir por envio não persistido após ação.
- VAPID só env; subscription do autenticado/organização. Preservar allowlist anti-SSRF, deduplicação, limpeza 404/410 e desvinculação no logout. Permissão só por clique; payload sem descrição/comentários/nomes pessoais. Rápido não alerta toda a equipe. Chamado novo do portal e `EQUIPE_ALTERADA` avisam só os técnicos ativos da equipe do chamado.

## Produção e validação

- **`docs/production.md` antes de alterar deploy/recuperação**: Compose local só banco; produção Next persistente/PostgreSQL/Caddy. APP_ENV=production exige HTTPS/Secure/VAPID/worker; app sem porta pública, IP confiável só sobrescrito pelo Caddy; limites de login por conta e IP.
- Standalone sem secrets, SQL da aplicação sem DDL, migrations antes do app. Produção/demo/testes separados. Restore só em banco novo central_restore_*, revogando sessões/subscriptions/push pendente; nunca sobrescrever banco ativo ou desfazer migrations no rollback.
- Seed fictício exclusivamente central_suporte_demo com SEED_DEMO=true.
- Com PostgreSQL ativo: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`; dependências alteradas: `npm audit`. Testes só em banco descartável central_test_*; E2E usa build/porta 3100. README detalha execução.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
