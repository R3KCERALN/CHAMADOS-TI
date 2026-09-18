import { randomInt } from 'node:crypto';
import { validCnpj } from '../src/lib/cnpj';
export function syntheticCnpj() {
  const base = String(randomInt(10000000, 99999999)) + '0001';
  return Array.from({ length: 100 }, (_, i) => base + String(i).padStart(2, '0')).find(validCnpj)!;
}
