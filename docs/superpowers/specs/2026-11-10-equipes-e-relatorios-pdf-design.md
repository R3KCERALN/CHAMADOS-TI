# Equipes (TI e Elétrica) e relatórios em PDF — desenho

Data: 2026-11-10. Status: aguardando aprovação.

## Intenção

Hoje um problema elétrico é avisado por WhatsApp a alguém da equipe elétrica, que se desloca até o local. Não fica fila, responsável nem histórico. O objetivo é levar a equipe de eletricistas para dentro da Central de Suporte com o mesmo fluxo que a TI já usa (fila, assumir, apoio, espera, resolução, timeline, avisos), sem mudar quase nada para quem abre chamado.

Junto, o gestor precisa levar os números para fora do sistema: cada tela gerencial passa a gerar um PDF com os filtros aplicados.

## Objetivos

- Duas equipes técnicas na mesma organização: **TI** e **Elétrica**.
- Na abertura comum, o funcionário escolhe para qual equipe é o chamado. É a única mudança para ele.
- Todo chamado pertence a uma equipe, e isso aparece em fila, detalhe, gestão, CSV e PDF.
- Cada técnico pertence a uma equipe, definida pelo ADMIN no cadastro do usuário.
- Ao adicionar apoio, o técnico pode chamar alguém da outra equipe.
- O gestor (do grupo, não de uma equipe) vê as duas equipes e filtra por equipe.
- Cada tela gerencial tem "Baixar PDF".

## Não-objetivos

- Ver as duas filas juntas como técnico. Ninguém precisa disso "por enquanto".
- Gestor por equipe. O gestor é do grupo.
- Cadastro de equipes pela interface. As duas equipes vêm da migration.
- Técnico em mais de uma equipe.
- Relatórios novos além das telas gerenciais existentes. Os relatórios do estoque vêm no projeto do estoque (`2026-11-10-estoque-design.md`).

## Anti-objetivos (falha mesmo que "funcione")

- Funcionário tendo de entender a estrutura interna: a escolha deve ser simples, duas opções claras.
- Chamado elétrico vazando para a fila da TI ou o contrário, ou o ajudante de outra equipe passando a enxergar a fila inteira da outra equipe.
- Chamados antigos perdendo histórico, ou métricas antigas mudando de valor por causa da migração.
- Aviso de chamado novo tocando no celular de toda a outra equipe.

## Decisões tomadas com o dono do produto

### Abertura do chamado

- A abertura comum continua só com descrição e impacto, mais a escolha da equipe: **TI** ou **Elétrica**.
- A escolha é obrigatória e não tem valor pré-marcado, para ninguém mandar um problema elétrico para a TI por distração.

### Técnicos e filas

- O técnico pertence a uma equipe, definida pelo ADMIN no cadastro.
- O técnico vê a fila apenas da própria equipe.
- Além disso, vê os chamados da outra equipe em que foi incluído como apoio, e só esses.
- O ADMIN vê e atua nas duas equipes, com filtro por equipe na fila.

### Colaboração

- Ao adicionar apoio, o técnico pode escolher alguém de qualquer equipe.
- As regras de quem altera status, responsável e apoios continuam as de hoje: principal/ADMIN.

### Categorias

- As categorias passam a ser de cada equipe. Exemplos: "Impressora" é da TI, "Tomada/disjuntor" é da Elétrica.
- No chamado, só aparecem as categorias da equipe do chamado.
- O cadastro de categorias (ADMIN) passa a pedir a equipe.

### Chamado aberto na equipe errada

- O responsável principal ou o ADMIN pode mover o chamado para a outra equipe ("Mover para Elétrica", "Mover para TI").
- Ao mover:
  - o chamado volta como **NOVO, sem responsável**, na fila da outra equipe;
  - a categoria é limpa, porque é da equipe antiga;
  - os apoios continuam;
  - a timeline registra a mudança, com novo tipo de evento.
- A outra equipe recebe o aviso como se fosse um chamado novo.
- O responsável principal **sempre é da equipe do chamado**. Alguém da outra equipe só participa como apoio. A transferência de responsável só oferece técnicos da equipe do chamado.

### Atendimento rápido

- Disponível também para eletricistas.
- O chamado cai na equipe de quem registrou.

### Avisos (Web Push e atualização automática)

- O aviso de chamado novo vai só para a equipe escolhida no chamado.

### Chamados existentes

- Os chamados atuais passam a ser da TI, sem perder histórico.
- Os técnicos atuais passam para a equipe TI, e as categorias atuais também.

### Gestão

- O gestor vê as duas equipes.
- Todas as telas gerenciais e o CSV ganham o filtro "Equipe", com a opção "Todas".
- O CSV ganha a coluna Equipe.
- Continua valendo que um técnico não acessa indicadores dos colegas.

### PDF

- Telas que ganham "Baixar PDF":
  - Panorama.
  - Filiais e o detalhe de cada filial.
  - Equipe e o detalhe de cada técnico.
  - Chamados.
- O PDF contém os mesmos números e tabelas da tela, com os filtros aplicados naquele momento, inclusive o de equipe.
- Permissão igual à do CSV: ADMIN e GESTOR.

## Escolhas técnicas do agente (podem ser revistas)

- **Equipe como tabela, não enum.**
  - Modelo `Team` por organização, com nome e ativo, criado pela migration com "TI" e "Elétrica".
  - Isso segue o padrão das outras entidades (organizationId e triggers contra relações cruzadas) e deixa uma terceira equipe como cadastro futuro, sem nova migration de enum.
- **Papel técnico.**
  - O valor `Role.TI` continua no banco, para não mexer no histórico, nas migrations nem nas métricas existentes.
  - Na interface ele passa a se chamar "Técnico".
  - Usuário com esse papel exige equipe. ADMIN, GESTOR e FUNCIONARIO não têm equipe.
- **Equipe no chamado.**
  - `Ticket.teamId` é obrigatório (NOT NULL depois do backfill para TI).
  - A migration incremental faz o backfill. Ela não reescreve eventos, e os triggers garantem a mesma organização entre equipe, chamado, usuário e categoria.
- **Escopo do ajudante.**
  - O acesso a um chamado de outra equipe vem exclusivamente da relação `TicketParticipant` existente.
  - Remover o apoio remove esse acesso. O histórico do apoio continua na timeline, como hoje.
- **Mudar a equipe de um técnico.**
  - O ADMIN não consegue trocar a equipe de um técnico enquanto ele for responsável principal de chamados não resolvidos. Esses chamados precisam ser transferidos antes, e a tela diz quantos são.
  - Os apoios em andamento continuam, porque o acesso de apoio não depende de equipe.
  - Na migration, o nome da categoria passa a ser único por organização e equipe.
- **Equipe nas métricas.**
  - O filtro "Equipe" usa a **equipe atual do chamado**, na mesma linha de `docs/metrics.md` para categoria e status.
  - Nas telas gerenciais "Equipe" e no detalhe do técnico, o filtro recorta os **chamados**, não as pessoas. A lista mostra os técnicos ativos daquela equipe e quem teve participação em chamados dela, inclusive o apoio de outra equipe.
  - O ADMIN só aparece se tiver participado.
  - O histórico de um técnico que mudou de equipe aparece de acordo com a equipe de cada chamado.
  - Documentar essas regras em `docs/metrics.md`.
- **ADMIN no atendimento rápido.** O ADMIN não tem equipe, então escolhe a equipe ao registrar um atendimento rápido.
- **Revisão de atualização automática.** Hoje a revisão do TI/ADMIN é por organização.
  - Ela pode passar a ser por equipe, para o eletricista não recarregar a tela a cada mudança da TI.
  - Requisito mínimo: nunca devolver dados da outra equipe. Recarregar a mais é aceitável; vazar não é.
- **Geração do PDF.**
  - O PDF é gerado no servidor, com uma biblioteca JavaScript pequena e mantida, sem binário nativo.
  - Não usar navegador headless: o container é somente leitura, sem root e sem capabilities.
  - É uma nova dependência de produção justificada; rodar `npm audit`.
  - A rota é GET de leitura, como o export CSV atual, com as mesmas validações de filtro e de organização.
  - Usar fontes locais embutidas, sem requisição externa, com acentuação do português correta.
- **Conteúdo do PDF.**
  - Cabeçalho com nome da organização, título da tela, período, filtros, data/hora de geração em `APP_TIMEZONE` e quem gerou.
  - Indicador indisponível sai como "—", nunca zero, como define `docs/metrics.md`.
  - Os gráficos podem virar tabelas no PDF. A tela já tem tabela acessível equivalente.
- **Tamanho do PDF de Chamados.** Limite de 2.000 linhas. Acima disso, o PDF avisa que a lista foi cortada e indica o CSV para a lista completa.

## Restrições do projeto (ver `AGENTS.md`)

- Organização vem do ator, nunca do cliente; escopo inclusive em opções, busca, contadores, SQL e CSV/PDF.
- Mutações só por Server Actions com checagem de Origin; nunca GET.
- Migrations SQL incrementais, preservando CHECKs/triggers; nunca resetar dados ou reescrever migrations aplicadas.
- Ticket + evento + outbox na mesma transação. Assumir com UPDATE condicional; demais mutações com row lock.
- Payload de push sem descrição, comentários ou nomes pessoais.
- Ler `docs/organization-model.md` e `docs/metrics.md` antes de mexer em isolamento e métricas.
- Atualizar `AGENTS.md`, `README.md`, `docs/metrics.md` e `docs/organization-model.md` com as novas regras.
- Validação completa: lint, typecheck, testes, build, E2E e `npm audit`, com testes só em bancos `central_test_*`.

## Fica a cargo de quem construir

- Layout da escolha de equipe na abertura: botões grandes, mobile-first, acessíveis.
- Onde a equipe aparece na fila e no detalhe (selo, coluna).
- Qual biblioteca de PDF usar e o layout do documento.
- Como dividir o trabalho em etapas, por exemplo equipes primeiro e PDF depois.
