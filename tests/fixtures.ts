import { randomInt } from 'node:crypto';
import { validCnpj } from '../src/lib/cnpj';
import { db } from '../src/lib/db';
export function syntheticCnpj() {
  const base = String(randomInt(10000000, 99999999)) + '0001';
  return Array.from({ length: 100 }, (_, i) => base + String(i).padStart(2, '0')).find(validCnpj)!;
}
export async function teamId(organizationId: string, key: 'TI' | 'ELETRICA') {
  return (
    await db.team.findUniqueOrThrow({
      where: { organizationId_key: { organizationId, key } },
      select: { id: true },
    })
  ).id;
}
