# Estrutura organizacional — V1.2

## Modelo

```text
Organization (grupo/cliente da instalação)
└── Company (pessoa jurídica / CNPJ; “Filial” nesta interface)
    └── Unit (local físico opcional; “Unidade”)

Ticket
├── organizationId
├── companyId (obrigatório em novas aberturas; nullable para legado)
├── unitId (opcional)
├── openedByUserId (User que registrou)
├── requesterId (User solicitante, opcional)
└── requesterName (nome preservado na abertura)
```

Uma Company pode ter **zero unidades**. A abertura não cria nem exige uma unidade artificial. Unit é outra entidade, com FK obrigatória para Company. CNPJ não é identificador de local físico: duas unidades da mesma Company compartilham seu CNPJ.

`src/lib/organization-labels.ts` centraliza a terminologia Filial/Unidade. Não há tela de configuração de labels nesta etapa. Nomes de cadastro são livres e não são regras de autorização.

## Instalação e preparação para tenants

A migration cria `initial-organization`, chamada “Organização inicial”. `APP_ORGANIZATION_ID` é uma configuração **do servidor**, cujo padrão aponta para essa organização. O bootstrap usa `INITIAL_ORGANIZATION_NAME` ao criar uma organização em uma instalação nova; não renomeia automaticamente uma organização existente. O ADMIN vê a organização atual em Administração > Filiais.

O login consulta apenas a organização configurada, sem seletor, parâmetro de cliente ou troca de tenant. Organização inativa impede login, uso de sessões existentes e operações de serviços. Usernames continuam globalmente únicos, preservando o contrato de autenticação anterior. Uma futura instalação SaaS com usernames repetidos precisará definir explicitamente como identificar o tenant antes de autenticar; isso não foi antecipado na interface atual. Números de chamados também continuam na sequência global existente.

Não há provisioning público, billing, subdomínios, planos, super-admin ou troca de organização. Dois bancos locais (principal e demo) representam instalações independentes, mesmo utilizando o mesmo ID de bootstrap.

## Isolamento

User, Department, Category, Company e Ticket possuem `organizationId` obrigatório. Unit deriva o escopo de Company. Sessões derivam de User; eventos, comentários e apoios derivam de Ticket; auditoria de usuário deriva de seus usuários relacionados. As tabelas de permissões adicionais usam relações reais `UserCompanyAccess` e `UserUnitAccess`, nunca CSV ou JSON de IDs.

O ator é relido no banco em `src/lib/access.ts`. O escopo vem desse ator/sessão, nunca de um `organizationId` enviado no formulário. Consultas de listas, opções, busca de pessoas, detalhes, administração, contadores, SQL analítico e CSV são limitadas à organização. IDs recebidos passam pela validação de pertencimento e papel. TI continua atendendo **todas** as Companies da sua organização, sem limitação por sua localização administrativa.

FKs preservam referências. Triggers versionados na migration também rejeitam relações entre organizações em escritas diretas, incluindo eventos, comentários, apoios e permissões adicionais. O `organizationId` de entidades existentes não pode ser alterado. Esses controles complementam o escopo das consultas; não se trata de PostgreSQL RLS. A credencial administrativa do banco não representa um usuário final isolado.

Não há exclusão física na interface. Desativar Company/Unit mantém referências e relatórios. A Company de uma Unit já criada é imutável para não reinterpretar o histórico; para mover fisicamente uma unidade, desative e crie outra no destino. Nome, código e situação continuam editáveis.

## Usuários e locais autorizados

Novos FUNCIONARIO precisam de Company principal e Department. Unit principal é opcional. TI, ADMIN e GESTOR podem ter Company/Unit administrativas opcionais, sem restringir seu escopo organizacional.

A seção secundária “Outras localizações autorizadas” permite Companies e Units adicionais:

- Companies autorizadas = principal + adicionais.
- Uma Unit adicional precisa pertencer a uma Company autorizada.
- Sem Unit principal/adicional em determinada Company, o funcionário pode escolher qualquer Unit ativa daquela Company.
- Se houver seleção de Units naquela Company, a escolha de unidade fica limitada às selecionadas. Registrar sem Unit continua permitido, pois a subdivisão é opcional.
- Com somente uma Company autorizada, o formulário envia essa Company automaticamente e oculta o seletor.
- Com várias, o campo “Onde está o problema?” permite selecionar; a principal é o valor inicial.
- Company ou Unit inativa não pode receber novo chamado. Vínculos inativos já existentes podem ser mantidos ao editar/desativar a conta, preservando a administração de acessos.

A abertura não cadastra todos os colaboradores. Contas continuam destinadas às pessoas que precisam acessar o sistema.

## Quem abriu e quem solicitou

Na abertura normal, `openedByUserId` e `requesterId` são o próprio usuário autenticado. Não se pergunta quem contou o problema ao responsável. O setor e o nome são capturados nesse momento.

No Atendimento Rápido, `openedByUserId` é sempre o TI/ADMIN autenticado. Existem dois modos explícitos:

1. **Pessoa cadastrada:** busca no servidor por nome/setor, no máximo 15 resultados por consulta. Selecionar preenche Company/Unit principais ativas; TI pode alterar. O setor vem do usuário selecionado.
2. **Informar nome:** apenas nome, Company obrigatória e Unit opcional. Não se cria User, senha, CPF, e-mail ou conta fictícia. `requesterId` e `departmentId` ficam nulos; não se atribui o setor do técnico ao solicitante.

O chamado inicia EM_ATENDIMENTO com o registrador como responsável, origem ATENDIMENTO_RAPIDO e eventos CRIADO/ASSUMIDO no mesmo instante. A timeline identifica quem registrou. A interface usa `requesterName`, preservado como snapshot, tanto para pessoas cadastradas quanto para nomes informados. Mudar o nome do User não reescreve a identificação histórica; a relação continua disponível.

A busca encontra número, descrição, snapshot do nome e nome atual do usuário vinculado. A localização pode ser corrigida por TI/ADMIN da mesma organização; a operação gera LOCALIZACAO_ALTERADA com IDs anteriores/novos em metadata. Classificação e localização atuais são as dimensões usadas pelos relatórios.

## Migração de dados anteriores

`202609190001_organization_locations` é incremental e transacional. Não recria tabelas de negócio, não remove registros, não altera migrations antigas e não reseta volumes.

- Todos os usuários, setores, categorias e chamados existentes recebem `initial-organization`.
- Nenhuma Company ou Unit real é inventada. Vínculos principais dos usuários e localização dos chamados antigos permanecem nulos.
- `requesterName` recebe o nome do usuário vinculado **no momento da migração**; não é possível reconstruir nomes antigos que nunca foram registrados.
- `openedByUserId` vem do primeiro evento CRIADO, pela sequência. Se não houver esse evento, fica nulo e a interface mostra “Não registrado (legado)”; não atribuímos autoria por suposição.
- O campo existente `requesterId` foi preservado, agora opcional. Ele equivale conceitualmente ao `requesterUserId` solicitado, evitando renomear desnecessariamente o contrato existente.
- Novas aberturas pelos serviços sempre exigem Company válida e registrador. Legacy nullable não é uma brecha para novos formulários.

Após atualizar o banco real, o ADMIN deve cadastrar as Companies reais e associar funcionários antes de novas aberturas. Usuários antigos continuam acessando seus históricos. Nenhum dado demo é copiado para o banco principal.

## Dados fictícios

`npm run demo:setup` atualiza apenas `central_suporte_demo`, exige `SEED_DEMO=true` e preserva senhas existentes. A organização fictícia recebe quatro Companies: Norte/Oeste sem Units e Sul/Leste com duas Units cada. CNPJs são gerados sinteticamente com dígitos verificadores válidos, sem consulta ou associação declarada a pessoas jurídicas reais; não usar esses documentos fora da demonstração.

Os 54 chamados anteriores recebem localizações fictícias somente nesse banco. Seis atendimentos rápidos adicionais demonstram pessoas cadastradas e os nomes “João - Reposição”, “Marcos - Caixa” e “Ana - Estoque”. A repetição do setup não duplica esses seis chamados. Novos dados inseridos manualmente fora desse conjunto são preservados.
