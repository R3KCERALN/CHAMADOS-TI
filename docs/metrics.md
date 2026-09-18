# Métricas gerenciais — definições da versão 1.1

Esta documentação é o contrato dos números da aplicação. Não há score, ranking, cronômetro individual ou estimativa automática de esforço. Todos os tempos são **corridos**, incluem noites/finais de semana e são agregados no PostgreSQL.

## Fontes e instante de consulta

`Ticket` contém o estado atual; `TicketEvent` fornece a sequência de transições, atribuições e apoios. A sequência monotônica do evento desempata horários iguais. Cada consulta recebe um único instante `agora`, usado para encerrar intervalos ainda abertos. O dashboard é uma única consulta SQL; a página da equipe também agrega de uma vez, sem uma consulta por técnico. O detalhe usa duas consultas agregadas, independentemente do tamanho do histórico.

Histórico inconsistente ou incompleto não vira zero: se faltar criação, atribuição inicial, continuidade dos estados ou evento final coerente com o estado atual, o tempo de espera e o ativo ficam indisponíveis (`—`, campo vazio no CSV). O dashboard sinaliza quantos chamados das coortes de abertura/resolução não têm essa evidência. Tempo até resolução pode continuar disponível pelos timestamps estruturados. Primeira resposta só existe se houver ASSUMIDO válido, não é inferida de comentários ou do campo `updatedAt`.

O estado RESOLVIDO não inicia um intervalo operacional. Em registros da V1, o evento de resolução podia ser persistido alguns milissegundos depois de `resolvedAt`; esse atraso de registro não torna o histórico inválido. O intervalo anterior encerra em `resolvedAt`, sem reescrever dados antigos. Novas criações, atribuições iniciais e mudanças de status usam o mesmo instante no estado e no evento.

## Fuso horário

O PostgreSQL mantém os timestamps em UTC. `APP_TIMEZONE` é a única configuração de fuso; o padrão é **America/Belem**. A V1 usava America/Sao_Paulo diretamente em dois pontos; esses usos foram centralizados. Nenhuma data armazenada foi reescrita. Para preservar a convenção anterior de exibição, configure `APP_TIMEZONE=America/Sao_Paulo`.

`Hoje` começa à meia-noite civil do fuso configurado e termina à meia-noite seguinte, exclusiva. Em Belém, 17/09/2026 corresponde a `[2026-09-17T03:00Z, 2026-09-18T03:00Z)`. Não se usa a data UTC como se fosse a data local. CSV indica explicitamente UTC em suas colunas de data.

- Últimos 7/30 dias: hoje e os 6/29 dias civis anteriores.
- Este mês: primeiro dia do mês local até hoje, inclusive.
- Mês anterior: mês civil anterior completo.
- Personalizado: datas inicial/final inclusivas na interface; convertido a intervalo UTC `[início, dia seguinte ao fim)`.
- Intervalos personalizados têm limite de cinco anos por consulta. Não há truncamento silencioso de datas.

## Período, filtros e coortes

Setor, categoria, complexidade, status e técnico podem ser combinados. Setor é o setor armazenado na abertura do chamado, mesmo que o usuário mude depois. Categoria/complexidade/status refletem a **classificação e estado atuais**, inclusive quando se consulta um período passado; não são uma reconstrução da classificação que vigorava na data selecionada. Nomes de categorias e pessoas são os nomes atuais dos cadastros preservados.

No panorama e CSV, técnico significa **responsável atual/final**. Chamados apenas apoiados não entram neste filtro. A página da equipe e o detalhe têm regras de participação explícitas abaixo.

| Indicador                                          | Conjunto usado                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Abertos no período                                 | `createdAt` dentro do intervalo                                                             |
| Resolvidos no período                              | `resolvedAt` dentro do intervalo, independentemente de quando abriu                         |
| Demanda por setor/categoria/complexidade           | Chamados abertos no período                                                                 |
| Tempo até primeira resposta                        | Abertos no período que possuem ASSUMIDO válido                                              |
| Tempo total até resolução / ativo de ciclo         | Resolvidos no período, com dados válidos para cada métrica                                  |
| Motivos de espera                                  | Intervalos AGUARDANDO que intersectam o período; duração recortada à interseção             |
| Backlog, novos, em atendimento, aguardando e idade | Estado atual de todos os pendentes, **sem corte de período**, respeitando os demais filtros |
| CSV                                                | União dos abertos OU resolvidos no período, uma linha por chamado                           |

Assim, um chamado de agosto resolvido em setembro aparece nas resoluções de setembro, mas não na demanda criada em setembro. Um chamado de agosto ainda aberto continua no backlog mesmo filtrando “Hoje”. O filtro de status é atual: selecionar RESOLVIDO zera o backlog por definição. A interface identifica estes recortes para evitar confusão.

## Tempos

### Até primeira resposta

`primeiro evento ASSUMIDO.createdAt - Ticket.createdAt`, desde que não negativo. ASSUMIDO representa assumir da fila ou iniciar um atendimento rápido. Criar categoria, classificar, comentar ou transferir não redefinem a primeira resposta. No atendimento rápido, CRIADO e ASSUMIDO são gravados juntos; normalmente o resultado é zero ou próximo de zero.

### Total até resolução

`Ticket.resolvedAt - Ticket.createdAt`. Inclui espera inicial na fila, atendimento e todas as esperas. Só há valor para chamados resolvidos com timestamps válidos. **Não representa tempo gasto pelo TI.**

### Aguardando

Para cada transição para AGUARDANDO, o intervalo vai do horário do evento até a próxima transição de estado (retomada ou resolução). Se ainda aguardando, vai até `agora`. Somam-se todos os intervalos, incluindo retornos ao mesmo motivo. Motivo é o registrado no evento de entrada, não o motivo atual do chamado.

- CSV: espera acumulada do ciclo inteiro até resolução ou `agora`.
- Gráfico de motivos: cada intervalo é recortado ao período selecionado e a `agora`.
- Quantidade por motivo: chamados distintos com espera que intersecta o período, não número de eventos. Um mesmo chamado pode aparecer em mais de um motivo; os percentuais representam participações por motivo e não uma partição exclusiva do total de chamados.

### Tempo ativo de ciclo

Soma das durações dos intervalos em **EM_ATENDIMENTO**, entre a entrada nesse estado e a próxima transição. Exclui o estado NOVO e todos os intervalos AGUARDANDO. Intervalo ainda em atendimento termina em `agora`; a mediana principal do dashboard usa somente resolvidos, enquanto o CSV também mostra o acumulado de chamados abertos.

É tempo decorrido do fluxo. Pode incluir pausas não registradas, noites e atividades simultâneas. **Não é apontamento de horas, jornada, tempo de digitação, tempo individual ou esforço efetivo.** A soma de ciclos em categorias pode exceder as horas do calendário porque vários chamados ocorrem em paralelo.

### Estatísticas

Média aritmética e mediana usam os valores válidos da coorte, ignorando indisponíveis, com tamanho da amostra exibido. Zero é um valor válido; ausência de amostra aparece como `—`. Mediana usa `percentile_cont(0.5)` do PostgreSQL: com quantidade par, interpola os dois valores centrais. Não arredondamos antes da agregação; apenas a exibição converte segundos em minutos, horas ou dias.

A demanda por categoria mostra volume aberto no período e acumulado/mediana de ciclo ativo **dos chamados dessa coorte que já foram resolvidos**. Isso ajuda a localizar categorias com ciclos longos sem inventar horas de esforço.

## Transferências e equipe

A tabela é ordenada alfabeticamente. Técnicos TI ativos aparecem mesmo sem movimento. Técnicos desativados, antigos técnicos que mudaram de perfil e administradores que atuaram operacionalmente aparecem se houver participação no período ou carteira atual/resolução relevante. Não se apagam referências históricas.

- **Participou como principal no período:** chamado distinto cujo intervalo de responsabilidade intersectou o período. Começa em ASSUMIDO/RESPONSAVEL_ALTERADO para aquela pessoa; termina na próxima transferência, resolução ou `agora`. Atribuição instantânea dentro do período também conta.
- **Resolveu como responsável final:** resolução no período e `Ticket.assigneeId` igual à pessoa. Chamados resolvidos não podem ser transferidos na aplicação atual; portanto o campo preserva o responsável final. O ator do evento pode ser um ADMIN, mas o crédito da carteira continua no responsável final.
- **Backlog / em atendimento / aguardando:** estado atual e responsável atual. Apoio não aumenta a carteira principal.
- **Apoios no período:** chamado distinto com intervalo iniciado em APOIO_ADICIONADO e encerrado em APOIO_REMOVIDO, resolução ou `agora` que intersecte o período. Remover apoio ou promover apoio a principal não apaga a participação histórica. Repetidas entradas no mesmo chamado contam uma participação por pessoa/período.
- **Complexidade como principal:** classificação atual dos chamados em que teve participação principal no período.
- **Medianas individuais da carteira:** a primeira resposta usa abertos no período atualmente/finalmente atribuídos à pessoa; total e ativo usam resolvidos no período como responsável final. São durações **integrais do chamado**, incluindo etapas com outros técnicos. Não se apresentam como velocidade individual do técnico.
- **Detalhe do técnico:** distribuições e tabela usam a união de participações principais e apoios que intersectam o período. Uma linha por chamado, com os dois papéis se ambos ocorreram. Por isso o total de participações não precisa coincidir com o total das coortes das medianas.

Uma transferência permite duas participações principais no mesmo ciclo, mas apenas uma resolução final. Somar participações de toda a equipe não equivale a contar chamados únicos. Não atribuímos o tempo completo como horas trabalhadas por cada pessoa.

## Backlog e idade

Idade = `agora - createdAt`, em tempo corrido. Faixas usam dias completos: `<1`, `[1,4)`, `[4,8)`, `[8,16)` e `>=16` dias. A última aparece como “Mais de 15 dias”. Mostramos dez pendências mais antigas; a fila operacional continua paginada e filtrável. Não se calcula SLA ou atraso contratual.

## Exportação

Somente ADMIN/GESTOR. A autorização é validada no servidor. O CSV respeita os filtros do panorama, usa UTF-8 com BOM, separador `;`, aspas escapadas e proteção contra células interpretadas como fórmulas. Timestamps em UTC e durações em segundos; indisponíveis ficam vazias. Não há linhas duplicadas quando um chamado abriu e resolveu no mesmo período.

Leitura em lotes de 500, por número sequencial, dentro de uma transação repeatable-read para snapshot consistente. A conexão é liberada ao encerrar/cancelar; timeout de dois minutos, sem corte silencioso de registros. Se o intervalo for grande demais, a exportação é interrompida e deve ser refeita com período menor. Categorias inativas e “Sem categoria” permanecem visíveis.

## Indicadores deliberadamente ausentes

Não calculamos horas individuais trabalhadas, utilização percentual, custo, SLA, score de complexidade, eficiência pessoal, ranking nem “melhor/pior técnico”. Não há dados de jornada, dedicação exclusiva ou metas de capacidade que sustentem esses números. Sobrecarga é investigada pela combinação de backlog, espera, complexidade e contexto, sem rótulo automático.

Não reconstruímos a classificação antiga por período nem reabrimos chamados. Nenhuma métrica depende de reabertura nesta entrega. Reabertura futura exigirá atualizar este contrato e os testes para ciclos múltiplos.
