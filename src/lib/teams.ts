import { db } from './db';
import { AppError } from './errors';
import type { Prisma } from '@/generated/prisma/client';
type Tx = Prisma.TransactionClient;
export const TEAM_KEYS = ['TI', 'ELETRICA'] as const;
export type TeamKey = (typeof TEAM_KEYS)[number];
export const teamLabels: Record<TeamKey, string> = { TI: 'TI', ELETRICA: 'Elétrica' };
const isTeamKey = (key: string): key is TeamKey => (TEAM_KEYS as readonly string[]).includes(key);
export async function teamOptions(client: Tx | typeof db, organizationId: string) {
  const teams = await client.team.findMany({
    where: { organizationId, active: true },
    select: { id: true, key: true, name: true },
  });
  return teams
    .filter((t): t is { id: string; key: TeamKey; name: string } => isTeamKey(t.key))
    .sort((a, b) => TEAM_KEYS.indexOf(a.key) - TEAM_KEYS.indexOf(b.key));
}
export async function requireTeam(
  client: Tx,
  organizationId: string,
  teamId: string | null | undefined,
): Promise<{ id: string; key: TeamKey }> {
  const team = teamId
    ? await client.team.findFirst({
        where: { id: teamId, organizationId, active: true },
        select: { id: true, key: true },
      })
    : null;
  if (!team || !isTeamKey(team.key)) throw new AppError('Selecione a equipe.');
  return { id: team.id, key: team.key };
}
