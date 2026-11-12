import { operationalSession, privateHeaders, apiError, verifyOrigin } from '@/lib/api-auth';
import { pushConfig } from '@/lib/push-config';
import { saveSubscription, removeSubscription, sessionDigest } from '@/lib/push-subscriptions';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
export async function GET() {
  try {
    const { user, token } = await operationalSession({ allowManager: true });
    const devices = await db.pushSubscription.findMany({
      where: {
        userId: user.id,
        organizationId: user.organizationId,
        active: true,
      },
      select: { endpointHash: true, sessionHash: true },
      take: 20,
    });
    return Response.json(
      {
        publicKey: pushConfig()?.publicKey || null,
        devices: devices.map((device) => ({
          endpointHash: device.endpointHash,
          currentSession: device.sessionHash === sessionDigest(token),
        })),
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    return apiError(error);
  }
}
async function mutate(request: Request, remove: boolean) {
  try {
    verifyOrigin(request.headers.get('origin'));
    const { user, token } = await operationalSession({ allowManager: true });
    if (!remove && !pushConfig()) throw new AppError('Notificações ainda não configuradas.', 503);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new AppError('Envie JSON.');
    // Bound even chunked bodies; never buffer unbounded endpoint/key input.
    const reader = request.body?.getReader();
    if (!reader) throw new AppError('Dados ausentes.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 4096) {
        await reader.cancel();
        throw new AppError('Dados excedem o limite.', 413);
      }
      chunks.push(part.value);
    }
    let input: unknown;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new AppError('JSON inválido.');
    }
    if (remove) await removeSubscription(user.id, input);
    else await saveSubscription(user.id, token, input);
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch (error) {
    return apiError(error);
  }
}
export const POST = (request: Request) => mutate(request, false);
export const DELETE = (request: Request) => mutate(request, true);
