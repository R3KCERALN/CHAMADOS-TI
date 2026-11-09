import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { db } from './db';
import { AppError } from './errors';
import { APP_ORGANIZATION_ID } from './config';

function ipv6Groups(address: string) {
  const text = address
    .split('%')[0]
    .toLowerCase()
    .replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a, b, c, d) =>
      [(+a << 8) | +b, (+c << 8) | +d].map((group) => group.toString(16)).join(':'),
    );
  const [head, tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const gap = tail === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array<string>(gap).fill('0'), ...right].map((group) => parseInt(group, 16));
}
// A single host usually controls a whole IPv6 /64, so it counts as one source.
// IPv4-mapped addresses must keep their IPv4 identity: as a /64 they would all share one bucket.
export function loginThrottleAddress(address: string) {
  if (isIP(address) !== 6) return address;
  const groups = ipv6Groups(address);
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff)
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.');
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}
// Only called behind our private app network; Caddy overwrites X-Client-IP.
export async function limitLoginAddress(address: string | null) {
  if (!address || !isIP(address)) throw new AppError('Origem de acesso inválida.', 403);
  const key = createHash('sha256')
    .update(`ip:${APP_ORGANIZATION_ID}:${loginThrottleAddress(address)}`)
    .digest('hex');
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
