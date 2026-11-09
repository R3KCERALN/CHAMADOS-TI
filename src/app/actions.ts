'use server';
import { cookies, headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { AppError } from '@/lib/errors';
import { limitLoginAddress } from '@/lib/login-ip-throttle';
import { ticketReturnTo } from '@/lib/return-to';
import { requireActionUser, SESSION_COOKIE } from '@/lib/auth';
import { login, logout, changePassword } from '@/lib/auth-service';
import * as service from '@/lib/services';
import { saveCompany, saveUnit } from '@/lib/organization-service';
export type FormState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
};
const value = (form: FormData, key: string) => String(form.get(key) ?? '');
async function sameOrigin() {
  const origin = (await headers()).get('origin');
  const expected = new URL(process.env.APP_URL || 'http://localhost:3000').origin;
  if (origin !== expected)
    throw new AppError(
      'Origem da solicitação inválida. Reabra o sistema pelo endereço configurado.',
      403,
    );
}
function failure(error: unknown): FormState {
  unstable_rethrow(error);
  if (error instanceof AppError) return { error: error.message };
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const field = String(issue.path[0] || '');
      if (!field) continue;
      (fieldErrors[field] ||= []).push(issue.message);
    }
    return {
      error: 'Revise os campos indicados para continuar.',
      fieldErrors,
    };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    return { error: 'Já existe um cadastro com este CNPJ, username ou nome. Verifique os dados.' };
  console.error('Falha na operação:', error instanceof Error ? error.name : 'UnknownError');
  return { error: 'Não foi possível concluir. Tente novamente em instantes.' };
}
export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  let mustChange = false;
  try {
    await sameOrigin();
    const address =
      process.env.APP_ENV === 'production' ? (await headers()).get('x-client-ip') : undefined;
    if (address !== undefined) await limitLoginAddress(address);
    const result = await login(value(form, 'username'), value(form, 'password'), address);
    mustChange = result.mustChangePassword;
    const secure = process.env.COOKIE_SECURE !== 'false';
    if (
      !secure &&
      !['localhost', '127.0.0.1', '[::1]'].includes(
        new URL(process.env.APP_URL || 'http://localhost:3000').hostname,
      )
    )
      throw new AppError(
        'Configure HTTPS e COOKIE_SECURE=true para acessar fora do ambiente local.',
      );
    (await cookies()).set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      expires: result.expiresAt,
    });
  } catch (error) {
    return failure(error);
  }
  const destination = ticketReturnTo(value(form, 'next'));
  redirect(mustChange ? `/alterar-senha?next=${encodeURIComponent(destination)}` : destination);
}
export async function logoutAction() {
  await sameOrigin();
  const jar = await cookies();
  await logout(jar.get(SESSION_COOKIE)?.value);
  jar.set(SESSION_COOKIE, '', {
    expires: new Date(0),
    path: '/',
    secure: process.env.COOKIE_SECURE !== 'false',
  });
  redirect('/login');
}
export async function passwordAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await sameOrigin();
    const user = await requireActionUser(undefined, true);
    if (value(form, 'password') !== value(form, 'confirmation'))
      throw new AppError('A confirmação não corresponde à nova senha.');
    await changePassword(user.id, value(form, 'currentPassword'), value(form, 'password'));
    (await cookies()).set(SESSION_COOKIE, '', {
      expires: new Date(0),
      path: '/',
      secure: process.env.COOKIE_SECURE !== 'false',
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/login?alterada=1&next=${encodeURIComponent(ticketReturnTo(value(form, 'next')))}`);
}
function userFields(form: FormData) {
  return {
    name: value(form, 'name'),
    username: value(form, 'username'),
    departmentId: value(form, 'departmentId'),
    role: value(form, 'role'),
    primaryCompanyId: value(form, 'primaryCompanyId') || null,
    primaryUnitId: value(form, 'primaryUnitId') || null,
    additionalCompanyIds: form.getAll('additionalCompanyIds').map(String),
    additionalUnitIds: form.getAll('additionalUnitIds').map(String),
  };
}
export async function createUserAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await sameOrigin();
    const user = await requireActionUser(['ADMIN']);
    await service.createUser(user.id, { ...userFields(form), password: value(form, 'password') });
    revalidatePath('/admin/usuarios');
  } catch (error) {
    return failure(error);
  }
  redirect('/admin/usuarios?criado=1');
}
export async function updateUserAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await sameOrigin();
    const user = await requireActionUser(['ADMIN']);
    await service.updateUser(user.id, value(form, 'id'), {
      ...userFields(form),
      active: value(form, 'active') === 'true',
    });
    revalidatePath('/admin/usuarios');
    return { success: 'Usuário atualizado. As sessões anteriores foram encerradas.' };
  } catch (error) {
    return failure(error);
  }
}
export async function resetPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await sameOrigin();
    const user = await requireActionUser(['ADMIN']);
    await service.resetPassword(user.id, value(form, 'id'), value(form, 'password'));
    return { success: 'Senha temporária definida. A troca será obrigatória no próximo login.' };
  } catch (error) {
    return failure(error);
  }
}
export async function createTicketAction(_: FormState, form: FormData): Promise<FormState> {
  let id = '';
  try {
    await sameOrigin();
    const user = await requireActionUser(['ADMIN', 'TI', 'FUNCIONARIO']);
    const ticket = await service.createTicket(
      user.id,
      {
        description: value(form, 'description'),
        impact: value(form, 'impact'),
        companyId: value(form, 'companyId') || undefined,
        unitId: value(form, 'unitId') || null,
        requesterName: value(form, 'requesterName') || undefined,
        quick: value(form, 'quick') === 'true',
      },
      value(form, 'requesterId') || undefined,
    );
    id = ticket.id;
    revalidatePath('/');
  } catch (error) {
    return failure(error);
  }
  redirect(`/chamados/${id}?criado=1`);
}
export async function ticketAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await sameOrigin();
    const user = await requireActionUser();
    const id = value(form, 'ticketId');
    switch (value(form, 'intent')) {
      case 'location':
        await service.relocateTicket(user.id, id, {
          companyId: value(form, 'companyId'),
          unitId: value(form, 'unitId') || null,
        });
        break;
      case 'classify':
        await service.classifyTicket(user.id, id, {
          categoryId: value(form, 'categoryId') || null,
          complexity: value(form, 'complexity') || null,
        });
        break;
      case 'claim':
        await service.claimTicket(user.id, id);
        break;
      case 'status':
        await service.changeStatus(user.id, id, {
          status: value(form, 'status'),
          waitingReason: value(form, 'waitingReason') || undefined,
          note: value(form, 'note'),
        });
        break;
      case 'support-add':
        await service.setSupport(user.id, id, value(form, 'userId'), true);
        break;
      case 'support-remove':
        await service.setSupport(user.id, id, value(form, 'userId'), false);
        break;
      case 'assign':
        await service.assignTicket(user.id, id, value(form, 'userId'));
        break;
      case 'comment':
        await service.addComment(user.id, id, value(form, 'content'));
        break;
      default:
        throw new AppError('Operação inválida.');
    }
    revalidatePath('/', 'layout');
    return { success: 'Atualização registrada.' };
  } catch (error) {
    return failure(error);
  }
}
export async function categoryAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await sameOrigin();
    const user = await requireActionUser(['ADMIN']);
    await service.saveCategory(user.id, {
      id: value(form, 'id') || undefined,
      name: value(form, 'name'),
      active: value(form, 'active') !== 'false',
    });
    revalidatePath('/', 'layout');
    return { success: 'Categoria salva. Os vínculos históricos foram preservados.' };
  } catch (error) {
    return failure(error);
  }
}

export async function companyAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await sameOrigin();
    const user = await requireActionUser(['ADMIN']);
    await saveCompany(user.id, {
      id: value(form, 'id') || undefined,
      displayName: value(form, 'displayName'),
      legalName: value(form, 'legalName') || null,
      cnpj: value(form, 'cnpj'),
      active: value(form, 'active') !== 'false',
    });
    revalidatePath('/', 'layout');
    return { success: 'Cadastro salvo.' };
  } catch (error) {
    return failure(error);
  }
}
export async function unitAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await sameOrigin();
    const user = await requireActionUser(['ADMIN']);
    await saveUnit(user.id, {
      id: value(form, 'id') || undefined,
      companyId: value(form, 'companyId'),
      name: value(form, 'name'),
      code: value(form, 'code') || null,
      active: value(form, 'active') !== 'false',
    });
    revalidatePath('/', 'layout');
    return { success: 'Cadastro salvo.' };
  } catch (error) {
    return failure(error);
  }
}
