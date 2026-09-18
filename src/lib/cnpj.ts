import { z } from 'zod';
export function normalizeCnpj(value: string) {
  return value.replace(/[.\/\-\s]/g, '');
}
export function validCnpj(value: string) {
  const digits = normalizeCnpj(value);
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const digit = (base: string) => {
    let weight = base.length - 7;
    const sum = [...base].reduce((total, n) => {
      const result = total + Number(n) * weight;
      weight = weight === 2 ? 9 : weight - 1;
      return result;
    }, 0);
    const remainder = sum % 11;
    return remainder < 2 ? '0' : String(11 - remainder);
  };
  const base = digits.slice(0, 12);
  return digits === base + digit(base) + digit(base + digit(base));
}
export const cnpjSchema = z
  .string()
  .max(30)
  .transform(normalizeCnpj)
  .refine(validCnpj, 'Informe um CNPJ válido com 14 dígitos.');
export function formatCnpj(value: string) {
  return value.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
