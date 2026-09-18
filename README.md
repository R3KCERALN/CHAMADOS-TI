# Central de Suporte

V1.2 funcional de uma central interna de atendimento de TI, com operação, gestão e indicadores auditáveis. Monólito full-stack local: Next.js 16.3.5, React 19.3, TypeScript strict, Tailwind CSS 4, PostgreSQL 17 e Prisma 7.10. Sem autenticação externa, serviços pagos ou APIs de IA.

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

No primeiro login, crie uma senha pessoal de pelo menos 6 caracteres e entre novamente. Acesse **Usuários → Criar usuário** para cadastrar um funcionário e dois técnicos de TI. Compartilhe cada senha temporária diretamente com a pessoa. Todos devem trocar a senha no primeiro acesso. Não há contas públicas ou senhas de demonstração fixas.

O bootstrap cria o ADMIN, os setores TI, Financeiro, RH, Comercial, Administrativo e Gerência e dez categorias técnicas iniciais. Esses nomes não fazem parte das regras de permissão. Categorias são administradas em **Categorias** e nunca são exigidas do funcionário.

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
| ADMIN       | Administra pessoas, senhas e categorias; acesso operacional completo e indicadores gerenciais.                                                                                                |
| GESTOR      | Panorama gerencial, equipe, detalhes e CSV. Sem acesso à fila ou ao detalhe operacional de chamados.                                                                                          |

Fluxo: **NOVO → EM_ATENDIMENTO → AGUARDANDO → EM_ATENDIMENTO → RESOLVIDO**. Também é possível resolver diretamente de EM_ATENDIMENTO ou AGUARDANDO. Espera requer motivo; OUTRO exige detalhes. Reabertura está prevista no enum de auditoria, mas não é oferecida na V1.

Atendimento rápido: escolha uma pessoa cadastrada ou informe somente o nome de quem pediu. Selecione a filial; unidade é opcional e só aparece quando aplicável. Descreva e inicie. Pessoas cadastradas preenchem a localização principal automaticamente, com alteração permitida pelo TI. O modo textual não cria conta nem inventa setor. Impacto BAIXO vem selecionado e pode ser alterado.

Somente o ADMIN cria/edita usuários. A V1 utiliza exclusivamente desativação, mesmo para usuários sem histórico. Chamados antigos mantêm referências válidas. Alterações cadastrais encerram sessões existentes para aplicar permissões imediatamente. ADMIN não pode desativar ou rebaixar a própria conta. Outro ADMIN pode transferir atendimentos de técnicos desativados.

## Atualizar uma instalação existente

Preserve o `.env`, o volume e todas as migrations anteriores. Com a aplicação parada:

```bash
npm ci
docker compose up -d --wait
npm run db:generate
npm run db:migrate
npm run db:seed
npm run build
npm run start
```

A migration **202609180004_management** adicionou gestão. A nova migration incremental **202609190001_organization_locations** cria Organization, Company, Unit, permissões adicionais, identidade do solicitante e índices/constraints de isolamento. Não recria tabelas existentes nem remove dados. Todos os dados anteriores são associados à organização inicial. Nenhuma filial real é inventada: usuários e chamados antigos permanecem sem Company até configuração/correção explícita. Antes de novas aberturas, cadastre filiais reais e associe os funcionários. Os históricos continuam acessíveis. O seed é idempotente e não muda senhas existentes. **Nunca execute `prisma migrate reset` no banco de aplicação.**

## Gestão e operação na V1.2

- **Gestão — `/gestor`**: volumes de abertura/resolução, posição atual do backlog, média/mediana e amostra dos tempos, evolução, demanda por setor/categoria/complexidade, espera por motivo e dez pendências mais antigas.
- **Equipe de TI — `/gestor/equipe`**: lista alfabética paginada, responsabilidade principal, resolução final, apoio histórico, carteira atual, complexidade e tempos de ciclo. Clique no nome para as distribuições e chamados do técnico.
- **Filiais — `/admin/filiais`**: organização atual, CNPJ validado localmente, criação, edição e ativação/desativação.
- **Unidades — `/admin/unidades`**: subdivisões físicas opcionais, com filtro por filial.
- **Gestão de filiais — `/gestor/filiais`**: comparação por volume, resoluções, backlog, tempos e categoria frequente; detalhe com navegação por unidade/categoria até os chamados.
- **Categorias — `/admin/categorias`**: criar, renomear, ativar e desativar. Categorias inativas permanecem em históricos e relatórios.
- **Chamado — `/chamados/[id]`**: TI/ADMIN classificam categoria e complexidade; cada alteração gera evento. Funcionários continuam abrindo apenas com descrição e impacto.
- **Fila — `/chamados`**: filtros todos/novos/meus/aguardando, categoria, setor, impacto e complexidade; busca por número, solicitante e descrição no servidor.
- **Início do TI**: novos na fila, meus em atendimento, meus aguardando, resolvidos hoje e apoios atuais. Atendimento rápido continua destacado no celular.

Filtros gerenciais combináveis: filial e unidade dependente, Hoje, Últimos 7 dias, Últimos 30 dias, Este mês, Mês anterior ou datas personalizadas, setor, técnico, categoria, complexidade e status. URLs conservam filtros e paginação. CSV em **Exportar CSV** usa os mesmos filtros, UTF-8/BOM, `;`, datas UTC e durações em segundos, com proteção contra fórmulas.

**Leia [docs/metrics.md](docs/metrics.md) para as definições exatas.** Aberturas usam `createdAt`; resoluções usam `resolvedAt`; backlog é sempre atual e não é limitado pelo período. A primeira resposta é o primeiro evento ASSUMIDO. Tempo ativo de ciclo soma intervalos EM_ATENDIMENTO, excluindo NOVO e AGUARDANDO; não é hora trabalhada. Apoios e participações principais são distintos; só o responsável final recebe uma resolução. Ciclos sem histórico suficiente não recebem tempos inventados.

`APP_TIMEZONE` centraliza exibição e períodos, padrão **America/Belem**. Configure outro fuso IANA no `.env` e reinicie o servidor, se necessário. O banco mantém UTC.

### Política de senha

Todos os caminhos (criação, redefinição, primeiro login e alteração voluntária) aceitam **6–128 caracteres**, inclusive `123456`, `456789`, `allan01` e `senha123`. Não há restrição a números nem exigência de composição. Argon2id, limitação de login, troca obrigatória e revogação de sessões permanecem ativos. Esses exemplos ilustram o formato; não são contas ou senhas cadastradas pelo projeto.

### Demonstração separada, opcional

Para visualizar os indicadores com 60 chamados fictícios em diferentes períodos, categorias, complexidades, esperas, apoios e quatro técnicos (um inativo):

```bash
npm run demo:setup
npm run build
npm run demo:start
```

Abra **http://localhost:3002**. O comando cria **somente `central_suporte_demo`**, separado do banco real, e `.env.demo` ignorado pelo Git. Pode coexistir com a aplicação na porta 3000. O setup atualiza a demonstração existente sem redefinir senhas: quatro filiais, duas sem unidades e duas com duas unidades cada; seis atendimentos rápidos adicionais incluem pessoas sem conta. CNPJs são sintéticos com verificadores válidos, sem consultas externas. Não use esse seed em produção. As proteções exigem banco com sufixo `_demo` e `SEED_DEMO=true`.

- ADMIN: `demo.admin`; senha inicial em `INITIAL_ADMIN_PASSWORD` de `.env.demo`.
- GESTOR: `demo.gestor`.
- TI: `demo.carlos`, `demo.luiza`, `demo.giovanni`; `demo.inativo` não pode entrar.
- Funcionários: `demo.ana`, `demo.pedro`, `demo.julia`.
- As contas não administrativas usam a senha aleatória `DEMO_PASSWORD` de `.env.demo`. Todos os usuários ativos precisam trocar a senha no primeiro login. O seed não redefine senhas ao ser executado novamente.

## Modelo de dados

- **Organization**: grupo/cliente da instalação, estado e timestamps.
- **Company**: CNPJ/pessoa jurídica, chamada Filial, com nome de exibição, razão social opcional, estado e timestamps.
- **Unit**: subdivisão física opcional da Company, nome, código e estado.
- **UserCompanyAccess / UserUnitAccess**: permissões adicionais normalizadas.
- **User**: organização, Company principal, Unit opcional, nome, username único normalizado, hash de senha, setor, perfil, estado, troca obrigatória e timestamps.
- **Department**: cadastro próprio, nome único e estado; preparado para administração futura.
- **Session**: hash do token, usuário, criação e expiração absoluta de 8 horas.
- **LoginThrottle**: contador persistente por username; máximo de 10 tentativas por janela de 15 minutos. Entrar com sucesso limpa o contador.
- **Category**: nome único (também normalizado no banco), ativa/inativa e data de criação; referências históricas restritivas.
- **Ticket**: organização, Company, Unit opcional, registrador, solicitante User opcional e snapshot do nome; categoria e complexidade opcionais, número sequencial, descrição, impacto, solicitante, setor na abertura, responsável principal, status, origem, motivo/detalhe de espera, criação/início/resolução.
- **TicketParticipant**: relação normalizada de apoios, com unicidade por chamado/técnico.
- **TicketEvent**: ator, técnico de destino, tipo, status anterior/novo, categoria/complexidade anterior/nova, motivo, nota, metadata auxiliar, timestamp e sequência de ordenação.
- **TicketComment**: autor, conteúdo, chamado e horário.
- **UserAudit**: criação/alterações administrativas e mudanças de senha sem registrar senhas ou hashes nos metadados.

FKs restritivas protegem o histórico. Índices cobrem fila, solicitante, responsável, setor, eventos e sessões. CHECK constraints garantem coerência entre status, responsável, início, resolução e motivo de espera. A atribuição usa UPDATE condicional e as outras mudanças usam lock de linha; eventos e mudança de estado pertencem à mesma transação.

## Segurança

- Argon2id: 64 MiB, 3 iterações, paralelismo 1. Senhas entre 6 e 128 caracteres.
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
npm audit
```

Os testes criam um **banco temporário exclusivo** no mesmo PostgreSQL, aplicam todas as migrations e o removem ao terminar. Não alteram os dados reais. O usuário de conexão precisa de permissão CREATEDB; o usuário local do Compose possui essa permissão. Em caso de interrupção abrupta, pode sobrar um banco `central_test_*` para remoção manual após confirmar que nenhum teste o utiliza.

`npm test`: autenticação, senha incorreta, usuário inativo, sessão expirada/revogada, troca obrigatória, IDOR, permissões administrativas, criação/normalização de usuários, claim concorrente, status, espera/retomada, apoio, transferência, comentário, atendimento rápido, preservação de histórico e limitação de login. A suíte gerencial cobre senhas/PINs, categorias, complexidade, permissões, transferências, apoios, esperas múltiplas, coortes, filtros, mediana, timezone, CSV e paginação.

`npm run test:e2e`: inicia build de produção na porta 3100, executa o cenário real pelo navegador (desktop e viewport mobile), valida área administrativa, GESTOR, timeline, manifest, ícones, cabeçalhos e rejeição de POST de outra origem. Também executa axe para regras WCAG A/AA nas telas de login, administração, funcionário, detalhe resolvido e atendimento rápido, panorama, equipe e detalhes gerenciais. Valida classificação técnica, filtros e CSV no navegador. Usa Chrome local quando encontrado. Caso contrário, instale apenas o navegador de teste com `npx playwright install chromium`. Screenshots e traces de falhas ficam em `test-results/`.

Validação da entrega: **65 testes de integração e 2 testes E2E aprovados**, lint sem avisos, TypeScript sem erros, build de produção aprovado e auditoria npm sem vulnerabilidades conhecidas. As verificações automáticas de acessibilidade não substituem uma avaliação manual completa com tecnologias assistivas.

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
src/lib/access.ts        Ator autenticado e organização ativa
src/lib/organization-service.ts  Filiais, unidades e permissões de localização
src/lib/cnpj.ts          Normalização e validação local de CNPJ
src/lib/analytics-*.ts   Consultas parametrizadas e agregações PostgreSQL
src/lib/period.ts        Datas civis e filtros de período
src/lib/config.ts        Configuração central de timezone
src/lib/csv.ts           Serialização segura da exportação
docs/metrics.md          Contrato e limitações dos indicadores
docs/organization-model.md  Modelo organizacional, identidade e migração
src/components/         Formulários acessíveis e componentes visuais
prisma/                  Schema, migrations e bootstrap
scripts/                 Configuração segura e execução isolada de testes
tests/                   Integração real com PostgreSQL e E2E Playwright
public/                  Ícones e service worker sem cache privado
AGENTS.md                Regras para manutenção por futuros agentes
```

Decisões: componentes locais pequenos em vez de uma dependência completa de UI; fontes do sistema sem requests externos; datas UTC com exibição no APP_TIMEZONE; paginação de chamados, equipe e comentários em 20 e eventos em 30 registros. Gráficos SVG/CSS com tabela acessível, sem biblioteca adicional. Dev/build usam Webpack, opção estável do Next.js 16, porque o Turbopack não conseguiu abrir uma porta interna de processamento de CSS no ambiente restrito de desenvolvimento. A busca de pessoas acontece no servidor, limitada a 15 resultados por consulta e ao escopo da organização. Refine nome/setor para localizar uma pessoa. Não há atualização em tempo real: a página é atualizada após ações próprias; para ver alterações de outro usuário, recarregue.

## Limitações deliberadas

Não há ranking, score, horas individuais, percentual de utilização, SLA, custo, jornada ou indicação automática de sobrecarga: faltam dados confiáveis para calculá-los. O backlog, as esperas e a complexidade dão contexto para análise humana. Classificações/status são os atuais, mesmo quando o período é passado; não há reconstrução histórica desses filtros. GESTOR consulta dados gerenciais e exporta, mas o detalhe operacional permanece reservado ao TI/ADMIN e ao solicitante autorizado.

Exportações usam snapshot consistente e lotes de 500, com timeout de dois minutos; intervalos grandes podem exigir uma seleção menor. A disponibilidade de métricas depende dos eventos preservados. O sistema continua sem push, notificações externas, reabertura ou atualização em tempo real.

## Organização e solicitantes

Veja [docs/organization-model.md](docs/organization-model.md) para o contrato completo. A estrutura é **Organization → Company → Unit opcional**. A instalação tem uma única organização, definida pelo servidor em `APP_ORGANIZATION_ID` (padrão `initial-organization`), sem escolha de tenant no login. O login agora contém somente o formulário central com usuário, senha e Entrar.

No cadastro de funcionário, informe a filial principal; setor permanece obrigatório e unidade é opcional. Companies adicionais e restrições de Units ficam em uma seção expansível. TI atende todas as filiais da organização. Com uma única Company autorizada, o funcionário não recebe seletor na abertura.

`openedByUserId` identifica quem registrou. `requesterId` mantém a relação opcional com o solicitante cadastrado, e `requesterName` preserva o nome no momento da abertura. Sem conta, basta informar um nome no Atendimento Rápido e escolher filial. Busca, histórico, métricas e CSV incluem esses chamados normalmente.

CSV inclui filial/CNPJ/unidade, registrador, solicitante cadastrado, nome manual e a identificação amigável preservada. Todos os filtros e consultas são limitados à organização autenticada, e o banco rejeita relacionamentos entre organizações. Os testes também aplicam a migration sobre registros no formato V1 para verificar preservação.

Decisões explícitas: usernames e números de chamados continuam globalmente únicos; `requesterId` mantém seu nome anterior e equivale a requesterUserId. A Company de uma Unit é imutável após sua criação para preservar a localização histórica. Campos Company e openedBy podem ser nulos em registros legados sem informação confiável; novas aberturas exigem ambos. Não foi implementado SaaS comercial, troca de organização, notificações ou push.
