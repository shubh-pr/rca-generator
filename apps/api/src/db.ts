import { PrismaClient } from '@prisma/client';
import { tenantScopeExtension } from './tenancy/prismaScope.js';

/** Raw client: no tenant filter. Only the tenancy layer itself may use it. */
const base = new PrismaClient();

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
