import { z } from 'zod';
import { db } from './db';
import { AppError } from './errors';
import { requireTeam } from './teams';
import { stockActor } from './stock-access';
import { canSee } from './services';
import { queueStockAlertNotifications } from './stock-notifications';
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
  expected?: { itemId?: string; type?: StockMovementType; ticketId?: string; reversesId?: string },
): Promise<T> {
  await stockActor(db, actorId, 'view');
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
    if (
      expected &&
      Object.entries(expected).some(
        ([key, value]) => existing[key as keyof StockMovement] !== value,
      )
    )
      throw new AppError(
        'Este formulário já foi usado para outro lançamento. Recarregue a página.',
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
  actorId: string | null = null,
): Promise<StockAlert | null> {
  const open = await tx.stockAlert.findFirst({ where: { itemId: item.id, closedAt: null } });
  const low =
    item.kind === 'MATERIAL' && item.active && item.minimum !== null && balance.lte(item.minimum);
  if (low) {
    if (open) return null;
    const alert = await tx.stockAlert.create({
      data: {
        organizationId: item.organizationId,
        itemId: item.id,
        openedByMovementId: movementId,
      },
    });
    await queueStockAlertNotifications(tx, alert, actorId);
    return alert;
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
  if (move.delta.abs().gt(MAX_BALANCE))
    throw new AppError('A diferença da contagem passa do limite permitido. Confira a quantidade.');
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
  await syncAlert(tx, updated, balance, movement.id, actor.id);
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
        // Creation without an entry has no movement to replay. Keep its request in the existing
        // immutable creation audit and serialize this request across concurrent submissions.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.organizationId}), hashtext(${requestId}))`;
        const created = await tx.stockItemAudit.findFirst({
          where: {
            organizationId: user.organizationId,
            action: 'CRIADO',
            metadata: { path: ['requestId'], equals: requestId },
          },
        });
        if (created) {
          if (created.actorId !== actorId)
            throw new AppError(
              'Este formulário já foi enviado por outra pessoa. Recarregue a página.',
              409,
            );
          const item = await tx.stockItem.findUniqueOrThrow({ where: { id: created.itemId } });
          const movement = await tx.stockMovement.findUnique({
            where: { organizationId_requestId: { organizationId: user.organizationId, requestId } },
          });
          return { item, movement };
        }
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
              requestId,
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
          await syncAlert(tx, item, item.balance, null, user.id);
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
    async (movement) => {
      const audit = await db.stockItemAudit.findFirst({
        where: {
          itemId: movement.itemId,
          actorId,
          action: 'CRIADO',
          metadata: { path: ['requestId'], equals: input.requestId },
        },
      });
      if (!audit)
        throw new AppError(
          'Este formulário já foi usado para outro lançamento. Recarregue a página.',
          409,
        );
      return {
        item: await db.stockItem.findUniqueOrThrow({ where: { id: movement.itemId } }),
        movement,
      };
    },
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
      if ('minimum' in after) await syncAlert(tx, updated, updated.balance, null, user.id);
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
    { itemId, type: 'ENTRADA' },
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
    { itemId, type: 'AJUSTE' },
  );
}
/**
 * "Peguei": a single conditional UPDATE decides the race. Two concurrent takes serialize on the
 * row; the loser re-evaluates `holderId IS NULL`, updates nothing and gets a 409.
 */
export async function takeTool(actorId: string, itemId: string): Promise<StockMovement> {
  return db.$transaction(async (tx) => {
    const user = await stockActor(tx, actorId, 'operate');
    const where = { id: itemId, organizationId: user.organizationId };
    const result = await tx.stockItem.updateMany({
      where: { ...where, kind: 'FERRAMENTA', active: true, holderId: null },
      data: { holderId: user.id, heldSince: new Date() },
    });
    if (result.count !== 1) {
      const item = await tx.stockItem.findFirst({ where });
      if (!item) throw new AppError('Item não encontrado.', 404);
      if (item.kind !== 'FERRAMENTA') throw new AppError('Este item não é uma ferramenta.');
      if (!item.active) throw new AppError('Esta ferramenta está desativada.', 409);
      if (item.holderId === user.id) throw new AppError('Esta ferramenta já está com você.', 409);
      throw new AppError('Esta ferramenta já está com outra pessoa. Atualize a página.', 409);
    }
    const item = await tx.stockItem.findUniqueOrThrow({ where: { id: itemId } });
    return tx.stockMovement.create({
      data: {
        organizationId: user.organizationId,
        itemId: item.id,
        type: 'RETIRADA',
        actorId: user.id,
        itemTeamId: item.teamId,
        actorTeamId: user.teamId,
      },
    });
  });
}
/** "Devolvi": the holder, or a stock keeper for anyone (including a deactivated holder). */
export async function returnTool(actorId: string, itemId: string): Promise<StockMovement> {
  return db.$transaction(async (tx) => {
    const user = await stockActor(tx, actorId, 'operate');
    const item = await lockItem(tx, itemId, user.organizationId);
    if (item.kind !== 'FERRAMENTA') throw new AppError('Este item não é uma ferramenta.');
    if (!item.holderId)
      throw new AppError('Esta ferramenta já está guardada. Atualize a página.', 409);
    if (item.holderId !== user.id && !user.keeper)
      throw new AppError(
        'Só quem está com a ferramenta ou um responsável de estoque pode devolvê-la.',
        403,
      );
    await tx.stockItem.update({
      where: { id: item.id },
      data: { holderId: null, heldSince: null },
    });
    return tx.stockMovement.create({
      data: {
        organizationId: user.organizationId,
        itemId: item.id,
        type: 'DEVOLUCAO',
        actorId: user.id,
        targetUserId: item.holderId,
        itemTeamId: item.teamId,
        actorTeamId: user.teamId,
      },
    });
  });
}
/** Deactivates a tool or a material. History stays; a held tool is released, an open alert closes. */
export async function deactivateItem(
  actorId: string,
  itemId: string,
  reason: string,
): Promise<StockItem> {
  return db.$transaction(async (tx) => {
    const user = await stockActor(tx, actorId, 'keep');
    const text = boundedText(
      reason,
      3,
      500,
      'Informe o motivo da desativação, com 3 a 500 caracteres.',
    );
    const item = await lockItem(tx, itemId, user.organizationId);
    if (!item.active) throw new AppError('Este item já está desativado.', 409);
    const updated = await tx.stockItem.update({
      where: { id: item.id },
      data: { active: false, deactivatedReason: text, holderId: null, heldSince: null },
    });
    await syncAlert(tx, updated, updated.balance, null, user.id);
    await tx.stockItemAudit.create({
      data: {
        organizationId: user.organizationId,
        itemId: item.id,
        actorId: user.id,
        action: 'DESATIVADO',
        metadata: { reason: text, holderId: item.holderId },
      },
    });
    return updated;
  });
}

const HOUR = 60 * 60 * 1000;
function withinTicketWindow(ticket: { status: string; resolvedAt: Date | null }) {
  return (
    ticket.status !== 'RESOLVIDO' ||
    (ticket.resolvedAt !== null && ticket.resolvedAt.getTime() >= Date.now() - 48 * HOUR)
  );
}
function participates(
  user: { id: string; role: string },
  ticket: {
    assigneeId: string | null;
    participants: { userId: string }[];
  },
) {
  return (
    user.role === 'ADMIN' ||
    ticket.assigneeId === user.id ||
    ticket.participants.some((p) => p.userId === user.id)
  );
}
export async function recordTicketUse(
  actorId: string,
  ticketId: string,
  input: {
    itemId: string;
    quantity: string;
    requestId: string;
  },
): Promise<StockMovement> {
  return withRequestId(
    actorId,
    input.requestId,
    (requestId) =>
      db.$transaction(async (tx) => {
        const user = await stockActor(tx, actorId, 'operate');
        await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${ticketId} AND "organizationId" = ${user.organizationId} FOR SHARE`;
        const ticket = await tx.ticket.findFirst({
          where: { id: ticketId, organizationId: user.organizationId },
          include: { participants: true },
        });
        if (!ticket || !canSee(user, ticket)) throw new AppError('Chamado não encontrado.', 404);
        if (!participates(user, ticket))
          throw new AppError('Só quem participa do chamado pode registrar materiais.', 403);
        if (!withinTicketWindow(ticket))
          throw new AppError(
            'O prazo de 48 horas depois da resolução acabou. Registre como uso fora de chamado, com foto.',
          );
        const item = await lockActiveMaterial(tx, input.itemId, user.organizationId);
        const quantity = parseQuantity(input.quantity);
        return applyMaterialMovement(tx, item, user, {
          type: 'USO_CHAMADO',
          quantity,
          delta: quantity.negated(),
          ticketId,
          ticketTeamId: ticket.teamId,
          requestId,
        });
      }),
    (movement) => movement,
  );
}
export async function reverseMovement(
  actorId: string,
  movementId: string,
  input: {
    reason: string;
    requestId: string;
  },
): Promise<StockMovement> {
  return withRequestId(
    actorId,
    input.requestId,
    (requestId) =>
      db.$transaction(async (tx) => {
        const user = await stockActor(tx, actorId, 'operate');
        const original = await tx.stockMovement.findFirst({
          where: { id: movementId, organizationId: user.organizationId },
        });
        if (!original) throw new AppError('Lançamento não encontrado.', 404);
        const item = await lockItem(tx, original.itemId, user.organizationId);
        const reversed = await tx.stockMovement.findUnique({ where: { reversesId: original.id } });
        if (reversed) {
          if (reversed.requestId === requestId && reversed.actorId === actorId) return reversed;
          throw new AppError('Este lançamento já foi estornado.', 409);
        }
        if (!['ENTRADA', 'USO_CHAMADO', 'USO_AVULSO'].includes(original.type))
          throw new AppError('Este tipo de lançamento não pode ser estornado.');
        if (
          !user.keeper &&
          (original.actorId !== actorId || original.createdAt.getTime() < Date.now() - 24 * HOUR)
        )
          throw new AppError(
            'Só quem lançou, em até 24 horas, ou um responsável de estoque pode estornar.',
            403,
          );
        const reason = boundedText(
          input.reason,
          3,
          500,
          'Informe o motivo do estorno, com 3 a 500 caracteres.',
        );
        return applyMaterialMovement(tx, item, user, {
          type: 'ESTORNO',
          quantity: original.quantity!,
          delta: original.delta!.negated(),
          reversesId: original.id,
          reason,
          requestId,
        });
      }),
    (movement) => movement,
  );
}
export async function ticketMaterials(actorId: string, ticketId: string) {
  const user = await stockActor(db, actorId, 'view');
  if (user.role !== 'TI' && user.role !== 'ADMIN')
    throw new AppError('Chamado não encontrado.', 404);
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, organizationId: user.organizationId },
    include: { participants: true },
  });
  if (!ticket || !canSee(user, ticket)) throw new AppError('Chamado não encontrado.', 404);
  const movements = await db.stockMovement.findMany({
    where: { ticketId, organizationId: user.organizationId, type: 'USO_CHAMADO' },
    include: {
      item: true,
      actor: { select: { name: true } },
      reversedBy: { select: { id: true } },
    },
    orderBy: { sequence: 'asc' },
  });
  const materials = await db.stockItem.findMany({
    where: { organizationId: user.organizationId, kind: 'MATERIAL', active: true },
    include: { team: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  return {
    movements: movements.map(({ reversedBy, ...m }) => ({ ...m, reversed: !!reversedBy })),
    canRecord: participates(user, ticket) && withinTicketWindow(ticket),
    materials: materials.map((m) => ({
      id: m.id,
      name: m.name,
      unit: m.unit,
      teamName: m.team.name,
    })),
  };
}

export async function recordOffTicketUse(
  actorId: string,
  input: {
    itemId: string;
    quantity: string;
    note?: string;
    requestId: string;
  },
  photo: import('./stock-photo').ProcessedPhoto,
): Promise<StockMovement> {
  return withRequestId(
    actorId,
    input.requestId,
    (requestId) =>
      db.$transaction(async (tx) => {
        const user = await stockActor(tx, actorId, 'operate');
        const item = await lockActiveMaterial(tx, input.itemId, user.organizationId);
        const quantity = parseQuantity(input.quantity);
        const note = boundedText(input.note, 0, 500, 'A observação pode ter até 500 caracteres.');
        const movement = await applyMaterialMovement(tx, item, user, {
          type: 'USO_AVULSO',
          quantity,
          delta: quantity.negated(),
          note,
          requestId,
        });
        await tx.stockPhoto.create({
          data: {
            movementId: movement.id,
            organizationId: user.organizationId,
            ...photo,
            data: new Uint8Array(photo.data),
          },
        });
        return movement;
      }),
    (movement) => movement,
  );
}
export async function authorizationPhoto(
  actorId: string,
  movementId: string,
): Promise<{ data: Uint8Array; mime: 'image/webp' }> {
  const user = await stockActor(db, actorId, 'view');
  const movement = await db.stockMovement.findFirst({
    where: { id: movementId, organizationId: user.organizationId, type: 'USO_AVULSO' },
  });
  if (!movement || (!['ADMIN', 'GESTOR'].includes(user.role) && movement.actorId !== user.id))
    throw new AppError('Foto não encontrada.', 404);
  const photo = await db.stockPhoto.findUnique({ where: { movementId } });
  if (!photo) throw new AppError('Foto removida após o prazo de guarda.', 404);
  return { data: photo.data, mime: 'image/webp' };
}

export async function markReplenishmentRequested(actorId: string, alertId: string) {
  return db.$transaction(async (tx) => {
    const user = await stockActor(tx, actorId, 'view');
    const alert = await tx.stockAlert.findFirst({
      where: { id: alertId, organizationId: user.organizationId },
    });
    if (!alert) throw new AppError('Alerta não encontrado.', 404);
    const result = await tx.stockAlert.updateMany({
      where: {
        id: alertId,
        organizationId: user.organizationId,
        closedAt: null,
        requestedById: null,
      },
      data: { requestedById: user.id, requestedAt: new Date() },
    });
    if (result.count !== 1)
      throw new AppError('Alguém já marcou este pedido. Atualize a página.', 409);
  });
}

export async function stockOverview(
  actorId: string,
  input: {
    aba?: 'ferramentas' | 'materiais' | 'acabando';
    team?: string;
    q?: string;
    page?: number;
  },
) {
  const user = await stockActor(db, actorId, 'view');
  const page = Math.max(1, Math.min(100000, Math.trunc(input.page || 1)));
  const base = { organizationId: user.organizationId, active: true };
  const where: Prisma.StockItemWhereInput = {
    ...base,
    ...(input.team && { teamId: z.string().max(100).parse(input.team) }),
    ...(input.q && { name: { contains: z.string().max(100).parse(input.q), mode: 'insensitive' } }),
    ...(input.aba === 'acabando'
      ? { alerts: { some: { closedAt: null } } }
      : { kind: input.aba === 'materiais' ? 'MATERIAL' : 'FERRAMENTA' }),
  };
  const [items, total, ferramentas, materiais, acabando] = await Promise.all([
    db.stockItem.findMany({
      where,
      include: {
        team: true,
        holder: { select: { id: true, name: true } },
        alerts: { where: { closedAt: null }, include: { requestedBy: { select: { name: true } } } },
      },
      orderBy: { name: 'asc' },
      take: 20,
      skip: (page - 1) * 20,
    }),
    db.stockItem.count({ where }),
    db.stockItem.count({ where: { ...base, kind: 'FERRAMENTA' } }),
    db.stockItem.count({ where: { ...base, kind: 'MATERIAL' } }),
    db.stockAlert.count({ where: { organizationId: user.organizationId, closedAt: null } }),
  ]);
  return {
    items,
    total,
    page,
    counts: { ferramentas, materiais, acabando },
    keeper: user.keeper,
    canOperate: ['TI', 'ADMIN'].includes(user.role),
  };
}
export async function lowStockCount(actorId: string): Promise<number> {
  const user = await stockActor(db, actorId, 'view');
  return db.stockAlert.count({ where: { organizationId: user.organizationId, closedAt: null } });
}
export async function stockItemDetail(actorId: string, itemId: string, page = 1) {
  const user = await stockActor(db, actorId, 'view');
  const item = await db.stockItem.findFirst({
    where: { id: itemId, organizationId: user.organizationId },
    include: { team: true, holder: { select: { name: true } } },
  });
  if (!item) throw new AppError('Item não encontrado.', 404);
  page = Math.max(1, Math.min(100000, Math.trunc(page) || 1));
  const [movements, total, alert] = await Promise.all([
    db.stockMovement.findMany({
      where: { itemId },
      include: {
        actor: { select: { name: true } },
        targetUser: { select: { name: true } },
        reversedBy: { select: { id: true } },
      },
      orderBy: { sequence: 'desc' },
      take: 30,
      skip: (page - 1) * 30,
    }),
    db.stockMovement.count({ where: { itemId } }),
    db.stockAlert.findFirst({ where: { itemId, closedAt: null } }),
  ]);
  return {
    item,
    alert,
    total,
    page,
    keeper: user.keeper,
    movements: movements.map(({ reversedBy, ...m }) => ({
      ...m,
      reversed: !!reversedBy,
      canReverse:
        !reversedBy &&
        ['ENTRADA', 'USO_CHAMADO', 'USO_AVULSO'].includes(m.type) &&
        (user.keeper ||
          (user.role === 'TI' &&
            m.actorId === user.id &&
            m.createdAt.getTime() >= Date.now() - 24 * HOUR)),
    })),
  };
}
