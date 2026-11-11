import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { APP_ORGANIZATION_ID as organizationId } from '../src/lib/config';
import { hashPassword } from '../src/lib/auth-service';
import { teamId } from './fixtures';
import type { Role } from '../src/generated/prisma/client';
export async function stockFixture() {
  const hash = await hashPassword(process.env.TEST_PASSWORD!);
  const department = await db.department.create({
    data: { organizationId, name: `Estoque ${randomUUID()}` },
  });
  const ti = await teamId(organizationId, 'TI');
  const electric = await teamId(organizationId, 'ELETRICA');
  const user = async (role: Role, extra = {}) =>
    (
      await db.user.create({
        data: {
          organizationId,
          departmentId: department.id,
          name: `Pessoa ${role}`,
          username: `test.${randomUUID().replaceAll('-', '')}`,
          role,
          passwordHash: hash,
          mustChangePassword: false,
          ...(role === 'TI' && { teamId: ti }),
          ...extra,
        },
      })
    ).id;
  return {
    organizationId,
    ti,
    electric,
    admin: await user('ADMIN'),
    keeper: await user('TI', { stockKeeper: true }),
    tech: await user('TI'),
    other: await user('TI'),
    electrician: await user('TI', { teamId: electric }),
    manager: await user('GESTOR'),
    employee: await user('FUNCIONARIO'),
  };
}
