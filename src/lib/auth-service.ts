import { randomBytes, createHash } from 'node:crypto';
import argon2 from 'argon2';
import { db } from './db';
import { APP_ORGANIZATION_ID } from './config';
import { AppError } from './errors';
import { loginThrottleAddress } from './login-ip-throttle';
import { passwordSchema, usernameSchema } from './validation';
export const publicUserSelect = {
  id: true,
  name: true,
  username: true,
  departmentId: true,
  organizationId: true,
  teamId: true,
  organization: { select: { id: true, name: true, active: true } },
  primaryCompanyId: true,
  primaryUnitId: true,
  role: true,
  active: true,
  mustChangePassword: true,
  stockKeeper: true,
} as const;
export const hashPassword = (password: string) =>
  argon2.hash(passwordSchema.parse(password), {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
async function consumeAttempt(key: string, limit: number, expiresAt: Date) {
  const throttle = await db.loginThrottle.upsert({
    where: { key },
    create: { key, expiresAt },
    update: { attempts: { increment: 1 } },
  });
  if (throttle.attempts > limit)
    throw new AppError('Muitas tentativas. Aguarde 15 minutos e tente novamente.', 429);
}
let dummyHash: Promise<string> | undefined;
export async function login(username: string, password: string, address?: string | null) {
  const parsed = usernameSchema.safeParse(username);
  if (!parsed.success || password.length > 128)
    throw new AppError('Usuário ou senha inválidos.', 401);
  const accountKey = tokenHash(`${APP_ORGANIZATION_ID}:${parsed.data}`);
  const throttles = address
    ? [
        {
          key: tokenHash(
            `${APP_ORGANIZATION_ID}:${parsed.data}:ip:${loginThrottleAddress(address)}`,
          ),
          limit: 10,
        },
        { key: accountKey, limit: 50 },
      ]
    : [{ key: accountKey, limit: 10 }];
  const now = new Date();
  await db.loginThrottle.deleteMany({ where: { expiresAt: { lt: now } } });
  const windowEnd = new Date(Date.now() + 15 * 60 * 1000);
  for (const { key, limit } of throttles) await consumeAttempt(key, limit, windowEnd);
  const user = await db.user.findFirst({
    where: { username: parsed.data, organizationId: APP_ORGANIZATION_ID },
    include: { organization: true },
  });
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  const valid = await argon2.verify(user?.passwordHash ?? (await dummyHash), password);
  if (!user?.active || !user.organization.active || !valid)
    throw new AppError('Usuário ou senha inválidos.', 401);
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await db.$transaction(async (tx) => {
    // Serialize against account changes so deactivation/reset cannot leave a fresh valid session.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { organization: true },
    });
    if (
      !current.active ||
      !current.organization.active ||
      current.passwordHash !== user.passwordHash
    )
      throw new AppError('Usuário ou senha inválidos.', 401);
    await tx.session.deleteMany({ where: { expiresAt: { lt: now } } });
    await tx.session.create({ data: { tokenHash: tokenHash(token), userId: user.id, expiresAt } });
    await tx.loginThrottle.deleteMany({ where: { key: { in: throttles.map(({ key }) => key) } } });
  });
  return { token, expiresAt, mustChangePassword: user.mustChangePassword };
}
export async function getSessionUser(token: string | undefined) {
  if (!token || token.length > 128) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: { select: publicUserSelect } },
  });
  return session &&
    session.expiresAt > new Date() &&
    session.user.active &&
    session.user.organization.active &&
    session.user.organizationId === APP_ORGANIZATION_ID
    ? session.user
    : null;
}
export async function logout(token: string | undefined) {
  if (token)
    await db.$transaction(async (tx) => {
      const session = await tx.session.findUnique({
        where: { tokenHash: tokenHash(token) },
        select: { userId: true },
      });
      if (session) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${session.userId} FOR UPDATE`;
      await tx.pushSubscription.deleteMany({ where: { sessionHash: tokenHash(token) } });
      await tx.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
    });
}
export const passwordChangeThrottleKey = (userId: string) =>
  tokenHash(`${APP_ORGANIZATION_ID}:change-password:${userId}`);
export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  if (currentPassword === newPassword)
    throw new AppError('A nova senha deve ser diferente da senha atual.');
  passwordSchema.parse(newPassword);
  const throttleKey = passwordChangeThrottleKey(userId);
  const now = new Date();
  await db.loginThrottle.deleteMany({ where: { expiresAt: { lt: now } } });
  await consumeAttempt(throttleKey, 10, new Date(now.getTime() + 15 * 60 * 1000));
  const verified = await db.user.findUnique({ where: { id: userId } });
  if (
    !verified ||
    currentPassword.length > 128 ||
    !(await argon2.verify(verified.passwordHash, currentPassword))
  )
    throw new AppError('Senha atual incorreta.');
  const hash = await hashPassword(newPassword);
  await db.$transaction(async (tx) => {
    // Argon2 runs outside the lock; re-check that the verified hash is still the current one.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { organization: true },
    });
    if (!user?.active || !user.organization.active || user.passwordHash !== verified.passwordHash)
      throw new AppError('Senha atual incorreta.');
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash: hash, mustChangePassword: false },
    });
    await tx.session.deleteMany({ where: { userId } });
    await tx.pushSubscription.updateMany({ where: { userId }, data: { active: false } });
    await tx.userAudit.create({
      data: { actorId: userId, subjectId: userId, action: 'SENHA_ALTERADA' },
    });
    await tx.loginThrottle.deleteMany({ where: { key: throttleKey } });
  });
}
