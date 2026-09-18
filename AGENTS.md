# Central de Suporte — regras de arquitetura

## Escopo e stack

- Monólito Next.js 16 App Router + React + TypeScript strict, PostgreSQL 17, Prisma 7 com adapter-pg, npm e Tailwind 4.
- Sistema corporativo fechado. Não adicionar signup, autenticação externa, SaaS, IA, Supabase, Firebase ou microserviços.
- A V1 termina no fluxo operacional. Indicadores avançados, push, offline, inventário e integrações dependem de solicitação posterior.
- Não fazer deploy externo sem pedido. O projeto usa execução local e Docker Compose apenas para o banco.
- Dev/build usam Webpack por compatibilidade com o ambiente restrito (o Turbopack requer uma porta interna indisponível aqui). Isso não altera o App Router nem a arquitetura.

## Segurança e acesso

- A autorização real fica no servidor. `src/lib/auth.ts` valida sessões nas páginas/actions e `src/lib/services.ts` relê o ator no banco para cada operação.
- Nunca aceitar role, autor, setor de abertura ou técnico principal do cliente como fonte de autorização. IDs recebidos devem passar pelas regras do serviço.
- FUNCIONARIO só lê/comenta os próprios chamados. TI/ADMIN veem a fila; apenas responsável principal ou ADMIN alteram status, apoio e responsável. GESTOR não tem acesso operacional na V1.
- Todas as mutações web são Server Actions com verificação explícita de Origin contra APP_URL, além da proteção do Next.js. Não criar mutações GET.
- Cookies HttpOnly, SameSite=Lax, validade de 8 horas; Secure obrigatório fora de localhost. Sessões persistem somente hash SHA-256 do token aleatório de 256 bits.
- Senhas Argon2id (64 MiB, 3 iterações, paralelismo 1), 12–128 caracteres. Nunca logar senha, hash, token, `.env` ou conteúdo de formulários.
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
- Datas são armazenadas em UTC e exibidas em America/Sao_Paulo. Paginação de chamados em 20 registros.
- Não substituir serviços por mocks nem ignorar erros para fazer testes passarem.

## Validação

- Executar `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` após mudanças relevantes.
- `npm run test:e2e` usa o build de produção e uma porta dedicada (3100). Não reutiliza servidor da aplicação.
- Testes criam um banco aleatório `central_test_*` e removem só esse banco. PostgreSQL local precisa estar ativo.
- E2E usa Chrome local quando instalado, ou Chromium do Playwright. Screenshots/traces ficam em test-results, ignorado pelo Git.
- Não commitar `.env`, node_modules, `.next`, Prisma gerado, credenciais ou artefatos de testes.
- Overrides de deepmerge-ts e mysql2 corrigem advisories transitivos do Prisma CLI; verificar compatibilidade e auditoria ao atualizar.
