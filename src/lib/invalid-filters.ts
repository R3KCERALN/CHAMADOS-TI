import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { AppError } from './errors';

// Filters come from the URL and can be edited or outdated: go back to the clean screen
// instead of the generic error page. Without filters there is nothing to reset, so the error is kept.
export function resetInvalidFilters(error: unknown, params: object, path: string): never {
  const hasFilters = Object.values(params).some((value) => value !== undefined);
  if (
    hasFilters &&
    (error instanceof ZodError || (error instanceof AppError && error.status === 400))
  )
    redirect(path);
  throw error;
}
