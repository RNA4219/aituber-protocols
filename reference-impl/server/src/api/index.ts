/**
 * API Index - Hono app definition and routing
 * @see ../../../specs/core/interfaces.md
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { identityApi, type IdentityVariables } from './identity.js';
import { authApi, type AuthVariables } from './auth.js';
import { revocationApi, type RevocationVariables } from './revocation.js';
import { ledgerApi, type LedgerVariables } from './ledger.js';
import type { IdentityHost } from '../identity-host.js';
import type { Verifier } from '../verifier.js';
import type { SessionManager } from '../session-manager.js';
import type { Ledger } from '../ledger.js';

// ============================================================================
// Combined Context Type
// ============================================================================

/** API Context Variables (combined) */
export interface ApiVariables extends IdentityVariables, AuthVariables, RevocationVariables, LedgerVariables {
  identityHost: IdentityHost;
  verifier: Verifier;
  sessionManager: SessionManager;
  ledger: Ledger;
}

/** API Env for Hono */
export type ApiEnv = { Variables: ApiVariables };

/** @deprecated Use ApiEnv instead */
export type ApiContext = ApiEnv;

// ============================================================================
// Hono App
// ============================================================================

const app = new Hono<ApiEnv>();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.2.0',
  });
});

// API version info
app.get('/', (c) => {
  return c.json({
    name: 'AITuber Protocol API',
    version: '0.2.0',
    spec_version: '0.2',
    endpoints: [
      '/v1/agents/:agentId/manifest',
      '/v1/agents/:agentId/revocation',
      '/v1/challenges',
      '/v1/proofs/verify',
      '/v1/sessions',
      '/v1/sessions/:sessionId',
      '/v1/ledger/events',
      '/v1/ledger/checkpoint',
    ],
  });
});

// Route: /v1/agents - Identity and Revocation
app.route('/v1/agents', identityApi);
app.route('/v1/agents', revocationApi);

// Route: /v1 - Auth endpoints
app.route('/v1', authApi);

// Route: /v1/ledger - Ledger endpoints
app.route('/v1/ledger', ledgerApi);

// 404 handler
app.notFound((c) => {
  return c.json({
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
      retryable: false,
      risk_level: 'low',
      details: { path: c.req.path },
    },
  }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('API Error:', err);
  return c.json({
    error: {
      code: 'INTERNAL_ERROR',
      message: err.message,
      retryable: true,
      risk_level: 'low',
      details: {},
    },
  }, 500);
});

// ============================================================================
// Factory Function
// ============================================================================

/**
 * APIアプリケーションを作成
 */
export function createApi(dependencies: {
  identityHost: IdentityHost;
  verifier: Verifier;
  sessionManager: SessionManager;
  ledger: Ledger;
}): Hono<ApiEnv> {
  // Context初期化用のミドルウェア
  const appWithContext = new Hono<ApiEnv>();

  appWithContext.use('*', async (c, next) => {
    c.set('identityHost', dependencies.identityHost);
    c.set('verifier', dependencies.verifier);
    c.set('sessionManager', dependencies.sessionManager);
    c.set('ledger', dependencies.ledger);
    await next();
  });

  // メインアプリケーションをマウント
  appWithContext.route('/', app);

  return appWithContext;
}

export { app };