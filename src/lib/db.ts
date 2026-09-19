import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db =
  globalDb.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 3000,
      statement_timeout: process.env.APP_ENV === 'production' ? 30000 : undefined,
    }),
  });
if (process.env.NODE_ENV !== 'production') globalDb.prisma = db;
