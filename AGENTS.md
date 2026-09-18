# Central de Suporte — regras de arquitetura

## Escopo e stack

- Monólito Next.js 16 App Router + React + TypeScript strict, PostgreSQL 17, Prisma 7 com adapter-pg, npm e Tailwind 4.
- Sistema corporativo fechado. Não adicionar signup, autenticação externa, SaaS, IA, Supabase, Firebase ou microserviços.
- A V1.2 inclui organização, localizações, solicitantes sem conta, gestão e métricas conforme docs/metrics.md. Push, offline, inventário, IA, pontuação, ranking e integrações continuam fora do escopo.
- Não fazer deploy externo sem pedido. O projeto usa execução local e Docker Compose apenas para o banco.
- Dev/build usam Webpack por compatibilidade com o ambiente restrito (o Turbopack requer uma porta interna indisponível aqui). Isso não altera o App Router nem a arquitetura.

## Segurança e acesso

- A autorização real fica no servidor. `src/lib/auth.ts` valida sessões nas páginas/actions e `src/lib/access.ts` relê o ator no banco para cada operação.
- Nunca aceitar role, autor, setor de abertura ou técnico principal do cliente como fonte de autorização. IDs recebidos devem passar pelas regras do serviço.
- FUNCIONARIO só lê/comenta os próprios chamados. TI/ADMIN veem a fila; apenas responsável principal ou ADMIN alteram status, apoio e responsável. GESTOR tem relatórios e CSV, mas não acessa detalhes operacionais de chamados. Somente ADMIN/GESTOR podem acessar /gestor e suas consultas/exportações. TI não acessa indicadores de colegas.
- Todas as mutações web são Server Actions com verificação explícita de Origin contra APP_URL, além da proteção do Next.js. Não criar mutações GET.
- Cookies HttpOnly, SameSite=Lax, validade de 8 horas; Secure obrigatório fora de localhost. Sessões persistem somente hash SHA-256 do token aleatório de 256 bits.
- Senhas Argon2id (64 MiB, 3 iterações, paralelismo 1), 6–128 caracteres. Nunca logar senha, hash, token, `.env` ou conteúdo de formulários.
- Usuários novos/resetados obrigatoriamente trocam senha. Inativação, alterações cadastrais e redefinição revogam sessões.
- Preservar mensagens genéricas de login e limitação persistente de tentativas. Tratar AppError/ZodError sem expor stack traces.

## Persistência e concorrência

- Mudanças de chamado e eventos de auditoria são atômicos, na mesma transação.
- Assumir usa UPDATE condicional (`NOVO` e responsável null). Não substituir por read-then-write sem lock.
- Outras mudanças usam row lock do chamado. Eventos têm sequência monotônica para desempatar timestamps dentro da mesma transação.
- Apoio é relação TicketParticipant, nunca array/JSON. Não confundir apoio com responsável principal.
- Dados essenciais de evento (ator, destino, status, motivo, timestamp) são colunas; JSON apenas para informações auxiliares.
- Setor do chamado é snapshot relacional do setor do solicitante na abertura; não recalcular ao editar o usuário.
- Não apagar usuários/chamados/eventos/comentários com histórico. A V1 só permite desativação. FKs restritivas preservam a rastreabilidade.
- Alterações de admins usam advisory lock para preservar ao menos um administrador ativo. Não permitir auto-desativação/rebaixamento.
- Migrations SQL versionadas são a fonte de evolução; preservar CHECK constraints adicionais. Nunca executar reset/drop no banco de aplicação para testar.

## Interface e manutenção

- Português do Brasil, mobile-first para funcionário e TI, HTML semântico e labels explícitos.
- Evitar bibliotecas de UI quando componentes pequenos resolverem. CSS usa tokens e componentes locais, com Tailwind disponível.
- Não usar fontes externas: o sistema deve funcionar localmente sem buscar assets em terceiros.
- PWA não pode cachear páginas privadas ou dados de usuários. Service worker atual só prepara instalação.
- Datas em UTC; APP_TIMEZONE em src/lib/config.ts (padrão America/Belem) centraliza exibição e filtros. Não hardcode fuso em outros módulos. Chamados/equipe/comentários paginados em 20 e timeline em 30 registros.
- Não substituir serviços por mocks nem ignorar erros para fazer testes passarem.

## Validação

- Executar `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` após mudanças relevantes.
- `npm run test:e2e` usa o build de produção e uma porta dedicada (3100). Não reutiliza servidor da aplicação.
- Testes criam um banco aleatório `central_test_*` e removem só esse banco. PostgreSQL local precisa estar ativo.
- E2E usa Chrome local quando instalado, ou Chromium do Playwright. Screenshots/traces ficam em test-results, ignorado pelo Git.
- Não commitar `.env`, node_modules, `.next`, Prisma gerado, credenciais ou artefatos de testes.
- Overrides de deepmerge-ts e mysql2 corrigem advisories transitivos do Prisma CLI; verificar compatibilidade e auditoria ao atualizar.

## Gestão e métricas

- Leia docs/metrics.md antes de mudar consultas; o contrato diferencia coortes de criação, resolução, participação e backlog atual.
- Agregações em src/lib/analytics-query.ts e analytics-service.ts usam SQL parametrizado e eventos. Nunca envie todos os chamados ao cliente para calcular métricas.
- Categoria e complexidade opcionais, alteradas por TI/ADMIN, com evento atômico. Funcionário continua abrindo somente com descrição/impacto.
- Apoio removido permanece nas métricas históricas via eventos. Somente o responsável final recebe a resolução. Não converter tempo de ciclo em horas individuais.
- Histórico incompleto é indisponível, nunca zero inventado. Mediana usa percentile_cont e amostra explícita.
- CSV autentica e autoriza, neutraliza fórmulas e usa paginação por chave em snapshot repeatable-read.
- Dados fictícios apenas em central_suporte_demo com SEED_DEMO=true e .env.demo ignorado. Nunca popular banco real com seed de demonstração.
- Senhas/PINs de 6–128 caracteres são decisão explícita do usuário; não exigir apenas números nem restaurar mínimo 12.

## Organização e localizações

- Leia docs/organization-model.md antes de alterar escopo, identidade do solicitante ou permissões de localização.
- Toda entidade principal possui organizationId explícito. Derive o valor do ator autenticado; nunca aceite tenant do cliente. Todas as consultas sensíveis, inclusive opções, contadores, SQL analítico e CSV, devem restringir organização.
- Login/sessão usam APP_ORGANIZATION_ID do servidor e rejeitam organização inativa. Não adicionar troca de tenant ou SaaS comercial. Username e número de chamado mantêm unicidade global nesta instalação.
- Preservar triggers de integridade organizacional e imutabilidade da Company de Unit. Não duplicar organizationId em filhos quando o escopo é derivado e protegido.
- Company é CNPJ, Unit é local físico opcional. Company pode não ter Units. Labels da interface em organization-labels.ts.
- CNPJ numérico normalizado, 14 dígitos e verificadores locais. Unicidade dentro da Organization; nenhuma API externa.
- FUNCIONARIO usa Company principal/adicionais e Units autorizadas. TI atende toda a organização. Validar a combinação Company/Unit no servidor.
- Novos chamados sempre gravam openedByUserId e requesterName. requesterId é opcional. Não criar User fictício; setor manual desconhecido é null.
- requesterName é snapshot: não alterar ao editar nome do User. Não presumir Company ou autoria de registros antigos; nullable histórico é deliberado.
- Atendimento Rápido textual requer Company explícita. Não sugerir Company por nome nem atribuir setor do TI ao solicitante.
- Métricas precisam de LEFT JOIN para solicitante/setor opcionais, mantendo Sem filial/Sem unidade/Sem setor. Preservar as definições de tempos existentes.
- Filiais/unidades somente desativadas; não apagar histórico. Demo adiciona localizações apenas ao banco separado e preserva contas/senhas.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
