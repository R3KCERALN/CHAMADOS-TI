import 'dotenv/config';
import { parse } from 'dotenv';
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const source = new URL(process.env.DATABASE_URL);
const dbName = 'central_suporte_demo';
source.pathname = `/${dbName}`;
if (!existsSync('.env.demo'))
  writeFileSync(
    '.env.demo',
    `DATABASE_URL=${source.toString()}\nAPP_URL=http://localhost:3002\nAPP_TIMEZONE=${process.env.APP_TIMEZONE || 'America/Belem'}\nCOOKIE_SECURE=false\nAPP_ORGANIZATION_ID=initial-organization\nINITIAL_ADMIN_USERNAME=demo.admin\nINITIAL_ADMIN_NAME=Administrador Demonstração\nINITIAL_ADMIN_PASSWORD=${randomBytes(18).toString('base64url')}\nDEMO_PASSWORD=${randomBytes(18).toString('base64url')}\nSEED_DEMO=true\n`,
    { flag: 'wx', mode: 0o600 },
  );
if (!parse(readFileSync('.env.demo')).APP_ORGANIZATION_ID)
  appendFileSync('.env.demo', '\nAPP_ORGANIZATION_ID=initial-organization\n');
const env = { ...process.env, ...parse(readFileSync('.env.demo')) };
const demoUrl = new URL(env.DATABASE_URL);
if (demoUrl.pathname !== `/${dbName}`)
  throw new Error('O arquivo .env.demo deve apontar exclusivamente para central_suporte_demo.');
const adminUrl = new URL(demoUrl);
adminUrl.pathname = '/postgres';
const client = new Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
  if (!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName])).rowCount)
    await client.query(`CREATE DATABASE "${dbName}"`);
} finally {
  await client.end();
}
for (const args of [
  ['run', 'db:migrate'],
  ['run', 'db:seed'],
  ['exec', '--', 'tsx', 'prisma/seed-demo.ts'],
]) {
  const result = spawnSync('npm', args, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(
  'Banco da aplicação preservado. Execute npm run demo:start e abra http://localhost:3002. Credenciais em .env.demo.',
);
