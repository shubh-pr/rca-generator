import path from 'node:path';

const env = process.env;

if (env.NODE_ENV === 'production' && !env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

export const config = {
  port: Number(env.PORT ?? 4000),
  jwtSecret: env.JWT_SECRET ?? 'dev-only-secret',
  jwtExpiresIn: env.JWT_EXPIRES_IN ?? '8h',
  uploadDir: path.resolve(env.UPLOAD_DIR ?? './uploads'),
  corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
  maxUploadBytes: 10 * 1024 * 1024,
};
