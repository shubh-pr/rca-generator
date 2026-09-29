import { PrismaClient } from '@prisma/client';
import { config } from './config.js';
import { tenantScopeExtension } from './tenancy/prismaScope.js';

/** Connection pool size comes from DATABASE_POOL_SIZE unless the URL already sets connection_limit. */
function datasourceUrl() {
  const url = new URL(config.databaseUrl);
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', String(config.databasePoolSize));
  return url.toString();
}

/** Raw client: no tenant filter. Only the tenancy layer itself may use it. */
const base = new PrismaClient({ datasourceUrl: datasourceUrl() });

/** The application client. Every tenant-model query is filtered by the current request's scope. */
export const prisma = base.$extends(tenantScopeExtension(base as never));

export type AppPrisma = typeof prisma;
/** Interactive-transaction client of the extended client. */
export type Tx = Omit<AppPrisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;
/** Either the root client or a transaction client. */
export type Db = AppPrisma | Tx;

export async function disconnectDb() {
  await base.$disconnect();
}
