# Estoque de ferramentas e materiais — desenho

Data: 2026-11-10. Status: aguardando aprovação. Depende de: `2026-11-10-equipes-e-relatorios-pdf-design.md` (equipes e PDF).

**Ordem:** este projeto é construído **depois** do de equipes. Ele parte da tabela `Team`, de `Ticket.teamId`, da equipe do técnico e do gerador de PDF que aquele projeto cria.

## Intenção

Hoje ferramentas e materiais ficam todos no mesmo lugar e a pessoa só pega. Isso causa dois problemas reais:

- Ninguém sabe com quem está cada ferramenta.
- O material acaba sem ninguém perceber. O pedido de reposição é lento: os técnicos pedem, avisam o financeiro, o financeiro passa ao chefe e aguarda a liberação. Por isso trabalhos chegam a parar por falta de material.

O estoque precisa avisar **antes** de faltar e mostrar quem está com cada ferramenta.

## Mudança de escopo

O `AGENTS.md` lista "inventário" como fora do escopo do sistema. O dono do produto pediu este estoque, e o `AGENTS.md` deve ser atualizado junto: o estoque passa a fazer parte do escopo, só para ferramentas e materiais de manutenção.

## Objetivos

- Cadastro de **ferramentas individuais**, cada uma com etiqueta própria ("Alicate 1", "Alicate 2"), e registro de "peguei" e "devolvi".
- Cadastro de **materiais** (cabos, conectores, etc.) com saldo, unidade de medida e estoque mínimo.
- Registro de uso de material **dentro de um chamado** ou **fora de chamado**. Fora de chamado, é obrigatório anexar uma foto da autorização.
- Aviso para todos quando um material chega ao mínimo.
- Conferência posterior, por gestores e ADMIN, das fotos de autorização.

## Não-objetivos

- Preço, custo e valor de estoque. _(chamada do agente)_
- Fornecedores e pedido de compra. O pedido continua fora do sistema, pelo financeiro.
- Aprovação no sistema pelo chefe. Ele autoriza por mensagem ou áudio, fora do sistema.
- Vários locais de estoque ou estoque por filial: é um só, tudo no mesmo lugar.
- Leitura de código de barras ou QR. A etiqueta é um nome escrito.
- Acesso do funcionário comum ao estoque.

## Anti-objetivos

- Travar o trabalho do técnico por causa de saldo errado no sistema.
- O aviso de mínimo virar ruído, repetido a cada uso.
- A foto de autorização ficar visível para quem não confere, já que prints de WhatsApp podem ter nomes e telefones de terceiros.
- Histórico de movimentação editável ou apagável.

## Decisões tomadas com o dono do produto

### Quem usa

- **Técnicos de qualquer equipe:** pegam e devolvem ferramentas e registram uso de material.
- **Gestores e ADMIN:** conferem as fotos de autorização.
- **Responsáveis de estoque:** o ADMIN marca quem são, com pelo menos um por equipe. Eles e o ADMIN:
  - dão entrada de material;
  - cadastram itens novos;
  - corrigem o saldo depois de uma contagem, sempre informando o motivo.
- **Funcionário comum:** não vê o estoque.

### Itens e equipes

- Cada item, ferramenta ou material, pertence a uma equipe (TI ou Elétrica) **só para organização**: listas e filtros.
- Qualquer técnico pode pegar uma ferramenta ou usar um material de qualquer equipe.

### Ferramentas

- São individuais. Várias iguais existem como itens separados ("Alicate 1", "Alicate 2").
- Fluxo: "peguei" e "devolvi".
- A tela mostra, por ferramenta, se está guardada ou com quem está e desde quando.

### Uso de material em chamado

- Pode registrar qualquer técnico que esteja no chamado, inclusive o ajudante da outra equipe.
- O material não precisa ser da equipe do chamado.

### Material esquecido antes de resolver

- Quem participou do chamado ainda pode registrar material nele, sem foto, por até **48 horas depois da resolução**.
- Depois desse prazo, só pelo uso fora de chamado, com foto.

### Uso fora de chamado

- Exige uma foto, normalmente o print da autorização do chefe.
- A foto basta para liberar o registro. Não há aprovação no momento.
- A foto fica guardada com quem registrou, quando e o quê.
- Gestores ou ADMIN conferem depois e marcam cada uma como **conferida** ou **questionada**, com observação.
- **Guarda das fotos:**
  - A foto conferida é apagada automaticamente **1 ano depois da conferência**.
  - A foto questionada não é apagada enquanto a questão não for encerrada por um gestor ou ADMIN, com observação. Depois do encerramento, vale o mesmo prazo de 1 ano.
  - O registro de uso continua para sempre, com quem, quando, o quê e o resultado da conferência. Depois do prazo, a tela mostra "foto removida após o prazo de guarda".

### Saldo acima do disponível

- Se alguém registrar um uso maior do que o saldo mostra, o sistema aceita.
- O item fica marcado "conferir saldo" até uma correção de contagem.

### Aviso de estoque mínimo

- Quando o saldo de um material passa a ficar no mínimo ou abaixo dele, **todos** são avisados: técnicos das duas equipes, gestores e ADMIN.
- O aviso é mandado **uma vez**, não a cada uso.
- O item fica numa lista "Acabando" até a reposição.
- Qualquer pessoa pode marcar "pedido já feito ao financeiro". Aparece quem marcou e quando, para os outros saberem que alguém já cuidou.
- Quando uma entrada faz o saldo passar do mínimo, o alerta se encerra. Uma nova queda abaixo do mínimo gera novo aviso.

### Relatórios

- O gestor terá relatórios de uso de material em tela, CSV e PDF, como as outras telas gerenciais. O PDF reutiliza o mecanismo do projeto de equipes.
- Conteúdo:
  - consumo por período, equipe e item;
  - usos fora de chamado e o estado da conferência;
  - ferramentas fora do lugar e há quanto tempo.

## Escolhas técnicas do agente (podem ser revistas)

- **Histórico de acréscimo.**
  - Toda movimentação vira um registro que não se altera nem se apaga: entrada, uso em chamado, uso fora de chamado, ajuste de contagem, peguei e devolvi.
  - Os grants do papel da aplicação seguem o padrão já usado em `TicketEvent`/`UserAudit` (sem UPDATE/DELETE/TRUNCATE).
  - A conferência das fotos é um registro separado, ligado à movimentação, para não precisar editar a movimentação.
- **Saldo.**
  - O saldo atual fica numa coluna do material, atualizada na mesma transação da movimentação, com lock de linha no material.
  - Assim, dois usos simultâneos não perdem baixa e o aviso de mínimo dispara exatamente uma vez.
  - Quantidade decimal, porque cabo é medido em metros fracionados. Unidade escolhida de uma lista fixa (unidade, metro, rolo, caixa, pacote).
- **Ferramenta em uso.**
  - Uma ferramenta com alguém não pode ser "pega" por outra pessoa até ser devolvida.
  - A devolução é registrada por quem está com ela, por um responsável de estoque ou pelo ADMIN, para o caso de ferramenta largada na bancada.
  - Ferramenta perdida ou quebrada é desativada com motivo, nunca apagada.
- **Uso dentro do chamado.**
  - Permitido enquanto o chamado não está resolvido e, depois, pela janela de 48 h.
  - Aparece na timeline do chamado apenas para técnicos e ADMIN. O solicitante não vê os materiais.
- **Correção de lançamento errado.** Um lançamento nunca é editado. Ele é **estornado** por um movimento ligado ao original, com motivo, devolvendo a quantidade ao saldo.
  - Quem lançou pode estornar em até 24 h.
  - Responsáveis de estoque e o ADMIN podem estornar a qualquer momento.
  - O relatório de consumo desconta os estornos.
  - O estorno que faz o saldo passar do mínimo encerra o alerta aberto por engano.
  - O ajuste de contagem continua separado. Ele corrige o saldo físico e não conta como consumo.
- **Equipe registrada em cada movimento.**
  - Cada movimento guarda, no momento em que acontece, três equipes: a do item, a do técnico que fez e a do chamado, quando houver.
  - O relatório "consumo por equipe" agrupa pela **equipe do item**, que é a forma de organização pedida, e permite filtrar pela equipe de quem usou.
- **Responsáveis de estoque.**
  - A marca vale só para usuários com papel Técnico. O ADMIN já tem esses poderes.
  - O responsável atua em **todos** os itens, porque a separação por equipe é só organizacional.
  - "Pelo menos um por equipe" é orientação, não trava. A tela do ADMIN avisa quando uma equipe fica sem responsável.
  - Dar e tirar a marca fica na auditoria de usuários (`UserAudit`).
- **Edição do cadastro de item.**
  - Nome, equipe e estoque mínimo podem ser editados por responsáveis e ADMIN, com registro de quem mudou e quando.
  - A unidade de medida fica fixa depois do primeiro movimento.
  - Alterar o mínimo reavalia o alerta: abre se o saldo ficou no novo mínimo ou abaixo, encerra se ficou acima.
  - Criar um material já no mínimo ou abaixo abre o alerta.
- **Limpeza das fotos.**
  - Um processo agendado apaga as fotos vencidas. Pode rodar no Node persistente, como o worker de push, ou por um script em `ops/`; a escolha fica para quem construir.
  - Só a tabela de fotos recebe DELETE no grant do papel da aplicação. O restante do histórico continua só de acréscimo.
  - Documentar em `docs/production.md` o prazo de guarda e o efeito nos backups: as fotos apagadas somem do banco, mas continuam nos backups antigos até eles expirarem.
- **Fotos de autorização.**
  - Guardadas no próprio PostgreSQL, numa tabela separada. Assim entram nos backups e no restore já existentes sem novo volume, e o app continua com filesystem somente leitura.
  - Aceitar só imagem (JPEG, PNG ou WebP), com limite de tamanho de cerca de 5 MB, e conferir o tipo pelo conteúdo, não pela extensão.
  - Recomprimir e remover os metadados, como localização.
  - Exibir só para gestores, ADMIN e quem registrou, por rota autenticada, sem cache e com `Content-Disposition` seguro.
  - O `ops/Caddyfile` limita o corpo a 256 KB. Esse limite deve subir só para a rota de upload.
- **Avisos.**
  - O outbox de Web Push hoje é ligado a `TicketEvent`. O aviso de mínimo precisa de uma origem de evento de estoque, preservando as regras atuais: outbox na mesma transação, lease/retry, revalidação de destinatário e organização, payload sem nomes pessoais. O nome do material pode ir no aviso.
  - Também aparece um contador "Acabando" na navegação dos técnicos, gestores e ADMIN.

## Restrições do projeto (ver `AGENTS.md`)

- Organização vem do ator; todas as tabelas novas com `organizationId` e triggers contra relações cruzadas.
- Mutações por Server Actions com Origin; nunca GET.
- Migrations SQL incrementais; nada de reset.
- Concorrência de estoque é área crítica: testes de corrida para baixa simultânea, dupla retirada da mesma ferramenta e disparo único do aviso.
- Telas de técnico mobile-first, porque o uso é com a ferramenta na mão. PT-BR.
- Atualizar `AGENTS.md` (escopo), `README.md` e `docs/production.md`: tamanho de upload no Caddy e crescimento do backup com as fotos.
- Validação completa: lint, typecheck, testes, build, E2E e `npm audit` para qualquer dependência nova.

## Fica a cargo de quem construir

- Layout das telas de estoque e da lista "Acabando".
- Como agrupar ferramentas iguais na listagem (por exemplo, "Alicate (3), 1 com Fulano").
- Biblioteca de processamento de imagem. O projeto já tem `sharp` como dependência transitiva do Next, mas confirme antes de usar.
- Divisão do trabalho em etapas.
