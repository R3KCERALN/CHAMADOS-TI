import { pushConfig } from './push-config';

// NODE_ENV=production also serves local builds; APP_ENV explicitly selects VPS rules.
export function validateProductionConfig(env: Record<string, string | undefined> = process.env) {
  if (env.APP_ENV !== 'production') return;
  const required = ['DATABASE_URL', 'APP_URL', 'APP_DOMAIN', 'APP_ORGANIZATION_ID', 'APP_TIMEZONE'];
  for (const name of required) {
    if (!env[name]) throw new Error(`Missing production configuration: ${name}`);
  }
  let valid = false;
  try {
    const url = new URL(env.APP_URL!);
    const db = new URL(env.DATABASE_URL!);
    valid =
      url.protocol === 'https:' &&
      url.host === env.APP_DOMAIN &&
      url.href === `${url.origin}/` &&
      !url.username &&
      !url.password &&
      ['postgresql:', 'postgres:'].includes(db.protocol) &&
      !!db.password &&
      !/(?:_demo|central_test_)/.test(db.pathname);
    new Intl.DateTimeFormat('pt-BR', { timeZone: env.APP_TIMEZONE });
  } catch {
    /* Report only the field group, never its values. */
  }
  if (!valid) throw new Error('Invalid production URL, database or timezone configuration');
  if (env.COOKIE_SECURE !== 'true' || env.SEED_DEMO === 'true')
    throw new Error('Production requires secure cookies and forbids demo seeds');
  if (
    env.PUSH_WORKER_ENABLED !== 'true' ||
    !env.VAPID_PUBLIC_KEY ||
    !env.VAPID_PRIVATE_KEY ||
    !env.VAPID_SUBJECT
  )
    throw new Error('Production requires the persistent Web Push worker and VAPID configuration');
}

export function validateRuntime() {
  validateProductionConfig();
  // Existing validation checks that both keys match, without logging key material.
  pushConfig();
}
