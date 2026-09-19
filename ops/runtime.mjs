// Compose supplies only the restricted application credential to this process.
for (const name of ['DB_HOST', 'POSTGRES_DB', 'APP_DB_USER', 'APP_DB_PASSWORD']) {
  if (!process.env[name]) throw new Error(`Missing configuration: ${name}`);
}
const url = new URL('postgresql://db:5432');
url.hostname = process.env.DB_HOST;
url.pathname = `/${process.env.POSTGRES_DB}`;
url.username = process.env.APP_DB_USER;
url.password = process.env.APP_DB_PASSWORD;
process.env.DATABASE_URL = url.href;
await import('../server.js');
