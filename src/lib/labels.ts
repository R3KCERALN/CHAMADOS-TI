import { APP_TIMEZONE } from './config';
export const roleLabels = {
  ADMIN: 'Administrador',
  FUNCIONARIO: 'Funcionário',
  TI: 'Técnico',
  GESTOR: 'Gestor',
};
export const statusLabels = {
  NOVO: 'Novo',
  EM_ATENDIMENTO: 'Em atendimento',
  AGUARDANDO: 'Aguardando',
  RESOLVIDO: 'Resolvido',
};
export const impactLabels = {
  BLOQUEADO: 'Não consigo trabalhar',
  PARCIAL: 'Consigo trabalhar com dificuldade',
  BAIXO: 'Dúvida ou solicitação',
};
export const waitingLabels = {
  USUARIO: 'Retorno do usuário',
  FORNECEDOR: 'Fornecedor',
  PECA: 'Peça ou material',
  APROVACAO: 'Aprovação',
  OUTRO: 'Outro motivo',
};
export const eventLabels = {
  CRIADO: 'Chamado aberto',
  ASSUMIDO: 'Atendimento iniciado',
  APOIO_ADICIONADO: 'Técnico de apoio adicionado',
  APOIO_REMOVIDO: 'Técnico de apoio removido',
  STATUS_ALTERADO: 'Status alterado',
  AGUARDANDO: 'Colocado em espera',
  RETOMADO: 'Atendimento retomado',
  RESPONSAVEL_ALTERADO: 'Responsável transferido',
  COMENTARIO: 'Comentário adicionado',
  RESOLVIDO: 'Chamado resolvido',
  REABERTO: 'Chamado reaberto',
  CATEGORIA_ALTERADA: 'Categoria técnica alterada',
  LOCALIZACAO_ALTERADA: 'Localização corrigida',
  COMPLEXIDADE_ALTERADA: 'Complexidade alterada',
  EQUIPE_ALTERADA: 'Equipe alterada',
};
export const formatDate = (date: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: APP_TIMEZONE,
  }).format(date);
export const ticketNumber = (n: number) => `CS-${String(n).padStart(4, '0')}`;

export const complexityLabels = {
  BAIXA: 'Baixa',
  MEDIA: 'Média',
  ALTA: 'Alta',
  CRITICA: 'Crítica',
};
