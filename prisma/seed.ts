import 'dotenv/config';
import { APP_ORGANIZATION_ID } from '../src/lib/config';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth-service';
import { usernameSchema } from '../src/lib/validation';
async function main() {
  const organizationId = APP_ORGANIZATION_ID;
  await db.organization.upsert({
    where: { id: organizationId },
    create: {
      id: organizationId,
      name: process.env.INITIAL_ORGANIZATION_NAME || 'Organização inicial',
    },
    update: {},
  });
  for (const name of ['TI', 'Financeiro', 'RH', 'Comercial', 'Administrativo', 'Gerência']) {
    await db.department.upsert({
      where: { organizationId_name: { organizationId, name } },
      create: { name, organizationId },
      update: {},
    });
  }
  for (const name of [
    'Acesso / Senha',
    'Hardware',
    'Software',
    'Impressora',
    'Rede / Internet',
    'E-mail',
    'ERP / Sistema interno',
    'Telefonia',
    'Solicitação de instalação',
    'Outro',
  ]) {
    if (
      !(await db.category.findFirst({
        where: { organizationId, name: { equals: name, mode: 'insensitive' } },
      }))
    )
      await db.category.create({ data: { name, organizationId } });
  }
  // Bootstrap only: never reset credentials or promote an existing account on repeat runs.
  if (await db.user.count({ where: { role: 'ADMIN', organizationId } })) {
    console.log('Administrador já existente. Credenciais preservadas.');
    return;
  }
  const username = usernameSchema.parse(process.env.INITIAL_ADMIN_USERNAME);
  const name = process.env.INITIAL_ADMIN_NAME?.trim();
  if (!name || name.length > 100)
    throw new Error('Configure INITIAL_ADMIN_NAME (até 100 caracteres).');
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!password || password.startsWith('SUBSTITUA'))
    throw new Error('Configure INITIAL_ADMIN_PASSWORD com uma senha forte.');
  const passwordHash = await hashPassword(password);
  const department = await db.department.findUniqueOrThrow({
    where: { organizationId_name: { name: 'TI', organizationId } },
  });
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(817214)`;
    if (await tx.user.count({ where: { role: 'ADMIN', organizationId } })) return;
    await tx.user.create({
      data: {
        organizationId,
        username,
        name,
        passwordHash,
        role: 'ADMIN',
        departmentId: department.id,
        mustChangePassword: true,
      },
    });
  });
  console.log(
    `Administrador '${username}' criado. A troca da senha será obrigatória no primeiro login.`,
  );
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Falha no bootstrap.');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
