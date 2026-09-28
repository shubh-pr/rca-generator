import { PrismaClient, type Prisma } from '@prisma/client';

export const prisma = new PrismaClient();

/** Either the root client or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;
