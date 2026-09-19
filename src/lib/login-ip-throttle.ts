import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { db } from './db';
import { AppError } from './errors';
import { APP_ORGANIZATION_ID } from './config';

// Only called behind our private app network; Caddy overwrites X-Client-IP.
export async function limitLoginAddress(address: string | null) {
  if (!address || !isIP(address)) throw new AppError('Origem de acesso inválida.', 403);
  const key = createHash('sha256').update(`ip:${APP_ORGANIZATION_ID}:${address}`).digest('hex');
  const now = new Date();
  await db.loginThrottle.deleteMany({ where: { key, expiresAt: { lt: now } } });
  const limit = await db.loginThrottle.upsert({
    where: { key },
    create: { key, expiresAt: new Date(now.getTime() + 15 * 60 * 1000) },
    update: { attempts: { increment: 1 } },
  });
  // Shared corporate IPs require a higher limit than the existing per-account limit.
  if (limit.attempts > 100)
    throw new AppError('Muitas tentativas. Aguarde 15 minutos e tente novamente.', 429);
}
