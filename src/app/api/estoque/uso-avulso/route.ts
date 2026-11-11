import { apiError, operationalSession, privateHeaders, verifyOrigin } from '@/lib/api-auth';
import { AppError } from '@/lib/errors';
import { MAX_PHOTO_BYTES, processAuthorizationPhoto } from '@/lib/stock-photo';
import { recordOffTicketUse } from '@/lib/stock-service';
export async function POST(request: Request) {
  try {
    verifyOrigin(request.headers.get('origin'));
    const { user } = await operationalSession();
    if (user.role === 'FUNCIONARIO') throw new AppError('Página não encontrada.', 404);
    if (!['TI', 'ADMIN'].includes(user.role)) throw new AppError('Acesso não permitido.', 403);
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;'))
      throw new AppError('Envie o formulário com uma foto.', 415);
    const length = request.headers.get('content-length');
    if (length === null) throw new AppError('Informe o tamanho do envio.', 411);
    if (!/^\d+$/.test(length) || Number(length) > MAX_PHOTO_BYTES + 64 * 1024)
      throw new AppError('O envio passa do tamanho permitido.', 413);
    let form: FormData;
    try { form = await request.formData(); } catch { throw new AppError('Formulário inválido.'); }
    const photo = form.get('photo');
    if (!(photo instanceof File)) throw new AppError('Anexe uma foto da autorização.');
    const processed = await processAuthorizationPhoto(new Uint8Array(await photo.arrayBuffer()));
    const text = (key: string) => typeof form.get(key) === 'string' ? String(form.get(key)) : '';
    const movement = await recordOffTicketUse(user.id, { itemId: text('itemId'), quantity: text('quantity'), note: text('note'), requestId: text('requestId') }, processed);
    return Response.json({ ok: true, movementId: movement.id }, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
