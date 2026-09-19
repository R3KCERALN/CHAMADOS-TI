import { operationalSession, privateHeaders, apiError } from '@/lib/api-auth';
import { operationalRevision } from '@/lib/live-updates';
export async function GET() {
  try {
    const { user } = await operationalSession();
    return Response.json(
      { revision: await operationalRevision(user.id) },
      { headers: privateHeaders },
    );
  } catch (error) {
    return apiError(error);
  }
}
