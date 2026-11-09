import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProductionConfig } from '../src/lib/production-config';
const valid = {
  APP_ENV: 'production',
  DATABASE_URL: 'postgresql://app:example@db/production',
  APP_URL: 'https://support.example.invalid',
  APP_DOMAIN: 'support.example.invalid',
  APP_ORGANIZATION_ID: 'initial-organization',
  APP_TIMEZONE: 'America/Belem',
  COOKIE_SECURE: 'true',
  PUSH_WORKER_ENABLED: 'true',
  VAPID_PUBLIC_KEY: 'validated-by-pushConfig',
  VAPID_PRIVATE_KEY: 'validated-by-pushConfig',
  VAPID_SUBJECT: 'mailto:example@example.invalid',
};
test('production configuration rejects unsafe URLs, cookies, demo and missing worker config', () => {
  assert.doesNotThrow(() => validateProductionConfig(valid));
  for (const change of [
    { APP_URL: 'http://support.example.invalid' },
    { APP_DOMAIN: 'other.example.invalid' },
    { APP_URL: 'https://support.example.invalid/path' },
    { COOKIE_SECURE: 'false' },
    { SEED_DEMO: 'true' },
    { APP_ORGANIZATION_ID: '' },
    { VAPID_PRIVATE_KEY: '' },
    { PUSH_WORKER_ENABLED: 'false' },
    { DATABASE_URL: 'postgresql://app:secret@db/central_suporte_demo' },
  ])
    assert.throws(() => validateProductionConfig({ ...valid, ...change }));
  assert.doesNotThrow(() => validateProductionConfig({ NODE_ENV: 'production' }));
});

test('production IP throttle is persistent and rejects forged or missing addresses', async () => {
  const { limitLoginAddress } = await import('../src/lib/login-ip-throttle');
  const { db } = await import('../src/lib/db');
  const { createHash } = await import('node:crypto');
  const { APP_ORGANIZATION_ID } = await import('../src/lib/config');
  const address = '192.0.2.231';
  const key = createHash('sha256').update(`ip:${APP_ORGANIZATION_ID}:${address}`).digest('hex');
  await assert.rejects(limitLoginAddress(null));
  await assert.rejects(limitLoginAddress('192.0.2.1, 192.0.2.2'));
  await db.loginThrottle.upsert({
    where: { key },
    create: { key, attempts: 99, expiresAt: new Date(Date.now() + 60000) },
    update: { attempts: 99, expiresAt: new Date(Date.now() + 60000) },
  });
  await limitLoginAddress(address);
  await assert.rejects(limitLoginAddress(address), /Muitas tentativas/);
  await db.loginThrottle.update({ where: { key }, data: { expiresAt: new Date(0) } });
  await limitLoginAddress(address);
  await db.loginThrottle.delete({ where: { key } });
});

test('endereço do limite de login agrupa IPv6 por /64 e reconhece IPv4 mapeado', async () => {
  const { loginThrottleAddress } = await import('../src/lib/login-ip-throttle');
  for (const [address, expected] of [
    ['192.0.2.1', '192.0.2.1'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:DB8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002::9', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::1%eth0', '2001:db8:1:2::/64'],
    ['2001:db8:1:2:3:4:192.0.2.1', '2001:db8:1:2::/64'],
    ['2001:db8:1:3::1', '2001:db8:1:3::/64'],
    ['1::', '1:0:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['::ffff:192.0.2.1', '192.0.2.1'],
    ['::ffff:c000:201', '192.0.2.1'],
  ])
    assert.equal(loginThrottleAddress(address), expected, address);
});

test('limite por IP conta a mesma /64 em conjunto e não mistura outras redes', async () => {
  const { limitLoginAddress } = await import('../src/lib/login-ip-throttle');
  const { db } = await import('../src/lib/db');
  const { createHash } = await import('node:crypto');
  const { APP_ORGANIZATION_ID } = await import('../src/lib/config');
  const hashKey = (network: string) =>
    createHash('sha256').update(`ip:${APP_ORGANIZATION_ID}:${network}`).digest('hex');
  const key = hashKey('2001:db8:5:6::/64');
  await db.loginThrottle.create({
    data: { key, attempts: 99, expiresAt: new Date(Date.now() + 60000) },
  });
  await limitLoginAddress('2001:db8:5:6::1');
  await assert.rejects(limitLoginAddress('2001:db8:5:6:ffff::2'), /Muitas tentativas/);
  await limitLoginAddress('2001:db8:5:7::1');
  await db.loginThrottle.deleteMany({
    where: { key: { in: [key, hashKey('2001:db8:5:7::/64')] } },
  });
});
