import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { db } from './db';
import { actor } from './access';
import { AppError } from './errors';
import { cnpjSchema } from './cnpj';
type Tx = Prisma.TransactionClient;
export async function validateUserLocations(
  tx: Tx,
  organizationId: string,
  data: {
    role: string;
    primaryCompanyId?: string | null;
    primaryUnitId?: string | null;
    additionalCompanyIds?: string[];
    additionalUnitIds?: string[];
  },
  retained: { companyIds?: string[]; unitIds?: string[]; allowMissingCompany?: boolean } = {},
) {
  const companyId = data.primaryCompanyId || null,
    unitId = data.primaryUnitId || null;
  if (data.role === 'FUNCIONARIO' && !companyId && !retained.allowMissingCompany)
    throw new AppError('Selecione a filial principal do funcionário.');
  if (unitId && !companyId) throw new AppError('A unidade precisa pertencer à filial principal.');
  const companyIds = [
    ...new Set(
      [companyId, ...(data.additionalCompanyIds || [])].filter((id): id is string => !!id),
    ),
  ];
  const unitIds = [
    ...new Set([unitId, ...(data.additionalUnitIds || [])].filter((id): id is string => !!id)),
  ];
  if (
    (await tx.company.count({
      where: {
        id: { in: companyIds },
        organizationId,
        OR: [{ active: true }, { id: { in: retained.companyIds || [] } }],
      },
    })) !== companyIds.length
  )
    throw new AppError('Selecione somente filiais ativas da sua organização.');
  const units = await tx.unit.findMany({
    where: {
      id: { in: unitIds },
      company: { organizationId },
      OR: [{ active: true, company: { active: true } }, { id: { in: retained.unitIds || [] } }],
    },
  });
  if (
    units.length !== unitIds.length ||
    units.some((u) => !companyIds.includes(u.companyId)) ||
    (unitId && units.find((u) => u.id === unitId)?.companyId !== companyId)
  )
    throw new AppError('Unidade inválida para as filiais autorizadas.');
  return {
    primaryCompanyId: companyId,
    primaryUnitId: unitId,
    additionalCompanyIds: companyIds.filter((id) => id !== companyId),
    additionalUnitIds: unitIds.filter((id) => id !== unitId),
  };
}
export async function locationOptions(userId: string, activeOnly = true) {
  const user = await actor(db, userId);
  const grants = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { companyAccess: true, unitAccess: { include: { unit: true } } },
  });
  const restricted = user.role === 'FUNCIONARIO';
  const ids = [user.primaryCompanyId, ...grants.companyAccess.map((a) => a.companyId)].filter(
    (id): id is string => !!id,
  );
  const companies = await db.company.findMany({
    where: {
      organizationId: user.organizationId,
      ...(activeOnly ? { active: true } : {}),
      ...(restricted ? { id: { in: ids } } : {}),
    },
    orderBy: { displayName: 'asc' },
    select: {
      id: true,
      displayName: true,
      active: true,
      units: {
        where: activeOnly ? { active: true } : {},
        orderBy: { name: 'asc' },
        select: { id: true, name: true, active: true },
      },
    },
  });
  return companies.map((c) => {
    const allowed = [
      user.primaryCompanyId === c.id ? user.primaryUnitId : null,
      ...grants.unitAccess.filter((a) => a.unit.companyId === c.id).map((a) => a.unitId),
    ].filter(Boolean);
    return {
      ...c,
      units: restricted && allowed.length ? c.units.filter((u) => allowed.includes(u.id)) : c.units,
    };
  });
}
export async function resolveLocation(
  tx: Tx,
  user: Awaited<ReturnType<typeof actor>>,
  input: { companyId?: string | null; unitId?: string | null },
  defaults?: { primaryCompanyId: string | null; primaryUnitId: string | null },
) {
  const base = defaults || user;
  const companyId = input.companyId || base.primaryCompanyId;
  const unitId =
    input.unitId === undefined
      ? base.primaryCompanyId === companyId
        ? base.primaryUnitId
        : null
      : input.unitId;
  if (!companyId)
    throw new AppError(
      'Selecione uma filial. Se necessário, peça ao administrador para configurar seu cadastro.',
    );
  const company = await tx.company.findFirst({
    where: { id: companyId, organizationId: user.organizationId, active: true },
  });
  if (!company) throw new AppError('Filial indisponível.');
  if (unitId && !(await tx.unit.findFirst({ where: { id: unitId, companyId, active: true } })))
    throw new AppError('Unidade inválida para esta filial.');
  if (user.role === 'FUNCIONARIO') {
    if (
      companyId !== user.primaryCompanyId &&
      !(await tx.userCompanyAccess.findUnique({
        where: { userId_companyId: { userId: user.id, companyId } },
      }))
    )
      throw new AppError('Você não tem permissão para esta filial.', 403);
    const restricted = await tx.userUnitAccess.findMany({
      where: { userId: user.id, unit: { companyId } },
    });
    const allowed = [
      ...restricted.map((a) => a.unitId),
      ...(user.primaryCompanyId === companyId && user.primaryUnitId ? [user.primaryUnitId] : []),
    ];
    if (unitId && allowed.length && !allowed.includes(unitId))
      throw new AppError('Você não tem permissão para esta unidade.', 403);
  }
  return { companyId, unitId: unitId || null };
}
export async function saveCompany(actorId: string, input: unknown) {
  const data = z
    .object({
      id: z.string().optional(),
      displayName: z.string().trim().min(2).max(100),
      legalName: z.string().trim().max(200).nullable().optional(),
      cnpj: cnpjSchema,
      active: z.boolean().default(true),
    })
    .parse(input);
  const user = await actor(db, actorId, ['ADMIN']);
  const { id, ...values } = data;
  if (id) {
    if (!(await db.company.findFirst({ where: { id, organizationId: user.organizationId } })))
      throw new AppError('Filial não encontrada.', 404);
    return db.company.update({ where: { id }, data: values });
  }
  return db.company.create({ data: { ...values, organizationId: user.organizationId } });
}
export async function saveUnit(actorId: string, input: unknown) {
  const data = z
    .object({
      id: z.string().optional(),
      companyId: z.string().max(100),
      name: z.string().trim().min(1).max(100),
      code: z.string().trim().max(30).nullable().optional(),
      active: z.boolean().default(true),
    })
    .parse(input);
  const user = await actor(db, actorId, ['ADMIN']);
  return db.$transaction(async (tx) => {
    if (
      !(await tx.company.findFirst({
        where: {
          id: data.companyId,
          organizationId: user.organizationId,
          ...(data.id ? {} : { active: true }),
        },
      }))
    )
      throw new AppError('Filial indisponível.');
    const { id, ...values } = data;
    if (id) {
      const unit = await tx.unit.findFirst({
        where: { id, company: { organizationId: user.organizationId } },
      });
      if (!unit) throw new AppError('Unidade não encontrada.', 404);
      if (unit.companyId !== data.companyId)
        throw new AppError(
          'A filial de uma unidade não pode mudar. Desative e crie outra unidade para preservar o histórico.',
        );
      return tx.unit.update({ where: { id }, data: values });
    }
    return tx.unit.create({ data: values });
  });
}
