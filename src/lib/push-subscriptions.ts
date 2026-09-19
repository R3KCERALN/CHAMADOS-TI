import { createHash, ECDH } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { actor } from './access';
import { AppError } from './errors';
import { validPushEndpoint } from './push-config';
export const sessionDigest = (token: string) => createHash('sha256').update(token).digest('hex');
const key = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine((v) => Buffer.from(v, 'base64url').length === bytes);
export const subscriptionSchema = z
  .object({
    endpoint: z.string().max(2048).refine(validPushEndpoint, 'Serviço push não permitido.'),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: key(65), auth: key(16) }).strict(),
  })
  .strict();
export async function saveSubscription(userId: string, token: string, input: unknown) {
  const data = subscriptionSchema.parse(input);
  try {
    ECDH.convertKey(Buffer.from(data.keys.p256dh, 'base64url'), 'prime256v1');
  } catch {
    throw new AppError('Chave de dispositivo inválida.');
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const user = await actor(tx, userId, ['TI', 'ADMIN', 'FUNCIONARIO']);
    const sessionHash = sessionDigest(token);
    if (
      !(await tx.session.findFirst({
        where: { tokenHash: sessionHash, userId, expiresAt: { gt: new Date() } },
      }))
    )
      throw new AppError('Sessão inválida.', 401);

    const endpointHash = sessionDigest(data.endpoint);
    const previous = await tx.pushSubscription.findUnique({ where: { endpointHash } });
    if (previous && (previous.userId !== userId || previous.organizationId !== user.organizationId))
      throw new AppError(
        'Este dispositivo está vinculado a outra conta. Saia dela antes de ativar.',
        409,
      );
    if (
      !previous?.active &&
      (await tx.pushSubscription.count({ where: { userId, active: true } })) >= 20
    )
      throw new AppError(
        'Limite de dispositivos atingido. Desative um dispositivo antes de adicionar outro.',
      );
    return tx.pushSubscription.upsert({
      where: { endpointHash },
      create: {
        endpointHash,
        endpoint: data.endpoint,
        ...data.keys,
        sessionHash,
        userId,
        organizationId: user.organizationId,
      },
      update: { ...data.keys, sessionHash, active: true },
      select: { id: true },
    });
  });
}
export async function removeSubscription(userId: string, input: unknown) {
  const { endpoint } = z
    .object({ endpoint: z.string().max(2048) })
    .strict()
    .parse(input);
  const user = await actor(db, userId, ['TI', 'ADMIN', 'FUNCIONARIO']);
  await db.pushSubscription.deleteMany({
    where: { userId, organizationId: user.organizationId, endpointHash: sessionDigest(endpoint) },
  });
}
