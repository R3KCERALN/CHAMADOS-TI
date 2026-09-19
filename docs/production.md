# Produção em VPS Linux

## Arquitetura e pré-requisitos

Uma instalação, uma Organization, um processo Next.js persistente (inclui worker Web Push), PostgreSQL 17 e Caddy. `compose.production.yaml` é independente do Compose de desenvolvimento: projeto/volumes próprios, sem banco/porta compartilhados com demo. Não há deploy externo automático.

VPS Linux com Docker Engine e Compose **2.24.4+**, DNS A/AAAA correto e portas TCP 80/443 abertas; UDP 443 é opcional para HTTP/3. Reserve inicialmente 2 vCPU/4 GB RAM e espaço para banco, imagens e backups; ajuste com medição. Compilar na VPS demanda memória adicional. Restrinja SSH no firewall; não exponha Docker, PostgreSQL ou a porta 3000. Mantenha Docker habilitado no boot (`sudo systemctl enable --now docker`).

Somente Caddy publica portas. HTTPS/certificados são automáticos; volumes `caddy_data`/`caddy_config` preservam seu estado. O app roda como usuário não root, filesystem somente leitura, cache temporário, sem capabilities. Rede do banco é interna; app conserva saída para os serviços Web Push dos navegadores. Não colocar outro proxy na frente sem revisar origem/IP confiável.

Imagens usam `npm ci` e build multi-stage. `BUILD_STANDALONE=true` só no build Docker mantém `npm run start` local compatível. `runner` contém somente standalone, assets e runtime; `operations` inclui ferramentas de migration/bootstrap e não é um serviço permanente. Não há secrets no build. `NODE_IMAGE`, `POSTGRES_IMAGE` e `CADDY_IMAGE` já vêm fixados por **digest testado**, além do tag legível; atualize patches deliberadamente. Guarde a imagem de cada release: reconstruir tags móveis não reproduz os mesmos bytes.

## Configuração e primeiro deploy

1. Copie o checkout da versão aprovada para a VPS. Preserve o histórico de migrations.
2. `cp .env.production.example .env.production && chmod 600 .env.production`.
3. Preencha **todos os campos vazios**, exceto `BACKUP_COPY_HOOK`. Use valores simples sem aspas para `COMPOSE_PROJECT_NAME`, retenção e hook. O nome do projeto deve ser `central-suporte-prod` ou começar com `central-suporte-prod-`; nunca alterá-lo numa atualização normal.
4. `APP_DOMAIN` é somente o hostname definitivo, sem esquema/caminho. `APP_URL=https://<mesmo-hostname>`. `ACME_EMAIL` é contato operacional real. Mantenha `APP_ORGANIZATION_ID=initial-organization` na instalação inicial; a migration cria essa organização. Não trocar esse ID para renomear a organização.
5. Gere senhas independentes e aleatórias (por exemplo, `openssl rand -hex 32`) para `POSTGRES_PASSWORD` e `APP_DB_PASSWORD`. O app recebe somente a segunda. `DATABASE_URL` é construída no container com encoding; não duplicar senhas numa URL. O usuário de migrations é dono do schema; `central_app` não pode criar banco/roles/tabelas nem editar o controle de migrations.
6. Defina credenciais temporárias do ADMIN e nome da organização. Não existem credenciais padrão. O bootstrap mantém a organização histórica já criada e não renomeia dados existentes.
7. Gere o par VAPID uma única vez: com dependências locais instaladas, `npm run push:keys -- .env.production mailto:CONTATO_REAL`. As três variáveis precisam estar vazias antes do comando. Preserve as chaves entre releases e no plano de recuperação; mudar o par exige novas subscriptions.
8. Defina `RELEASE` com identificador imutável da versão (ex.: hash do commit aprovado). Execute `./ops/deploy.sh`. O script valida Compose, constrói imagens, aguarda o banco, executa migrations e só inicia app/proxy após sucesso. Não executa seed.
9. Crie exclusivamente o administrador/cadastros básicos:

```bash
docker compose --env-file .env.production -f compose.production.yaml run --rm migrate node ops/database.mjs bootstrap
```

10. Abra a origem HTTPS, troque a senha obrigatória e configure filiais/usuários. Remova `INITIAL_ADMIN_PASSWORD` do arquivo após o bootstrap e remova o container finalizado de migrations (`docker compose --env-file .env.production -f compose.production.yaml rm -f migrate`), pois seu ambiente pode conservar a senha temporária. O próximo deploy recria esse serviço.

`APP_ENV=production`, cookies Secure e worker ativo são fixados pelo Compose. O startup rejeita URL não HTTPS, origem divergente, configurações ausentes, timezone inválido, banco demo/teste e VAPID incompleto/incompatível. Os builds locais continuam usando `.env`/HTTP localhost sem selecionar `APP_ENV=production`.

Nunca executar `demo:setup`, seed fictício, migrate reset ou `down -v` nesta instalação. Não copiar `.env`/`.env.demo` para produção. Alterar senhas no arquivo não muda automaticamente a senha do dono de um volume PostgreSQL já inicializado; faça rotação coordenada no banco. A senha do papel da aplicação é reaplicada pela operação de migrations.

## Atualização e rollback

Antes de atualizar: execute backup, confirme seu armazenamento e compatibilidade das migrations com a versão antiga. Preserve `.env.production`, projeto, volumes e VAPID. Atualize checkout sem apagar migrations, escolha um novo `RELEASE`, execute `./ops/deploy.sh` e valide login/chamado/health. Migrations incompatíveis exigem janela de manutenção: pare app/proxy antes de aplicá-las. Nunca inicie duas versões com migrations incompatíveis no mesmo banco.

Migrations isoladas (aplicação deve ser compatível ou estar parada):

```bash
docker compose --env-file .env.production -f compose.production.yaml run --rm migrate node ops/database.mjs migrate
```

Rollback **somente da aplicação**: após verificar compatibilidade do schema, volte `RELEASE` à imagem anterior ainda guardada e execute:

```bash
docker compose --env-file .env.production -f compose.production.yaml up -d --no-deps --no-build --wait app
```

Não execute deploy/build nem migrations do checkout antigo como rollback. Não desfaça migrations por SQL destrutivo. Se a versão anterior não suporta o schema atual, prefira correção adiante; recuperação do banco é uma operação separada, com perda potencial de dados posteriores ao backup e janela de manutenção explícita. Guarde as imagens com `docker image save` ou registro privado futuro; não faça prune indiscriminado.

## Operação e diagnóstico

Todos os comandos abaixo usam explicitamente produção:

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail=100 app proxy db
docker compose --env-file .env.production -f compose.production.yaml restart app
docker compose --env-file .env.production -f compose.production.yaml exec -T app node ops/healthcheck.mjs
```

`GET /api/health`: 200 `{"status":"ok"}` quando o banco responde; 503 `{"status":"unavailable"}` caso contrário. Não revela configuração/versões/contagens e não é cacheável. O healthcheck não atesta entrega de push nem disponibilidade da internet. `runtime_configuration_invalid` encerra o processo quando a configuração de produção é inválida (verifique env/HTTPS/cookies/timezone/VAPID). `push_worker_started` confirma o início do worker. Conexões SQL têm timeout de 3 s e consultas em produção, 30 s; reveja este orçamento com volumes reais. `health_database_unavailable`, `database_migrate_failed`, `push_worker_failed` e `push_delivery_failed` identificam falhas sem payload/token. Logs Docker rotacionam em 3 arquivos de 10 MB por serviço. Caddy não gera access logs com URLs/cookies. Não publique `docker inspect`/`compose config` completo: ambientes contêm secrets.

Containers permanentes têm `restart: unless-stopped`: após reboot voltam automaticamente se não foram parados explicitamente. Healthcheck marca falha, mas Docker **não reinicia automaticamente um processo apenas por unhealthy**; investigue logs e reinicie após resolver a causa. O worker retoma leases expirados. Após parada manual, use `docker compose --env-file .env.production -f compose.production.yaml up -d --wait`. Não há necessidade de seed/migration a cada reboot.

## Backup

```bash
./ops/backup.sh
```

Arquivo `backups/<projeto>/central_<UTC>_<pid>.dump`: formato custom do pg_dump, comprimido, consistente mesmo com app ativo, sem owners/grants. Pasta 0700, arquivos 0600; escrita `.partial` só vira backup após dump/listagem válidos. `BACKUP_RETENTION_DAYS` (padrão 14) remove somente arquivos com esse padrão mais antigos após sucesso. Com `BACKUP_COPY_HOOK=/caminho/absoluto/executavel`, o hook recebe o arquivo final como único argumento; erro impede retenção e retorna falha. O hook futuro pode copiar para armazenamento externo com credenciais próprias, sem incluí-las no script/repositório. Não há cópia externa implementada/contratada nesta entrega.

Agende na VPS, por exemplo no crontab do operador Docker, ajustando o diretório real:

```cron
15 2 * * * cd /opt/central-suporte && ./ops/backup.sh >> /var/log/central-suporte-backup.log 2>&1
```

Configure também rotação desse log e alerta operacional de falha. Backup no mesmo disco não protege contra perda da VPS: antes de uso real, defina cópia externa criptografada, retenção e ensaio periódico de restore. Backups contêm dados pessoais, hashes e subscriptions; restrinja acesso. Preserve `.env.production`/VAPID separadamente em cofre/backup seguro e o volume Caddy quando necessário; o dump contém apenas o banco. RPO depende da frequência dos backups, sem recuperação ponto a ponto/WAL nesta etapa.

## Restore protegido e promoção

Aceite somente backups confiáveis: dump pode conter SQL executável. **O script nunca sobrescreve banco existente.** Exige nome novo `central_restore_*` e confirmação contendo projeto+banco:

```bash
./ops/restore.sh backups/central-suporte-prod/ARQUIVO.dump central_restore_20260919 RESTORE:central-suporte-prod:central_restore_20260919
```

O arquivo é validado, `createdb` recusa alvo existente e restore usa transação única/exit-on-error. Falha pode deixar um banco novo vazio para inspeção; não há exclusão automática. Negócio/histórico são restaurados; sessões são removidas, subscriptions desativadas e entregas PENDING canceladas para não ressuscitar logins/notificações antigas. Os usuários terão que entrar e ativar notificações novamente.

Valide contagens/histórico e versão das migrations no banco novo antes de promover. Para ensaio, mantenha-o isolado: **não altere POSTGRES_DB nem pare a aplicação**. Conceda acesso apenas quando decidir promover. Para recuperação real:

1. Pare app/proxy; confirme janela e perda de dados após o backup.
2. Preserve cópia segura da configuração anterior. Troque somente `POSTGRES_DB` para o novo nome, mantendo projeto/volume/usuários.
3. Recrie serviço db para atualizar seu ambiente, sem recriar volume: `docker compose --env-file .env.production -f compose.production.yaml up -d --wait db`.
4. Use imagem compatível com o backup e execute `run --rm migrate node ops/database.mjs grant` para restaurar grants; migrations adicionais somente após revisão/backup.
5. `docker compose --env-file .env.production -f compose.production.yaml up -d --no-deps --wait app proxy`.
6. Verifique health/login/chamados; mantenha o banco antigo preservado até aprovação operacional. Nunca promova um ensaio por engano.

`PRODUCTION_ENV_FILE=/caminho/arquivo` e `BACKUP_DIR=/caminho/pasta` permitem ambiente de ensaio explicitamente separado. Scripts exigem nome de projeto de produção e não carregam env como código shell.

## Segurança e limites

Autorização/isolamento por Organization, Argon2id, sessão de 8h, CSRF/Origin e política intencional de senha de 6–128 caracteres são preservados. Login mantém 10 tentativas por conta/15 min e em produção acrescenta 100 tentativas/IP/15 min, persistidas como hash. Caddy sobrescreve X-Client-IP; app nunca deve ter porta pública. Limite por IP considera NAT corporativo e não substitui proteção contra ataque volumétrico. HTTPS/HSTS (sem preload/subdomínios), CSP, anti-iframe e nosniff permanecem; CSP ainda permite inline requerido pela configuração Next atual.

Worker Web Push continua no Node persistente, pós-commit com outbox, retries e revalidação de permissões. O servidor precisa de saída HTTPS aos endpoints permitidos dos navegadores. Não mudar VAPID ao atualizar; não habilitar cache de páginas privadas no proxy/SW. Entrega real em iOS/PWA, certificado público, DNS, firewall, capacidade e recuperação após reboot da VPS precisam de validação no destino. A validação local HTTPS usa certificado interno, sem contratar serviços nem instalar confiança global na máquina.

Referências: [Next standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [ordem de startup Compose](https://docs.docker.com/compose/how-tos/startup-order/), [proxy Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).

## Validação local reproduzível

Foi exercitado um projeto exclusivo `central-suporte-prod-validation`, banco `central_production_validation`, `.env.production-test` ignorado e HTTPS `localhost:3443` com Caddy/CA interna. O override de Compose substitui as portas do proxy por `127.0.0.1:3443:3443`; não altera o Compose de produção. Não importar a CA no sistema. O workflow de navegador existente pode ser reaplicado a uma instalação de validação **nova**, após migrations/bootstrap, com:

```bash
node --env-file=.env.production-test node_modules/@playwright/test/cli.js test --config=tests/production-browser.config.ts
```

A configuração de teste recusa outros hostnames, bancos e projetos; cria dados exclusivamente para validação. Não apontá-la à produção real. Após o ensaio, pare os serviços desse projeto, preservando ou removendo apenas seus volumes mediante decisão explícita. Testes de unidade/integração e E2E usuais continuam separados via `npm test`/`npm run test:e2e`.
