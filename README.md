# Central de Suporte

V1 funcional de uma central interna de atendimento de TI. Monólito full-stack local: Next.js 16.3.5, React 19.3, TypeScript strict, Tailwind CSS 4, PostgreSQL 17 e Prisma 7.10. Sem autenticação externa, serviços pagos ou APIs de IA.

## Requisitos

- Node.js **22.12+** (validado com Node.js 24) e npm.
- Docker com Docker Compose ativo.
- Porta **3000** livre para a aplicação e **54329** para o PostgreSQL. Os testes E2E usam 3100.
- Chrome local ou Chromium do Playwright para os testes de navegador.

## Iniciar do zero

No diretório do projeto:

```bash
npm ci
npm run setup:env
docker compose up -d --wait
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Abra **http://localhost:3000**.

`setup:env` cria `.env` com senhas aleatórias para PostgreSQL e ADMIN, permissão de arquivo 0600 e não sobrescreve configuração existente. Para configuração manual, copie `.env.example` para `.env`, substitua os placeholders e mantenha POSTGRES_PASSWORD e DATABASE_URL consistentes. Caracteres especiais na senha dentro da URL precisam de URL encoding.

### Primeiro administrador

O username local gerado é `admin`. Consulte **INITIAL_ADMIN_PASSWORD no seu `.env`** para a senha temporária; ela não é incluída no repositório nem impressa pelo seed. INITIAL_ADMIN_NAME define o nome inicial. O seed não redefine nem promove usuários existentes e pode ser executado novamente sem alterar credenciais.

No primeiro login, crie uma senha pessoal de pelo menos 12 caracteres e entre novamente. Acesse **Usuários → Criar usuário** para cadastrar um funcionário e dois técnicos de TI. Compartilhe cada senha temporária diretamente com a pessoa. Todos devem trocar a senha no primeiro acesso. Não há contas públicas ou senhas de demonstração fixas.

Os únicos dados iniciais são o ADMIN e os setores TI, Financeiro, RH, Comercial, Administrativo e Gerência. Esses nomes não fazem parte das regras de permissão.

### Executar o build de produção local

```bash
npm run build
npm run start
```

Não execute `dev` e `start` ao mesmo tempo na mesma porta. Para mudar a porta, altere APP_URL no `.env` e use, por exemplo, `npm run dev -- --port 3001`. Reinicie o servidor após mudar variáveis.

`COOKIE_SECURE=false` é permitido somente em HTTP localhost/127.0.0.1. Acesso por outro hostname exige HTTPS e COOKIE_SECURE=true. APP_URL precisa ser a origem exata usada no navegador, pois é validada em todas as mutações.

### Banco

```bash
docker compose ps
docker compose logs db
docker compose stop
docker compose up -d --wait
```

Os dados persistem no volume `central-suporte_postgres_data`. O PostgreSQL só é exposto no loopback da máquina. **Não use `docker compose down -v`** para parar: essa opção apaga o volume. Modificar a senha no `.env` não altera uma senha já inicializada no volume; use uma mudança de senha no próprio PostgreSQL quando necessário.

Migrations são aplicadas com `npm run db:migrate`. Para evoluir o schema em desenvolvimento: edite `prisma/schema.prisma`, use `npx prisma migrate dev --name nome_da_mudanca` e regenere o cliente. Preserve as constraints SQL adicionais.

## Uso e permissões

| Perfil      | Acesso                                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FUNCIONARIO | Abre chamado com descrição/impacto, vê apenas os próprios, acompanha timeline e comenta.                                                                                                      |
| TI          | Vê chamados e fila, assume novos, registra atendimento rápido, comenta. Responsável principal gerencia status, apoios e transferência. Apoios não recebem permissão de responsável principal. |
| ADMIN       | Administra pessoas e senhas; tem acesso operacional completo para dar suporte e recuperar chamados de técnicos inativos.                                                                      |
| GESTOR      | Autenticação e área reservada com indicação da próxima etapa. Sem indicadores inventados ou acesso à fila.                                                                                    |

Fluxo: **NOVO → EM_ATENDIMENTO → AGUARDANDO → EM_ATENDIMENTO → RESOLVIDO**. Também é possível resolver diretamente de EM_ATENDIMENTO ou AGUARDANDO. Espera requer motivo; OUTRO exige detalhes. Reabertura está prevista no enum de auditoria, mas não é oferecida na V1.

Atendimento rápido: busque uma pessoa ativa, selecione, descreva e inicie. Impacto BAIXO vem selecionado e pode ser alterado. Solicitante, setor, técnico, origem e timestamps são persistidos automaticamente.

Somente o ADMIN cria/edita usuários. A V1 utiliza exclusivamente desativação, mesmo para usuários sem histórico. Chamados antigos mantêm referências válidas. Alterações cadastrais encerram sessões existentes para aplicar permissões imediatamente. ADMIN não pode desativar ou rebaixar a própria conta. Outro ADMIN pode transferir atendimentos de técnicos desativados.

## Modelo de dados

- **User**: nome, username único normalizado, hash de senha, setor, perfil, estado, troca obrigatória e timestamps.
- **Department**: cadastro próprio, nome único e estado; preparado para administração futura.
- **Session**: hash do token, usuário, criação e expiração absoluta de 8 horas.
- **LoginThrottle**: contador persistente por username; máximo de 10 tentativas por janela de 15 minutos. Entrar com sucesso limpa o contador.
- **Ticket**: número sequencial, descrição, impacto, solicitante, setor na abertura, responsável principal, status, origem, motivo/detalhe de espera, criação/início/resolução.
- **TicketParticipant**: relação normalizada de apoios, com unicidade por chamado/técnico.
- **TicketEvent**: ator, técnico de destino, tipo, status anterior/novo, motivo, nota, metadata auxiliar, timestamp e sequência de ordenação.
- **TicketComment**: autor, conteúdo, chamado e horário.
- **UserAudit**: criação/alterações administrativas e mudanças de senha sem registrar senhas ou hashes nos metadados.

FKs restritivas protegem o histórico. Índices cobrem fila, solicitante, responsável, setor, eventos e sessões. CHECK constraints garantem coerência entre status, responsável, início, resolução e motivo de espera. A atribuição usa UPDATE condicional e as outras mudanças usam lock de linha; eventos e mudança de estado pertencem à mesma transação.

## Segurança

- Argon2id: 64 MiB, 3 iterações, paralelismo 1. Senhas entre 12 e 128 caracteres.
- Tokens de sessão aleatórios de 256 bits; somente SHA-256 persiste. Cookies HttpOnly/SameSite=Lax e Secure em HTTPS.
- Validação Zod e autorização no servidor por operação. Usuário/role da sessão são consultados no banco, nunca confiados ao formulário.
- Server Actions com validação explícita de Origin contra APP_URL, além da proteção nativa do Next.js.
- Sem operações destrutivas via GET, sem signup, sem exclusão de histórico e sem stack traces nas mensagens ao usuário.
- Cabeçalhos de proteção contra iframe/sniffing e CSP básica. A CSP ainda permite scripts inline necessários ao Next; endurecimento com nonce pode ser avaliado antes de uma publicação na internet.
- Não registrar segredos nem cachear dados privados. O limite atual de login é por conta; proteção volumétrica e limitação por IP devem ser configuradas na borda quando houver publicação externa.

## Testes e verificações

Com Docker/PostgreSQL ativo:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Os testes criam um **banco temporário exclusivo** no mesmo PostgreSQL, aplicam todas as migrations e o removem ao terminar. Não alteram os dados reais. O usuário de conexão precisa de permissão CREATEDB; o usuário local do Compose possui essa permissão. Em caso de interrupção abrupta, pode sobrar um banco `central_test_*` para remoção manual após confirmar que nenhum teste o utiliza.

`npm test`: autenticação, senha incorreta, usuário inativo, sessão expirada/revogada, troca obrigatória, IDOR, permissões administrativas, criação/normalização de usuários, claim concorrente, status, espera/retomada, apoio, transferência, comentário, atendimento rápido, preservação de histórico e limitação de login.

`npm run test:e2e`: inicia build de produção na porta 3100, executa o cenário real pelo navegador (desktop e viewport mobile), valida área administrativa, GESTOR, timeline, manifest, ícones, cabeçalhos e rejeição de POST de outra origem. Também executa axe para regras WCAG A/AA nas telas de login, administração, funcionário, detalhe resolvido e atendimento rápido. Usa Chrome local quando encontrado. Caso contrário, instale apenas o navegador de teste com `npx playwright install chromium`. Screenshots e traces de falhas ficam em `test-results/`.

Validação da entrega: **20 testes de integração e 2 testes E2E aprovados**, lint sem avisos, TypeScript sem erros, build de produção aprovado e auditoria npm sem vulnerabilidades conhecidas. As verificações automáticas de acessibilidade não substituem uma avaliação manual completa com tecnologias assistivas.

`npm audit` verifica dependências. Overrides de deepmerge-ts 8.0.2 e mysql2 3.24.4 corrigem avisos transitivos do Prisma CLI, validados com generate/migrations/testes/build.

## PWA

Manifest em `/manifest.webmanifest`, ícones PNG 192/512 e maskable, display standalone, tema e background locais. O service worker apenas prepara instalação e não intercepta/cacheia páginas privadas. Sem push ou operação offline. A opção de instalar depende do navegador, HTTPS (ou localhost) e critérios próprios da plataforma. No iOS, utilize “Adicionar à Tela de Início”.

## Estrutura

```text
src/app/                 Rotas, layouts, Server Actions, estilos e manifest
  (private)/             Início, chamados, atendimento rápido, admin e gestor
  login/                 Login fechado
  alterar-senha/         Troca obrigatória ou voluntária
src/lib/auth-service.ts  Hash, login, sessões, expiração e senha
src/lib/auth.ts          Proteção das páginas/actions
src/lib/services.ts      Regras, permissões, transações e auditoria
src/lib/validation.ts    Schemas de entrada
src/components/         Formulários acessíveis e componentes visuais
prisma/                  Schema, migrations e bootstrap
scripts/                 Configuração segura e execução isolada de testes
tests/                   Integração real com PostgreSQL e E2E Playwright
public/                  Ícones e service worker sem cache privado
AGENTS.md                Regras para manutenção por futuros agentes
```

Decisões: componentes locais pequenos em vez de uma dependência completa de UI; fontes do sistema sem requests externos; datas UTC com exibição em America/Sao_Paulo; paginação de chamados de 20 em 20. Dev/build usam Webpack, opção estável do Next.js 16, porque o Turbopack não conseguiu abrir uma porta interna de processamento de CSS no ambiente restrito de desenvolvimento. A busca de pessoas carrega a lista ativa no servidor nesta V1; busca paginada no banco pode ser adotada se o cadastro crescer muito. Não há atualização em tempo real: a página é atualizada após ações próprias; para ver alterações de outro usuário, recarregue.
