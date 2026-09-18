import 'dotenv/config';
import { Client } from 'pg';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
const original = new URL(process.env.DATABASE_URL);
const testName = `central_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
const adminUrl = new URL(original);
adminUrl.pathname = '/postgres';
const client = new Client({ connectionString: adminUrl.toString() });
await client.connect();
const testUrl = new URL(original);
testUrl.pathname = `/${testName}`;
const env = {
  ...process.env,
  DATABASE_URL: testUrl.toString(),
  APP_URL: 'http://localhost:3100',
  COOKIE_SECURE: 'false',
  TEST_DATABASE_NAME: testName,
  INITIAL_ADMIN_USERNAME: 'admin.teste',
  INITIAL_ADMIN_NAME: 'Admin de teste',
  INITIAL_ADMIN_PASSWORD: randomBytes(18).toString('base64url'),
  TEST_PASSWORD: randomBytes(18).toString('base64url'),
};
function run(args) {
  const result = spawnSync('npm', args, { stdio: 'inherit', env });
  if (result.status !== 0) throw new Error(`Falha: npm ${args.join(' ')}`);
}
try {
  await client.query(`CREATE DATABASE "${testName}"`);
  run(['run', 'db:migrate']);
  if (process.argv.includes('--e2e')) {
    run(['run', 'db:seed']);
    run(['exec', '--', 'playwright', 'test']);
  } else run(['exec', '--', 'tsx', '--test', '--test-concurrency=1', 'tests/critical.test.ts']);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  // Only the unique database created by this invocation is removed; never touch application data.
  if (!/^central_test_\d+_[a-f0-9]{8}$/.test(testName))
    throw new Error('Nome do banco de teste inválido');
  await client.query(`DROP DATABASE IF EXISTS "${testName}" WITH (FORCE)`);
  await client.end();
}
