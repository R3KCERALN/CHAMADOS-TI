import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { AppError } from '../src/lib/errors';
import { resetInvalidFilters } from '../src/lib/invalid-filters';

const zodError = () => {
  const result = z.enum(['A']).safeParse('x');
  assert.ok(!result.success);
  return result.error;
};
const destination = (error: unknown) => {
  const digest = (error as { digest?: string }).digest ?? '';
  const [kind, , url] = digest.split(';');
  return kind === 'NEXT_REDIRECT' ? url : null;
};
const run = (error: unknown, params: object, path = '/gestor') => {
  try {
    resetInvalidFilters(error, params, path);
  } catch (thrown) {
    return thrown;
  }
  return undefined;
};

test('filtro inválido na URL volta para a tela sem filtros', () => {
  assert.equal(destination(run(new AppError('Período inválido.'), { periodo: 'x' })), '/gestor');
  assert.equal(destination(run(zodError(), { complexity: 'x' }, '/chamados')), '/chamados');
});
test('sem filtros na URL ou com outro erro, o erro original é repassado', () => {
  const invalid = new AppError('Período inválido.');
  assert.equal(run(invalid, {}), invalid);
  assert.equal(run(invalid, { periodo: undefined }), invalid);
  for (const other of [
    new AppError('Sem permissão.', 403),
    new AppError('Nada.', 404),
    new Error('boom'),
  ])
    assert.equal(run(other, { periodo: 'x' }), other);
});
