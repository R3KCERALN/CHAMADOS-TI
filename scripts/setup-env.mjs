import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const dbPassword = randomBytes(24).toString('hex');
const adminPassword = randomBytes(18).toString('base64url');
const content = `POSTGRES_USER=central
POSTGRES_PASSWORD=${dbPassword}
POSTGRES_DB=central_suporte
POSTGRES_PORT=54329
DATABASE_URL=postgresql://central:${dbPassword}@localhost:54329/central_suporte
APP_URL=http://localhost:3000
COOKIE_SECURE=false
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_NAME=Administrador
INITIAL_ADMIN_PASSWORD=${adminPassword}
`;
try {
  writeFileSync('.env', content, { flag: 'wx', mode: 0o600 });
  console.log(
    '.env criado com credenciais aleatórias. Consulte INITIAL_ADMIN_PASSWORD nesse arquivo.',
  );
} catch (error) {
  if (error.code === 'EEXIST') console.log('.env já existe; nenhuma configuração foi alterada.');
  else throw error;
}
