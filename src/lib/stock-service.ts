import { z } from 'zod';
import { db } from './db';
import { AppError } from './errors';
import { requireTeam } from './teams';
import { stockActor } from './stock-access';
import {
  Prisma,
  StockItemKind,
  StockUnit,
  type StockAlert,
  type StockItem,
  type StockMovement,
  type StockMovementType,
} from '@/generated/prisma/client';
type Tx = Prisma.TransactionClient;
const QUANTITY = /^\d{1,9}([.,]\d{1,3})?$/;
// NUMERIC(12,3) bound for the running balance.
const MAX_BALANCE = new Prisma.Decimal('999999999.999');
const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
export function parseQuantity(value: string, { allowZero = false } = {}): Prisma.Decimal {
  const text = String(value ?? '').trim();
  const quantity = QUANTITY.test(text) ? new Prisma.Decimal(text.replace(',', '.')) : null;
  if (!quantity || (!allowZero && quantity.isZero()))
    throw new AppError(
      allowZero
        ? 'Informe uma quantidade de zero ou mais, com até 3 casas decimais.'
        : 'Informe uma quantidade maior que zero, com até 3 casas decimais.',
    );
  return quantity;
}
const optionalQuantity = (value: string | null | undefined) =>
  value == null || String(value).trim() === '' ? null : parseQuantity(value, { allowZero: true });
function boundedText(value: string | null | undefined, min: number, max: number, message: string) {
  const text = String(value ?? '').trim();
  if (text.length < min || text.length > max) throw new AppError(message);
  return text;
}
const decimalText = (value: Prisma.Decimal | null) => (value === null ? null : value.toString());
/**
 * Form idempotency for movements: a repeated submit with the same requestId (double tap on a slow
 * network) returns the movement already written instead of writing it again. The unique index
 * (organizationId, requestId) aborts the second transaction; the conflict is resolved here,
 * outside it, so the replay sees the committed movement.
 */
export async function withRequestId<T>(
  actorId: string,
  requestId: unknown,
  run: (requestId: string) => Promise<T>,
  replay: (movement: StockMovement) => T | Promise<T>,
): Promise<T> {
  const parsed = z.uuid().safeParse(requestId);
  if (!parsed.success)
    throw new AppError('Formulário expirado. Recarregue a página e tente novamente.');
  try {
    return await run(parsed.data);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const user = await db.user.findUnique({
      where: { id: actorId },
      select: { organizationId: true },
    });
    const existing =
      user &&
      (await db.stockMovement.findUnique({
        where: {
          organizationId_requestId: { organizationId: user.organizationId, requestId: parsed.data },
        },
      }));
    if (!existing) throw error;
    if (existing.actorId !== actorId)
      throw new AppError(
        'Este formulário já foi enviado por outra pessoa. Recarregue a página.',
        409,
      );
    return replay(existing);
  }
}
export async function lockItem(tx: Tx, itemId: string, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM "StockItem" WHERE id = ${itemId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  const item = await tx.stockItem.findFirst({ where: { id: itemId, organizationId } });
  if (!item) throw new AppError('Item não encontrado.', 404);
  return item;
}
/** Locks an active material for a balance movement. */
export async function lockActiveMaterial(tx: Tx, itemId: string, organizationId: string) {
  const item = await lockItem(tx, itemId, organizationId);
  if (item.kind !== 'MATERIAL') throw new AppError('Este item não é um material.');
  if (!item.active) throw new AppError('Este material está desativado.');
  return item;
}
/**
 * Opens or closes the minimum-stock alert. The caller must hold the item row lock, so the check
 * and the insert are serialized and an alert opens exactly once per drop.
 */
export async function syncAlert(
  tx: Tx,
  item: StockItem,
  balance: Prisma.Decimal,
  movementId: string | null,
): Promise<StockAlert | null> {
  const open = await tx.stockAlert.findFirst({ where: { itemId: item.id, closedAt: null } });
  const low =
    item.kind === 'MATERIAL' && item.active && item.minimum !== null && balance.lte(item.minimum);
  if (low) {
    if (open) return null;
    return tx.stockAlert.create({
      data: {
        organizationId: item.organizationId,
        itemId: item.id,
        openedByMovementId: movementId,
      },
    });
  }
  if (open)
    await tx.stockAlert.update({
      where: { id: open.id },
      data: { closedAt: new Date(), closedByMovementId: movementId },
    });
  return null;
}
/** Writes a material movement and the new balance. The item must come from lockItem in this tx. */
export async function applyMaterialMovement(
  tx: Tx,
  item: StockItem,
  actor: { id: string; teamId: string | null },
  move: {
    type: StockMovementType;
    quantity: Prisma.Decimal;
    delta: Prisma.Decimal;
    ticketId?: string;
    ticketTeamId?: string;
    reversesId?: string;
    reason?: string;
    note?: string;
    requestId?: string;
  },
): Promise<StockMovement> {
  if (item.kind !== 'MATERIAL') throw new AppError('Este item não é um material.');
  const balance = item.balance.plus(move.delta);
  if (balance.abs().gt(MAX_BALANCE))
    throw new AppError('O saldo passaria do limite permitido. Confira a quantidade.');
  const use = move.type === 'USO_CHAMADO' || move.type === 'USO_AVULSO';
  const needsCount =
    move.type === 'AJUSTE' ? false : item.needsCount || (use && move.quantity.gt(item.balance));
  const movement = await tx.stockMovement.create({
    data: {
      organizationId: item.organizationId,
      itemId: item.id,
      type: move.type,
      quantity: move.quantity,
      delta: move.delta,
      balanceAfter: balance,
      actorId: actor.id,
      ticketId: move.ticketId,
      reversesId: move.reversesId,
      reason: move.reason,
      note: move.note,
      requestId: move.requestId,
      itemTeamId: item.teamId,
      actorTeamId: actor.teamId,
      ticketTeamId: move.ticketTeamId,
    },
  });
  const updated = await tx.stockItem.update({
    where: { id: item.id },
    data: { balance, needsCount },
  });
  await syncAlert(tx, updated, balance, movement.id);
  return movement;
}
type ItemInput = {
  name: string;
  teamId: string;
  unit?: string | null;
  minimum?: string | null;
};
async function itemFields(tx: Tx, organizationId: string, kind: StockItemKind, input: ItemInput) {
  const name = boundedText(input.name, 2, 80, 'Informe um nome de 2 a 80 caracteres.');
  const team = await requireTeam(tx, organizationId, input.teamId);
  if (kind === 'FERRAMENTA') return { name, teamId: team.id, unit: null, minimum: null };
  const unit = Object.values(StockUnit).find((u) => u === input.unit);
  if (!unit) throw new AppError('Selecione a unidade.');
  return { name, teamId: team.id, unit, minimum: optionalQuantity(input.minimum) };
}
function duplicateName(error: unknown): never {
  if (isUniqueViolation(error)) throw new AppError('Já existe um item com este nome.', 409);
  throw error;
}
export async function createItem(
  actorId: string,
  input: ItemInput & { kind: string; initialQuantity?: string | null; requestId: string },
): Promise<{ item: StockItem; movement: StockMovement | null }> {
  return withRequestId(
    actorId,
    input.requestId,
    (requestId) =>
      db.$transaction(async (tx) => {
        const user = await stockActor(tx, actorId, 'keep');
        const kind = Object.values(StockItemKind).find((k) => k === input.kind);
        if (!kind) throw new AppError('Selecione o tipo do item.');
        const fields = await itemFields(tx, user.organizationId, kind, input);
        const initial = kind === 'MATERIAL' ? optionalQuantity(input.initialQuantity) : null;
        const item = await tx.stockItem.create({
          data: { organizationId: user.organizationId, kind, ...fields },
        });
        await tx.stockItemAudit.create({
          data: {
            organizationId: user.organizationId,
            itemId: item.id,
            actorId: user.id,
            action: 'CRIADO',
            metadata: {
              kind,
              name: fields.name,
              teamId: fields.teamId,
              unit: fields.unit,
              minimum: decimalText(fields.minimum),
              initialQuantity: decimalText(initial),
            },
          },
        });
        if (!initial?.gt(0)) {
          await syncAlert(tx, item, item.balance, null);
          return { item, movement: null };
        }
        const movement = await applyMaterialMovement(tx, item, user, {
          type: 'ENTRADA',
          quantity: initial,
          delta: initial,
          requestId,
        });
        return { item: await tx.stockItem.findUniqueOrThrow({ where: { id: item.id } }), movement };
      }),
    async (movement) => ({
      item: await db.stockItem.findUniqueOrThrow({ where: { id: movement.itemId } }),
      movement,
    }),
  ).catch(duplicateName);
}
export async function updateItem(actorId: string, itemId: string, input: ItemInput) {
  return db
    .$transaction(async (tx) => {
      const user = await stockActor(tx, actorId, 'keep');
      const item = await lockItem(tx, itemId, user.organizationId);
      const next = await itemFields(tx, user.organizationId, item.kind, input);
      if (
        next.unit !== item.unit &&
        (await tx.stockMovement.findFirst({ where: { itemId: item.id }, select: { id: true } }))
      )
        throw new AppError('A unidade não pode mudar depois do primeiro movimento.');
      const current = {
        name: item.name,
        teamId: item.teamId,
        unit: item.unit,
        minimum: decimalText(item.minimum),
      };
      const wanted = { ...next, minimum: decimalText(next.minimum) };
      const before: Record<string, string | null> = {};
      const after: Record<string, string | null> = {};
      for (const key of Object.keys(current) as (keyof typeof current)[])
        if (current[key] !== wanted[key]) {
          before[key] = current[key];
          after[key] = wanted[key];
        }
      if (!Object.keys(after).length) return item;
      const updated = await tx.stockItem.update({ where: { id: item.id }, data: next });
      if ('minimum' in after) await syncAlert(tx, updated, updated.balance, null);
      await tx.stockItemAudit.create({
        data: {
          organizationId: user.organizationId,
          itemId: item.id,
          actorId: user.id,
          action: 'EDITADO',
          metadata: { before, after },
        },
      });
      return updated;
    })
    .catch(duplicateName);
}
export async function addEntry(
  actorId: string,
  itemId: string,
  input: { quantity: string; note?: string | null; requestId: string },
): Promise<StockMovement> {
  return withRequestId(
    actorId,
    input.requestId,
    (requestId) =>
      db.$transaction(async (tx) => {
        const user = await stockActor(tx, actorId, 'keep');
        const quantity = parseQuantity(input.quantity);
        const note =
          boundedText(input.note, 0, 500, 'A observação pode ter até 500 caracteres.') || undefined;
        const item = await lockActiveMaterial(tx, itemId, user.organizationId);
        return applyMaterialMovement(tx, item, user, {
          type: 'ENTRADA',
          quantity,
          delta: quantity,
          note,
          requestId,
        });
      }),
    (movement) => movement,
  );
}
export async function adjustCount(
  actorId: string,
  itemId: string,
  input: { counted: string; reason: string; requestId: string },
): Promise<StockMovement> {
  return withRequestId(
    actorId,
    input.requestId,
    (requestId) =>
      db.$transaction(async (tx) => {
        const user = await stockActor(tx, actorId, 'keep');
        const counted = parseQuantity(input.counted, { allowZero: true });
        const reason = boundedText(
          input.reason,
          3,
          500,
          'Informe o motivo do ajuste, com 3 a 500 caracteres.',
        );
        const item = await lockActiveMaterial(tx, itemId, user.organizationId);
        // A zero delta is still written: the recount is what clears "conferir saldo".
        return applyMaterialMovement(tx, item, user, {
          type: 'AJUSTE',
          quantity: counted,
          delta: counted.minus(item.balance),
          reason,
          requestId,
        });
      }),
    (movement) => movement,
  );
}
