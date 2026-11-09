import pg from 'pg';
import { spawnSync } from 'node:child_process';
const mode = process.argv[2];
if (!['migrate', 'bootstrap', 'grant'].includes(mode)) throw new Error('Invalid operation');
for (const key of [
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'APP_DB_USER',
  'APP_DB_PASSWORD',
]) {
  if (!process.env[key]) throw new Error(`Missing configuration: ${key}`);
}
const { POSTGRES_USER: owner, APP_DB_USER: user, APP_DB_PASSWORD: password } = process.env;
if (!/^[a-z][a-z0-9_]{2,62}$/.test(user) || user === owner)
  throw new Error('Use a distinct application role');
const url = new URL('postgresql://db:5432');
url.username = owner;
url.password = process.env.POSTGRES_PASSWORD;
url.pathname = `/${process.env.POSTGRES_DB}`;
const client = new pg.Client({ connectionString: url.href });
try {
  await client.connect();
  if (mode !== 'grant') {
    const command =
      mode === 'migrate' ? ['prisma', 'migrate', 'deploy'] : ['tsx', 'prisma/seed.ts'];
    const result = spawnSync(`node_modules/.bin/${command[0]}`, command.slice(1), {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: url.href },
    });
    if (result.status !== 0) throw new Error('Database operation failed');
  }
  // quote_ident/quote_literal are evaluated in PostgreSQL, never interpolate raw credentials.
  const {
    rows: [quoted],
  } = await client.query('SELECT quote_ident($1) AS role, quote_literal($2) AS password', [
    user,
    password,
  ]);
  await client.query('BEGIN');
  // A failed credential rotation must not put the ALTER ROLE statement in database logs.
  await client.query("SET LOCAL log_min_error_statement = 'panic'");
  await client.query("SET LOCAL log_statement = 'none'");
  await client.query('SELECT pg_advisory_xact_lock(817215)');
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [user]);
  await client.query(
    `${exists.rowCount ? 'ALTER' : 'CREATE'} ROLE ${quoted.role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${quoted.password}`,
  );
  await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${quoted.role}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoted.role}`,
  );
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quoted.role}`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quoted.role}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quoted.role}`,
  );
  // Migration bookkeeping is never writable by the web process.
  await client.query(`REVOKE ALL ON TABLE "_prisma_migrations" FROM ${quoted.role}`);
  // Audit history is append-only for the web process: it only inserts and reads these rows.
  await client.query(
    `REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "TicketEvent", "UserAudit", "TicketComment" FROM ${quoted.role}`,
  );
  await client.query('COMMIT');
  console.log(`database_${mode}_complete`);
} catch {
  console.error(`database_${mode}_failed`);
  process.exitCode = 1;
} finally {
  await client.end();
}
