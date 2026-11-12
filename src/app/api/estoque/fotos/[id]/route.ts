import { apiError, operationalSession, privateHeaders } from '@/lib/api-auth';
import { authorizationPhoto } from '@/lib/stock-service';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await operationalSession({ allowManager: true });
    const photo = await authorizationPhoto(user.id, (await params).id);
    return new Response(Buffer.from(photo.data), {
      headers: {
        ...privateHeaders,
        'Content-Type': photo.mime,
        'Content-Disposition': 'inline; filename="autorizacao.webp"',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
