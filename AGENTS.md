# Central de Suporte — contexto para agentes

## Escopo e stack

- Monólito interno Next.js 16 App Router, React, TypeScript strict, Tailwind 4, Prisma 7/adapter-pg, PostgreSQL 17 e npm; Docker Compose só para o banco. Sem deploy externo nesta fase.
- Sistema fechado: sem signup, autenticação externa, SaaS comercial, IA, microserviços, offline completo, inventário, integrações, reabertura, ranking ou score. `dev`/`build` usam Webpack pela incompatibilidade local do Turbopack; validar antes de trocar.

## Segurança e permissões

- Autorizar no servidor: `src/lib/auth.ts` protege rotas/actions; `src/lib/access.ts` relê ator ativo, role e organização. Validar IDs por recurso; jamais confiar em role, registrador, setor ou responsável enviados pelo cliente.
- FUNCIONARIO só lê/comenta os próprios chamados; TI/ADMIN veem a fila; só responsável principal ou ADMIN gerencia status, apoios e transferência. GESTOR/ADMIN acessam gestão/CSV; GESTOR não vê detalhe operacional, TI não vê indicadores individuais dos colegas. Só ADMIN administra cadastros.
- Mutações web: Server Actions ou endpoints de subscription push, sempre com `Origin` validado contra `APP_URL`; nenhuma mutação por GET. Preservar limite persistente e erro genérico de login; não expor stack traces.
- Senhas/PINs: 6–128 caracteres, inclusive numéricos, Argon2id (64 MiB/3 iterações/paralelismo 1). Novas/redefinidas exigem troca; alterações de usuário/senha revogam sessões. Sessão de 8 h: apenas SHA-256 do token aleatório de 256 bits no banco; cookie HttpOnly/SameSite=Lax, Secure fora de localhost.

## Persistência e concorrência

- Estado do Ticket e `TicketEvent` mudam na mesma transação. Assumir usa UPDATE condicional (`NOVO`, sem responsável); demais mutações usam row lock. Sequência de eventos desempata timestamps iguais; colunas guardam dados essenciais da auditoria, JSON só auxilia.
- Apoio é `TicketParticipant`, distinto do principal; preservar eventos de apoio/transferência. Categoria e complexidade são opcionais, alteradas por TI/ADMIN com evento. Setor captura a referência do solicitante cadastrado na abertura; nome livre não recebe setor inferido.
- Preservar FKs/histórico: usuários, filiais e unidades só são desativados na interface. Mudanças de ADMIN usam advisory lock para manter um ADMIN ativo; vedada auto-desativação/rebaixamento. Migrations SQL incrementais preservam CHECKs/triggers; nunca resetar dados nem reescrever migrations aplicadas.

## Organização e localizações

- `Organization → Company` (Filial) `→ Unit` opcional. Company é CNPJ; Unit é local físico e não troca de Company após criação. CNPJ: 14 dígitos normalizados, verificadores locais, único por organização. Rótulos em `src/lib/organization-labels.ts`.
- Entidades principais têm `organizationId`; filhos podem derivá-lo. Login/sessão usam `APP_ORGANIZATION_ID` e rejeitam organização inativa. Escopar consultas, opções, busca, métricas e CSV pelo ator; triggers rejeitam relações cruzadas. Username e número de chamado seguem globalmente únicos nesta instalação.
- FUNCIONARIO usa Companies principal/adicionais e Units autorizadas; validar Company/Unit no servidor e rejeitar locais inativos para novas aberturas. TI atende toda a organização. Regras exatas de concessão de Units: `docs/organization-model.md`.
- Novo Ticket exige Company, `openedByUserId` e `requesterName` como snapshot da abertura; não recalcular o nome após editar User. `requesterId` é opcional. Abertura comum usa o logado como registrador/solicitante. Atendimento Rápido aceita User ou nome livre sem criar conta; nome livre exige Company explícita e deixa setor nulo. Não adivinhar localização/autoria de legados: Company/registrador podem ser nulos. Incluir esses chamados em busca, relatórios e CSV.

## Métricas

- `docs/metrics.md` é o contrato de coortes e tempos. Backlog é atual; só o responsável final recebe resolução; apoio removido continua histórico. Tempo ativo de ciclo não é hora individual. Histórico insuficiente é indisponível, nunca zero inventado.
- Agregar no PostgreSQL com SQL parametrizado e JOINs opcionais para solicitante/setor; preservar “Sem filial/unidade/setor”. CSV só para GESTOR/ADMIN, com mesmos filtros, neutralização de fórmulas e lotes em snapshot `repeatable-read`.

## UI e operação

- Português do Brasil; funcionário/TI mobile-first. Abertura comum pede só descrição e impacto; Atendimento Rápido permanece curto e destacado. Reutilizar componentes locais.
- Timestamps em UTC; `APP_TIMEZONE` em `src/lib/config.ts` (padrão `America/Belem`) rege exibição/filtros. PWA não pode cachear páginas/dados privados; sem fontes externas. Listas paginadas: chamados/equipe/comentários 20, timeline 30.

## Atualização automática e push

- Operação usa polling de revisão a cada 5 s e `router.refresh()`, pausado em aba oculta/edição. Revisões por organização (TI/ADMIN) ou solicitante (FUNCIONARIO) sobem com `TicketEvent` na transação; nunca expor revisão global a funcionário.
- Criar eventos via `src/lib/ticket-events.ts`: outbox por evento/subscription é atômico; nenhum envio de rede dentro da transação. Worker no processo Next.js (`instrumentation.ts`) usa lease, retry limitado e revalida destinatário/organização. Não substituir por envio sem persistência após ação.
- Web Push/VAPID só via env; subscriptions pertencem ao usuário autenticado e à organização. Preservar allowlist de endpoints contra SSRF, deduplicação, limpeza 404/410 e desvinculação no logout. Permissão só por clique; payload mínimo, sem descrição/comentários/nomes de pessoas. Atendimento Rápido não alerta toda a equipe. Contrato e limites no README.

## Validação e comandos

- Com PostgreSQL local: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`; após mudar dependências, `npm audit`. Testes usam banco descartável `central_test_*`; E2E usa build na porta 3100.
- Seed fictício só em `central_suporte_demo` com `SEED_DEMO=true`; nunca popular o banco principal. `.env.demo` e demais segredos não são versionados.

## Referências obrigatórias

- `README.md`: operação/escopo; `docs/metrics.md`: indicadores/CSV; `docs/organization-model.md`: isolamento, localizações, identidade e legados. Consultá-los antes de alterar essas áreas.
- `prisma/schema.prisma` e `prisma/migrations/`: modelo/constraints; `src/lib/services.ts`, `organization-service.ts`, `analytics-query.ts` e `analytics-service.ts`: regras executáveis.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
