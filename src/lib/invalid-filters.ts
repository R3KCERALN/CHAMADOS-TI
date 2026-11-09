import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { AppError } from './errors';

export const INVALID_FILTER_NOTICE = 'filtro-invalido';
// Filters come from the URL and can be edited or outdated: go back to the clean screen with a
// notice instead of the generic error page. The notice itself is not a filter, so a failure on the
// clean screen keeps the original error and can never loop.
export function resetInvalidFilters(error: unknown, params: object, path: string): never {
  const hasFilters = Object.entries(params).some(
    ([key, value]) => key !== 'aviso' && value !== undefined,
  );
  if (
    hasFilters &&
    (error instanceof ZodError || (error instanceof AppError && error.status === 400))
  )
    redirect(`${path}?aviso=${INVALID_FILTER_NOTICE}`);
  throw error;
}
