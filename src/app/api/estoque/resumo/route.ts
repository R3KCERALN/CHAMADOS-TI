import { apiError, operationalSession, privateHeaders } from '@/lib/api-auth';
import { lowStockCount } from '@/lib/stock-service';
export async function GET() {
  try {
    const { user } = await operationalSession({ allowManager: true });
    return Response.json({ count: await lowStockCount(user.id) }, { headers: privateHeaders });
  } catch (error) {
    return apiError(error);
  }
}
