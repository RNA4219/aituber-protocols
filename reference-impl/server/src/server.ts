/**
 * Server Entry Point
 * AITuber相互認証・交流プロトコル HTTP Server
 */

import { serve } from '@hono/node-server';

import { createApi } from './api/index.js';
import { IdentityHostImpl, type IdentityHostConfig } from './identity-host.js';
import { VerifierImpl, type VerifierConfig } from './verifier.js';
import { SessionManagerImpl, type SessionManagerConfig } from './session-manager.js';
import { LedgerImpl, type LedgerConfig } from './ledger.js';

// ============================================================================
// Configuration
// ============================================================================

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Default configurations
const identityHostConfig: IdentityHostConfig = {
  storageRoot: process.env.STORAGE_ROOT || './data/identity',
  cacheTtl: parseInt(process.env.IDENTITY_CACHE_TTL || '600', 10),
  skipSignatureValidation: process.env.SKIP_SIGNATURE_VALIDATION === 'true',
};

const verifierConfig: VerifierConfig = {
  nonceTtl: parseInt(process.env.NONCE_TTL || '300', 10),
  challengeTtl: parseInt(process.env.CHALLENGE_TTL || '60', 10),
  clockSkewTolerance: parseInt(process.env.CLOCK_SKEW_TOLERANCE || '120', 10),
  nonceRetention: parseInt(process.env.NONCE_RETENTION || '360', 10),
};

const sessionManagerConfig: SessionManagerConfig = {
  sessionTtl: parseInt(process.env.SESSION_TTL || '300', 10),
  maxSessions: parseInt(process.env.MAX_SESSIONS || '10000', 10),
};

const ledgerConfig: LedgerConfig = {
  storageRoot: process.env.LEDGER_STORAGE_ROOT || './data/ledger',
  retentionDays: parseInt(process.env.LEDGER_RETENTION_DAYS || '365', 10),
};

// ============================================================================
// Bootstrap
// ============================================================================

async function main() {
  console.log('Starting AITuber Protocol Server...');
  console.log(`Configuration:`);
  console.log(`  - Port: ${PORT}`);
  console.log(`  - Host: ${HOST}`);
  console.log(`  - Identity Cache TTL: ${identityHostConfig.cacheTtl}s`);
  console.log(`  - Challenge TTL: ${verifierConfig.challengeTtl}s`);
  console.log(`  - Session TTL: ${sessionManagerConfig.sessionTtl}s`);

  // Initialize components
  const identityHost = new IdentityHostImpl(identityHostConfig);
  const verifier = new VerifierImpl(verifierConfig);
  const sessionManager = new SessionManagerImpl(sessionManagerConfig);
  const ledger = new LedgerImpl(ledgerConfig);

  console.log('Components initialized:');

  // Create API application
  const app = createApi({
    identityHost,
    verifier,
    sessionManager,
    ledger,
  });

  // Start server
  const server = serve({
    fetch: app.fetch,
    port: PORT,
    hostname: HOST,
  });

  console.log(`\nServer started at http://${HOST}:${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  - GET  /health`);
  console.log(`  - GET  /`);
  console.log(`  - GET  /v1/agents/:agentId/manifest`);
  console.log(`  - PUT  /v1/agents/:agentId/manifest`);
  console.log(`  - GET  /v1/agents/:agentId/revocation`);
  console.log(`  - POST /v1/challenges`);
  console.log(`  - POST /v1/proofs/verify`);
  console.log(`  - POST /v1/sessions`);
  console.log(`  - DELETE /v1/sessions/:sessionId`);
  console.log(`  - POST /v1/ledger/events`);
  console.log(`  - GET  /v1/ledger/events`);
  console.log(`  - GET  /v1/ledger/checkpoint`);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});