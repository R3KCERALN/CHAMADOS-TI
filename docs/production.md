# Produção em VPS Linux

## Arquitetura e pré-requisitos

Uma instalação, uma Organization, um processo Next.js persistente (inclui worker Web Push), PostgreSQL 17 e Caddy. `compose.production.yaml` é independente do Compose de desenvolvimento: projeto/volumes próprios, sem banco/porta compartilhados com demo. Não há deploy externo automático.

VPS Linux com Docker Engine, Compose **2.24.4+** e OpenSSL, DNS A/AAAA correto e portas TCP 80/443 abertas; UDP 443 é opcional para HTTP/3. Reserve inicialmente 2 vCPU/4 GB RAM e espaço para banco, imagens e backups; ajuste com medição. Compilar na VPS demanda memória adicional. Restrinja SSH no firewall; não exponha Docker, PostgreSQL ou a porta 3000. Mantenha Docker habilitado no boot (`sudo systemctl enable --now docker`).

Somente Caddy publica portas. HTTPS/certificados são automáticos; volumes `caddy_data`/`caddy_config` preservam seu estado. O app roda como usuário não root, filesystem somente leitura, cache temporário, sem capabilities. Rede do banco é interna; app conserva saída para os serviços Web Push dos navegadores. Não colocar outro proxy na frente sem revisar origem/IP confiável.

Imagens usam `npm ci` e build multi-stage. `BUILD_STANDALONE=true` só no build Docker mantém `npm run start` local compatível. `runner` contém somente standalone, assets e runtime; `operations` inclui ferramentas de migration/bootstrap e não é um serviço permanente. Não há secrets no build. `NODE_IMAGE`, `POSTGRES_IMAGE` e `CADDY_IMAGE` já vêm fixados por **digest testado**, além do tag legível; atualize patches deliberadamente. Guarde a imagem de cada release: reconstruir tags móveis não reproduz os mesmos bytes.

## Configuração e primeiro deploy

1. Copie o checkout da versão aprovada para a VPS. Preserve o histórico de migrations.
2. `cp .env.production.example .env.production && chmod 600 .env.production`.
3. Preencha os campos de aplicação, banco, organização, ADMIN e VAPID. Configure os campos `BACKUP_*` conforme a seção Backup antes do uso oficial; os dois campos de decriptação ficam vazios até um ensaio/restore. Use valores sem aspas. O nome do projeto deve ser `central-suporte-prod` ou começar com `central-suporte-prod-`; nunca alterá-lo numa atualização normal.
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

Arquivo `backups/<projeto>/central_<UTC>_<pid>.dump`: formato custom do pg_dump, comprimido, consistente mesmo com app ativo, sem owners/grants. Pasta 0700, arquivos 0600; escrita `.partial` só vira backup após dump/listagem válidos. `BACKUP_RETENTION_DAYS` (padrão 14) remove somente arquivos com esse padrão mais antigos **depois** do dump e da cópia externa terem sucesso. Uma falha conserva o backup local e retorna código diferente de zero.

### Cópia externa criptografada

`ops/copy-backup-encrypted.sh` cifra cada dump com CMS/AES-256 e depois assina o conteúdo cifrado com uma identidade RSA separada. O resultado continua sendo um único `.cms`: o restore verifica a assinatura fixada **antes** de descriptografar. A chave privada de decriptação não é necessária para o backup e deve ficar fora da VPS quando não houver ensaio/recuperação. A chave privada de assinatura fica somente no produtor do backup, com modo 0600; o certificado público correspondente deve fazer parte do kit de recuperação e não pode ser obtido do mesmo armazenamento não confiável no momento do restore.

Gere pares exclusivos fora do repositório:

```bash
umask 077
openssl req -x509 -newkey rsa:3072 -sha256 -nodes \
  -keyout /caminho-protegido/backup-private.pem \
  -out /caminho-protegido/backup-public.crt \
  -days 3650 -subj '/CN=Central de Suporte Backup'
chmod 600 /caminho-protegido/backup-private.pem
openssl req -x509 -newkey rsa:3072 -sha256 -nodes \
  -keyout /etc/central-suporte/backup-signing-private.pem \
  -out /etc/central-suporte/backup-signing-public.crt \
  -days 3650 -subj '/CN=Central de Suporte Backup Signing'
chmod 600 /etc/central-suporte/backup-signing-private.pem
```

Configure `.env.production`:

```dotenv
BACKUP_COPY_HOOK=/opt/central-suporte/ops/copy-backup-encrypted.sh
BACKUP_ENCRYPTION_CERT_FILE=/etc/central-suporte/backup-public.crt
BACKUP_SIGNING_CERT_FILE=/etc/central-suporte/backup-signing-public.crt
BACKUP_SIGNING_KEY_FILE=/etc/central-suporte/backup-signing-private.pem
BACKUP_EXTERNAL_DESTINATION=/mnt/backup-externo/central-suporte
BACKUP_EXTERNAL_COPY_COMMAND=
BACKUP_FAILURE_HOOK=/usr/local/sbin/central-suporte-backup-alert
```

Com `BACKUP_EXTERNAL_COPY_COMMAND` vazio, o destino precisa ser um diretório absoluto existente, gravável e montado em armazenamento externo. A cópia única já contém cifra e assinatura, é comparada e promovida de `.partial` para `.cms` de forma atômica. Para SSH, armazenamento de objetos ou outra ferramenta, informe um executável absoluto: ele recebe `arquivo_autenticado_cifrado destino`, deve concluir a cópia antes de retornar e devolver código zero somente após confirmação. O projeto não interpreta a string de destino nem exige um fornecedor. Credenciais pertencem ao executável/arquivo protegido, nunca ao repositório.

Registre o fingerprint do certificado público de assinatura no procedimento de recuperação e preserve esse certificado fora da VPS e fora do destino dos backups. Em uma rotação, mantenha os certificados públicos antigos para restaurar arquivos históricos, selecionando em `BACKUP_SIGNING_CERT_FILE` o certificado correspondente. Perda da chave privada impede novos backups assinados, mas não impede verificar/restaurar os existentes; suspeita de comprometimento exige rotação e revisão dos arquivos produzidos desde o possível incidente.

`BACKUP_FAILURE_HOOK` é opcional e recebe `backup_failed etapa arquivo_local`. Pode chamar e-mail local, syslog ou monitoramento futuro. Se dump, validação ou cópia falhar, `backup.sh` registra `backup_failed`, preserva o código de erro e tenta o alerta; falha do próprio alerta também fica explícita. Cron e systemd conseguem detectar a falha pelo código de saída. Não inclua secrets nos argumentos ou na saída desses hooks.

Agende na VPS, por exemplo no crontab do operador Docker, ajustando o diretório real:

```cron
15 2 * * * cd /opt/central-suporte && ./ops/backup.sh >> /var/log/central-suporte-backup.log 2>&1
```

Configure também rotação desse log e confira periodicamente se o alerta chega ao responsável. Backup no mesmo disco não protege contra perda da VPS: habilite a cópia externa antes do uso real e ensaie restore periodicamente. O destino externo deve ter sua própria retenção; `BACKUP_RETENTION_DAYS` cuida apenas dos dumps locais. Backups contêm dados pessoais, hashes e subscriptions; restrinja acesso. Preserve `.env.production`/VAPID separadamente em cofre/backup seguro e o volume Caddy quando necessário; o dump contém apenas o banco. RPO depende da frequência dos backups, sem recuperação ponto a ponto/WAL nesta etapa.

## Restore protegido e promoção

Aceite somente backups confiáveis: dump pode conter SQL executável. **O script nunca sobrescreve banco existente.** Exige nome novo `central_restore_*` e confirmação contendo projeto+banco:

```bash
./ops/restore.sh backups/central-suporte-prod/ARQUIVO.dump central_restore_20260919 RESTORE:central-suporte-prod:central_restore_20260919
```

Para restaurar diretamente uma cópia externa `.cms`, disponibilize o certificado público de assinatura previamente fixado e, temporariamente, o certificado/chave de decriptação. Configure `BACKUP_SIGNING_CERT_FILE`, `BACKUP_DECRYPTION_CERT_FILE` e `BACKUP_DECRYPTION_KEY_FILE`; a chave privada deve estar 0600. O conteúdo cifrado verificado e o dump decifrado existem apenas em diretório temporário 0700 e são removidos ao terminar:

```bash
./ops/restore.sh /mnt/backup-externo/central_....dump.cms central_restore_20260919 RESTORE:central-suporte-prod:central_restore_20260919
```

O restore rejeita imediatamente `.cms` sem assinatura, alterado ou assinado por outra identidade, antes de usar a chave de decriptação. Depois valida o dump; `createdb` recusa alvo existente e restore usa transação única/exit-on-error. O alvo precisa começar com `central_restore_`, nunca pode ser o banco configurado e exige confirmação com projeto+banco. Falha pode deixar um banco novo vazio para inspeção; não há exclusão automática. Negócio/histórico são restaurados; sessões são removidas, subscriptions desativadas e entregas PENDING canceladas para não ressuscitar logins/notificações antigas. Os usuários terão que entrar e ativar notificações novamente.

Valide contagens/histórico e versão das migrations no banco novo antes de promover. Para ensaio, mantenha-o isolado: **não altere POSTGRES_DB nem pare a aplicação**. Conceda acesso apenas quando decidir promover. Para recuperação real:

1. Pare app/proxy; confirme janela e perda de dados após o backup.
2. Preserve cópia segura da configuração anterior. Troque somente `POSTGRES_DB` para o novo nome, mantendo projeto/volume/usuários.
3. Recrie serviço db para atualizar seu ambiente, sem recriar volume: `docker compose --env-file .env.production -f compose.production.yaml up -d --wait db`.
4. Use imagem compatível com o backup e execute `run --rm migrate node ops/database.mjs grant` para restaurar grants; migrations adicionais somente após revisão/backup.
5. `docker compose --env-file .env.production -f compose.production.yaml up -d --no-deps --wait app proxy`.
6. Verifique health/login/chamados; mantenha o banco antigo preservado até aprovação operacional. Nunca promova um ensaio por engano.

`PRODUCTION_ENV_FILE=/caminho/arquivo` e `BACKUP_DIR=/caminho/pasta` permitem ambiente de ensaio explicitamente separado. Scripts exigem nome de projeto de produção e não carregam env como código shell.

## Segurança e limites

Autorização/isolamento por Organization, Argon2id, sessão de 8h, CSRF/Origin e política intencional de senha de 6–128 caracteres são preservados. Login mantém 10 tentativas por conta/15 min e em produção acrescenta 100 tentativas/IP/15 min, persistidas como hash. Caddy sobrescreve X-Client-IP e responde 404 a `/_next/image` (o app não usa `next/image`); app nunca deve ter porta pública. Limite por IP considera NAT corporativo e não substitui proteção contra ataque volumétrico. HTTPS/HSTS (sem preload/subdomínios), CSP, anti-iframe e nosniff permanecem; CSP ainda permite inline requerido pela configuração Next atual.

Worker Web Push continua no Node persistente, pós-commit com outbox, retries e revalidação de permissões. O servidor precisa de saída HTTPS aos endpoints permitidos dos navegadores. Não mudar VAPID ao atualizar; não habilitar cache de páginas privadas no proxy/SW. Entrega real em iOS/PWA, certificado público, DNS, firewall, capacidade e recuperação após reboot da VPS precisam de validação no destino. A validação local HTTPS usa certificado interno, sem contratar serviços nem instalar confiança global na máquina.

Referências: [Next standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [ordem de startup Compose](https://docs.docker.com/compose/how-tos/startup-order/), [proxy Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).

## Validação local reproduzível

Foi exercitado um projeto exclusivo `central-suporte-prod-validation`, banco `central_production_validation`, `.env.production-test` ignorado e HTTPS `localhost:3443` com Caddy/CA interna. O override de Compose substitui as portas do proxy por `127.0.0.1:3443:3443`; não altera o Compose de produção. Não importar a CA no sistema. O workflow de navegador existente pode ser reaplicado a uma instalação de validação **nova**, após migrations/bootstrap, com:

```bash
node --env-file=.env.production-test node_modules/@playwright/test/cli.js test --config=tests/production-browser.config.ts
```

A configuração de teste recusa outros hostnames, bancos e projetos; cria dados exclusivamente para validação. Não apontá-la à produção real. Após o ensaio, pare os serviços desse projeto, preservando ou removendo apenas seus volumes mediante decisão explícita. Testes de unidade/integração e E2E usuais continuam separados via `npm test`/`npm run test:e2e`.
