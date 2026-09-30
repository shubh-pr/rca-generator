// Single entry point for authentication. Sign in with Google / Microsoft plugs in here too (oauth/).
export { accountRouter, authRouter, publicConfigRouter } from './routes.js';
export { oauthRouter } from './oauth/flow.js';
export { currentSessionId, currentUser, requireAuth } from './middleware.js';
export { hashPassword, verifyPassword } from './password.js';
