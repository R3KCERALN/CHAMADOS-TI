import { z } from 'zod';
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Username deve ter pelo menos 3 caracteres.')
  .max(40)
  .regex(/^[a-z0-9._-]+$/, 'Use letras sem acento, números, ponto, hífen ou sublinhado.');
export const passwordSchema = z
  .string()
  .min(6, 'Use uma senha com pelo menos 6 caracteres.')
  .max(128, 'Use no máximo 128 caracteres.');
export const userSchema = z.object({
  primaryCompanyId: z.string().max(100).nullable().optional(),
  primaryUnitId: z.string().max(100).nullable().optional(),
  additionalCompanyIds: z.array(z.string().max(100)).max(100).optional(),
  additionalUnitIds: z.array(z.string().max(100)).max(300).optional(),
  name: z.string().trim().min(2, 'Informe o nome completo.').max(100),
  username: usernameSchema,
  departmentId: z.string().min(1, 'Selecione um setor.').max(100),
  role: z.enum(['ADMIN', 'FUNCIONARIO', 'TI', 'GESTOR']),
});
export const ticketSchema = z.object({
  companyId: z.string().max(100).nullable().optional(),
  unitId: z.string().max(100).nullable().optional(),
  requesterName: z.string().trim().min(1, 'Informe quem pediu o atendimento.').max(150).optional(),
  quick: z.boolean().optional(),
  description: z
    .string()
    .trim()
    .min(5, 'Descreva o problema em pelo menos 5 caracteres.')
    .max(5000),
  impact: z.enum(['BLOQUEADO', 'PARCIAL', 'BAIXO']),
});
export const statusSchema = z.object({
  status: z.enum(['EM_ATENDIMENTO', 'AGUARDANDO', 'RESOLVIDO']),
  waitingReason: z.enum(['USUARIO', 'FORNECEDOR', 'PECA', 'APROVACAO', 'OUTRO']).optional(),
  note: z.string().trim().max(1000).optional(),
});
