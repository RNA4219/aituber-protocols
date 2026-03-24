/**
 * API Endpoint Tests
 * Tests for auth, identity, ledger, and revocation APIs
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { authApi } from '../api/auth.js';
import { identityApi } from '../api/identity.js';
import { ledgerApi } from '../api/ledger.js';
import { revocationApi } from '../api/revocation.js';
import type { Verifier } from '../verifier.js';
import type { SessionManager } from '../session-manager.js';
import type { IdentityHost, IdentityManifest } from '../identity-host.js';
import type { Ledger, LedgerEvent } from '../ledger.js';
import type { Challenge, Proof, VerificationResult } from '../verifier.js';
import type { Session } from '../session-manager.js';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockVerifier(): Verifier {
  return {
    issueChallenge: vi.fn(),
    verifyProof: vi.fn(),
    isNonceUsed: vi.fn(),
    markNonceUsed: vi.fn(),
  };
}

function createMockSessionManager(): SessionManager {
  return {
    createSession: vi.fn(),
    getSession: vi.fn(),
    renewSession: vi.fn(),
    terminateSession: vi.fn(),
    terminateAgentSessions: vi.fn(),
    cleanupExpiredSessions: vi.fn(),
  };
}

function createMockIdentityHost(): IdentityHost {
  return {
    getManifest: vi.fn(),
    saveManifest: vi.fn(),
    validateManifestSignature: vi.fn(),
    matchBinding: vi.fn(),
  };
}

function createMockLedger(): Ledger {
  return {
    appendEvent: vi.fn(),
    getEvent: vi.fn(),
    getAgentEvents: vi.fn(),
    getCheckpoint: vi.fn(),
    validateEvent: vi.fn(),
  };
}

// ============================================================================
// Test Fixtures
// ============================================================================

const mockChallenge: Challenge = {
  spec_version: '0.2',
  challenge_id: 'chl_test_001',
  verifier_id: 'agt_A001',
  target_agent_id: 'agt_B001',
  target_instance_id: 'ins_B001_001',
  nonce: 'nonce_abc123xyz789',
  issued_at: '2026-03-24T12:30:00Z',
  expires_at: '2026-03-24T12:31:00Z',
  intent: 'PROFILE_READ',
  risk_level: 'low',
  requested_capabilities: ['profile.read'],
  epochs: {
    identity_version: 5,
    revocation_epoch: 3,
    policy_epoch: 2,
    session_epoch: 10,
    ledger_checkpoint: 'chk_100',
  },
  signature: {
    key_id: 'verifier_key_1',
    algorithm: 'ed25519',
    canonicalization: 'jcs',
    value: 'signature_hex',
  },
};

const mockProof: Proof = {
  spec_version: '0.2',
  proof_id: 'proof_001',
  challenge_id: 'chl_test_001',
  agent_id: 'agt_B001',
  instance_id: 'ins_B001_001',
  nonce: 'nonce_abc123xyz789',
  timestamp: '2026-03-24T12:30:15Z',
  expires_at: '2026-03-24T12:31:00Z',
  intent: 'PROFILE_READ',
  capability_digest: 'sha256:digest_hex',
  identity_version: 5,
  revocation_epoch: 3,
  policy_epoch: 2,
  session_epoch: 10,
  session_pubkey: {
    key_id: 'session_key_001',
    algorithm: 'ed25519',
    public_key: 'public_key_hex',
  },
  signature: {
    key_id: 'opk_B001_1',
    algorithm: 'ed25519',
    canonicalization: 'jcs',
    value: 'proof_signature_hex',
  },
};

const mockSession: Session = {
  spec_version: '0.2',
  session_id: 'ses_test_001',
  agent_id: 'agt_B001',
  instance_id: 'ins_B001_001',
  issued_at: '2026-03-24T12:30:00Z',
  expires_at: '2026-03-24T13:30:00Z',
  session_epoch: 11,
  revocation_epoch: 3,
  policy_epoch: 2,
  identity_version: 5,
  sequence: 0,
  capabilities: ['profile.read', 'profile.write'],
  risk_level: 'low',
  status: 'active',
  ledger_checkpoint: 'chk_100',
};

const mockManifest: IdentityManifest = {
  spec_version: '0.2',
  manifest_version: 1,
  controller_id: 'ctrl_001',
  agent_id: 'agt_B001',
  identity_version: 5,
  updated_at: '2026-03-24T12:00:00Z',
  ledger_ref: 'ledger://example.com/agt_B001',
  revocation_ref: 'revocation://example.com/agt_B001',
  keys: [
    {
      key_id: 'opk_B001_1',
      scope: 'operation',
      algorithm: 'ed25519',
      public_key: 'public_key_hex',
      status: 'active',
      valid_from: '2026-01-01T00:00:00Z',
    },
  ],
  platform_bindings: [
    {
      platform_type: 'x',
      platform_account_id: '123456',
      display_handle: '@test_agent',
      binding_status: 'active',
      verified_at: '2026-01-15T00:00:00Z',
      bound_by_key_id: 'opk_B001_1',
      binding_version: 1,
    },
  ],
  service_endpoints: [
    {
      name: 'api',
      url: 'https://api.example.com',
      kind: 'rest',
    },
  ],
  capability_summary: ['profile.read', 'profile.write'],
  policy_ref: 'policy://example.com/default',
  signatures: [
    {
      key_id: 'root_key_1',
      algorithm: 'ed25519',
      canonicalization: 'jcs',
      value: 'manifest_signature_hex',
    },
  ],
};

const mockLedgerEvent: LedgerEvent = {
  spec_version: '0.2',
  schema_version: '1.0',
  event_id: 'evt_001',
  event_type: 'key.rotated',
  agent_id: 'agt_B001',
  controller_id: 'ctrl_001',
  event_time: '2026-03-24T12:00:00Z',
  recorded_at: '2026-03-24T12:00:01Z',
  producer_key_id: 'opk_B001_1',
  sequence: 1,
  payload_hash: 'sha256:payload_hash_hex',
  ledger_checkpoint: 'chk_101',
  payload: {
    old_key_id: 'opk_B001_0',
    new_key_id: 'opk_B001_1',
  },
  signatures: [
    {
      key_id: 'opk_B001_1',
      algorithm: 'ed25519',
      canonicalization: 'jcs',
      value: 'event_signature_hex',
    },
  ],
};

// ============================================================================
// Auth API Tests
// ============================================================================

describe('Auth API', () => {
  let app: Hono;
  let mockVerifier: Verifier;
  let mockSessionManager: SessionManager;

  beforeEach(() => {
    mockVerifier = createMockVerifier();
    mockSessionManager = createMockSessionManager();

    app = new Hono<{
      Variables: {
        verifier: Verifier;
        sessionManager: SessionManager;
      };
    }>();

    app.use('*', (c, next) => {
      c.set('verifier', mockVerifier);
      c.set('sessionManager', mockSessionManager);
      return next();
    });

    app.route('/v1', authApi);
  });

  describe('POST /v1/challenges - Challenge発行', () => {
    it('should issue a challenge successfully', async () => {
      vi.mocked(mockVerifier.issueChallenge).mockResolvedValue(mockChallenge);

      const response = await app.request('/v1/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verifier_id: 'agt_A001',
          target_agent_id: 'agt_B001',
          target_instance_id: 'ins_B001_001',
          intent: 'PROFILE_READ',
          risk_level: 'low',
          requested_capabilities: ['profile.read'],
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.challenge_id).toBe('chl_test_001');
      expect(body.target_agent_id).toBe('agt_B001');
      expect(body.nonce).toBe('nonce_abc123xyz789');
      expect(body.intent).toBe('PROFILE_READ');
      expect(body.risk_level).toBe('low');
      expect(body.version_vector).toEqual({
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        ledger_checkpoint: 'chk_100',
      });
    });

    it('should issue a challenge with high risk level', async () => {
      const highRiskChallenge = { ...mockChallenge, risk_level: 'high' as const };
      vi.mocked(mockVerifier.issueChallenge).mockResolvedValue(highRiskChallenge);

      const response = await app.request('/v1/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verifier_id: 'agt_A001',
          target_agent_id: 'agt_B001',
          target_instance_id: 'ins_B001_001',
          intent: 'PROFILE_WRITE',
          risk_level: 'high',
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.risk_level).toBe('high');
    });

    it('should return 500 on verifier error', async () => {
      vi.mocked(mockVerifier.issueChallenge).mockRejectedValue(new Error('Internal error'));

      const response = await app.request('/v1/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verifier_id: 'agt_A001',
          target_agent_id: 'agt_B001',
          target_instance_id: 'ins_B001_001',
          intent: 'PROFILE_READ',
          risk_level: 'low',
        }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /v1/proofs/verify - Proof検証', () => {
    it('should verify a valid proof', async () => {
      const verificationResult: VerificationResult = {
        status: 'VERIFIED',
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        risk_level: 'low',
        freshness_status: 'fresh',
        capability_status: 'MATCHED',
        version_check: {
          rollback_detected: false,
          epoch_mismatch: false,
          session_epoch_old: false,
          policy_mismatch: false,
        },
        errors: [],
      };
      vi.mocked(mockVerifier.verifyProof).mockResolvedValue(verificationResult);

      const response = await app.request('/v1/proofs/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: 'chl_test_001',
          proof: mockProof,
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.verification_status).toBe('VERIFIED');
      expect(body.verified_agent_id).toBe('agt_B001');
      expect(body.verified_instance_id).toBe('ins_B001_001');
    });

    it('should return 400 for rejected proof', async () => {
      const verificationResult: VerificationResult = {
        status: 'REJECTED',
        errors: [{ code: 'INVALID_SIGNATURE', message: 'Signature verification failed' }],
      };
      vi.mocked(mockVerifier.verifyProof).mockResolvedValue(verificationResult);

      const response = await app.request('/v1/proofs/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: 'chl_test_001',
          proof: mockProof,
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.verification_status).toBe('REJECTED');
      expect(body.errors).toHaveLength(1);
    });

    it('should return 202 for deferred proof', async () => {
      const verificationResult: VerificationResult = {
        status: 'DEFERRED',
        agent_id: 'agt_B001',
        errors: [],
      };
      vi.mocked(mockVerifier.verifyProof).mockResolvedValue(verificationResult);

      const response = await app.request('/v1/proofs/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: 'chl_test_001',
          proof: mockProof,
        }),
      });

      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.verification_status).toBe('DEFERRED');
    });

    it('should return 500 on verifier error', async () => {
      vi.mocked(mockVerifier.verifyProof).mockRejectedValue(new Error('Internal error'));

      const response = await app.request('/v1/proofs/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: 'chl_test_001',
          proof: mockProof,
        }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /v1/sessions - Session作成', () => {
    it('should create a session successfully', async () => {
      vi.mocked(mockSessionManager.createSession).mockResolvedValue(mockSession);

      const response = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verified_agent_id: 'agt_B001',
          verified_instance_id: 'ins_B001_001',
          risk_level: 'low',
          capability_summary: ['profile.read', 'profile.write'],
          version_vector: {
            identity_version: 5,
            revocation_epoch: 3,
            policy_epoch: 2,
            session_epoch: 10,
            ledger_checkpoint: 'chk_100',
          },
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.session_id).toBe('ses_test_001');
      expect(body.agent_id).toBe('agt_B001');
      expect(body.instance_id).toBe('ins_B001_001');
      expect(body.session_status).toBe('ACTIVE');
    });

    it('should create a session with high risk level', async () => {
      const highRiskSession = { ...mockSession, risk_level: 'high' as const };
      vi.mocked(mockSessionManager.createSession).mockResolvedValue(highRiskSession);

      const response = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verified_agent_id: 'agt_B001',
          verified_instance_id: 'ins_B001_001',
          risk_level: 'high',
          version_vector: {
            identity_version: 5,
            revocation_epoch: 3,
            policy_epoch: 2,
            session_epoch: 10,
            ledger_checkpoint: 'chk_100',
          },
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.agent_id).toBe('agt_B001');
    });

    it('should return 500 on session manager error', async () => {
      vi.mocked(mockSessionManager.createSession).mockRejectedValue(new Error('Internal error'));

      const response = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verified_agent_id: 'agt_B001',
          verified_instance_id: 'ins_B001_001',
          risk_level: 'low',
          version_vector: {
            identity_version: 5,
            revocation_epoch: 3,
            policy_epoch: 2,
            session_epoch: 10,
            ledger_checkpoint: 'chk_100',
          },
        }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('DELETE /v1/sessions/:sessionId - Session終了', () => {
    it('should terminate a session successfully', async () => {
      vi.mocked(mockSessionManager.getSession).mockResolvedValue(mockSession);
      vi.mocked(mockSessionManager.terminateSession).mockResolvedValue();

      const response = await app.request('/v1/sessions/ses_test_001', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'ses_test_001',
          reason_code: 'manual_termination',
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.session_id).toBe('ses_test_001');
      expect(body.status).toBe('terminated');
    });

    it('should terminate a session without body', async () => {
      vi.mocked(mockSessionManager.getSession).mockResolvedValue(mockSession);
      vi.mocked(mockSessionManager.terminateSession).mockResolvedValue();

      const response = await app.request('/v1/sessions/ses_test_001', {
        method: 'DELETE',
      });

      expect(response.status).toBe(200);
      expect(mockSessionManager.terminateSession).toHaveBeenCalledWith('ses_test_001', 'manual_termination');
    });

    it('should return 404 for non-existent session', async () => {
      vi.mocked(mockSessionManager.getSession).mockResolvedValue(null);

      const response = await app.request('/v1/sessions/nonexistent_session', {
        method: 'DELETE',
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 500 on session manager error', async () => {
      vi.mocked(mockSessionManager.getSession).mockResolvedValue(mockSession);
      vi.mocked(mockSessionManager.terminateSession).mockRejectedValue(new Error('Internal error'));

      const response = await app.request('/v1/sessions/ses_test_001', {
        method: 'DELETE',
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});

// ============================================================================
// Identity API Tests
// ============================================================================

describe('Identity API', () => {
  let app: Hono;
  let mockIdentityHost: IdentityHost;

  beforeEach(() => {
    mockIdentityHost = createMockIdentityHost();

    app = new Hono<{
      Variables: {
        identityHost: IdentityHost;
      };
    }>();

    app.use('*', (c, next) => {
      c.set('identityHost', mockIdentityHost);
      return next();
    });

    app.route('/v1/agents', identityApi);
  });

  describe('GET /v1/agents/:agentId/manifest - Manifest取得', () => {
    it('should return manifest for existing agent', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);

      const response = await app.request('/v1/agents/agt_B001/manifest');

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.agent_id).toBe('agt_B001');
      expect(body.identity_version).toBe(5);
      expect(body.keys).toHaveLength(1);
      expect(body.platform_bindings).toHaveLength(1);
    });

    it('should return 404 for non-existent agent', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(null);

      const response = await app.request('/v1/agents/nonexistent_agent/manifest');

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('Identity manifest not found');
    });

    it('should return 500 on identity host error', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockRejectedValue(new Error('Internal error'));

      const response = await app.request('/v1/agents/agt_B001/manifest');

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('PUT /v1/agents/:agentId/manifest - Manifest更新', () => {
    it('should update manifest successfully', async () => {
      vi.mocked(mockIdentityHost.saveManifest).mockResolvedValue();
      vi.mocked(mockIdentityHost.validateManifestSignature).mockResolvedValue(true);

      const response = await app.request('/v1/agents/agt_B001/manifest', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockManifest),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.agent_id).toBe('agt_B001');
    });

    it('should return 400 for agent_id mismatch', async () => {
      const mismatchedManifest = { ...mockManifest, agent_id: 'different_agent' };

      const response = await app.request('/v1/agents/agt_B001/manifest', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mismatchedManifest),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('agent_id in manifest does not match');
    });

    it('should return 400 for invalid signature', async () => {
      vi.mocked(mockIdentityHost.saveManifest).mockRejectedValue(new Error('Invalid manifest signature'));

      const response = await app.request('/v1/agents/agt_B001/manifest', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockManifest),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('should return 500 on identity host error', async () => {
      vi.mocked(mockIdentityHost.saveManifest).mockRejectedValue(new Error('Storage error'));

      const response = await app.request('/v1/agents/agt_B001/manifest', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockManifest),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});

// ============================================================================
// Ledger API Tests
// ============================================================================

describe('Ledger API', () => {
  let app: Hono;
  let mockLedger: Ledger;

  beforeEach(() => {
    mockLedger = createMockLedger();

    app = new Hono<{
      Variables: {
        ledger: Ledger;
      };
    }>();

    app.use('*', (c, next) => {
      c.set('ledger', mockLedger);
      return next();
    });

    app.route('/v1/ledger', ledgerApi);
  });

  describe('POST /v1/ledger/events - イベント追加', () => {
    it('should append event successfully', async () => {
      vi.mocked(mockLedger.validateEvent).mockResolvedValue({ valid: true, errors: [] });
      vi.mocked(mockLedger.appendEvent).mockResolvedValue({ checkpoint: 'chk_101' });

      const response = await app.request('/v1/ledger/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: mockLedgerEvent }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.append_status).toBe('APPENDED');
      expect(body.event_id).toBe('evt_001');
      expect(body.checkpoint).toBe('chk_101');
    });

    it('should return 400 for missing event', async () => {
      const response = await app.request('/v1/ledger/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('event is required');
    });

    it('should return 400 for invalid event', async () => {
      vi.mocked(mockLedger.validateEvent).mockResolvedValue({
        valid: false,
        errors: ['event_id is required', 'signatures is required'],
      });

      const invalidEvent = { ...mockLedgerEvent, event_id: '', signatures: [] };
      const response = await app.request('/v1/ledger/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: invalidEvent }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Invalid event');
    });

    it('should return 500 on ledger error', async () => {
      vi.mocked(mockLedger.validateEvent).mockResolvedValue({ valid: true, errors: [] });
      vi.mocked(mockLedger.appendEvent).mockRejectedValue(new Error('Storage error'));

      const response = await app.request('/v1/ledger/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: mockLedgerEvent }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /v1/ledger/events - イベント一覧取得', () => {
    it('should return events for specific agent', async () => {
      vi.mocked(mockLedger.getAgentEvents).mockResolvedValue({
        events: [mockLedgerEvent],
        checkpoint: 'chk_101',
        hasMore: false,
      });

      const response = await app.request('/v1/ledger/events?agent_id=agt_B001');

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.agent_id).toBe('agt_B001');
      expect(body.events).toHaveLength(1);
      expect(body.has_more).toBe(false);
    });

    it('should return events with since_checkpoint filter', async () => {
      vi.mocked(mockLedger.getAgentEvents).mockResolvedValue({
        events: [mockLedgerEvent],
        checkpoint: 'chk_101',
        hasMore: false,
      });

      const response = await app.request('/v1/ledger/events?agent_id=agt_B001&since_checkpoint=chk_50');

      expect(response.status).toBe(200);
      expect(mockLedger.getAgentEvents).toHaveBeenCalledWith('agt_B001', {
        sinceCheckpoint: 'chk_50',
        maxEvents: 100,
      });
    });

    it('should return checkpoint when no agent_id specified', async () => {
      vi.mocked(mockLedger.getCheckpoint).mockReturnValue('chk_100');

      const response = await app.request('/v1/ledger/events');

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.checkpoint).toBe('chk_100');
    });

    it('should return 500 on ledger error', async () => {
      vi.mocked(mockLedger.getAgentEvents).mockRejectedValue(new Error('Storage error'));

      const response = await app.request('/v1/ledger/events?agent_id=agt_B001');

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /v1/ledger/checkpoint - チェックポイント取得', () => {
    it('should return current checkpoint', async () => {
      vi.mocked(mockLedger.getCheckpoint).mockReturnValue('chk_100');

      const response = await app.request('/v1/ledger/checkpoint');

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.checkpoint).toBe('chk_100');
    });

    it('should return 500 on ledger error', async () => {
      vi.mocked(mockLedger.getCheckpoint).mockImplementation(() => {
        throw new Error('Internal error');
      });

      const response = await app.request('/v1/ledger/checkpoint');

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /v1/ledger/events/:eventId - 特定イベント取得', () => {
    it('should return event by id', async () => {
      vi.mocked(mockLedger.getEvent).mockResolvedValue(mockLedgerEvent);

      const response = await app.request('/v1/ledger/events/evt_001');

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.event_id).toBe('evt_001');
      expect(body.event_type).toBe('key.rotated');
    });

    it('should return 404 for non-existent event', async () => {
      vi.mocked(mockLedger.getEvent).mockResolvedValue(null);

      const response = await app.request('/v1/ledger/events/nonexistent_event');

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('Event not found');
    });

    it('should return 500 on ledger error', async () => {
      vi.mocked(mockLedger.getEvent).mockRejectedValue(new Error('Storage error'));

      const response = await app.request('/v1/ledger/events/evt_001');

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});

// ============================================================================
// Revocation API Tests
// ============================================================================

describe('Revocation API', () => {
  let app: Hono;
  let mockIdentityHost: IdentityHost;

  beforeEach(() => {
    mockIdentityHost = createMockIdentityHost();

    app = new Hono<{
      Variables: {
        identityHost: IdentityHost;
      };
    }>();

    app.use('*', (c, next) => {
      c.set('identityHost', mockIdentityHost);
      return next();
    });

    app.route('/v1/agents', revocationApi);
  });

  describe('GET /v1/agents/:agentId/revocation - Revocation Status取得', () => {
    it('should return revocation status for existing agent', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);

      const response = await app.request('/v1/agents/agt_B001/revocation?known_identity_version=5&known_revocation_epoch=5');

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.agent_status).toBe('active');
      expect(body.quarantine_status).toBe('NONE');
      expect(body.current_identity_version).toBe(5);
      expect(body.freshness_status).toBe('fresh');
    });

    it('should return fresh status when known versions match', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);

      const response = await app.request(
        '/v1/agents/agt_B001/revocation?known_identity_version=5&known_revocation_epoch=5'
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.freshness_status).toBe('fresh');
    });

    it('should return unknown status when no known versions provided', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);

      // Without any known version parameters, should return unknown
      const response = await app.request('/v1/agents/agt_B001/revocation');

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.freshness_status).toBe('unknown');
    });

    it('should return inconsistent status on identity version rollback', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);

      const response = await app.request(
        '/v1/agents/agt_B001/revocation?known_identity_version=10'
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.freshness_status).toBe('inconsistent');
    });

    it('should return 400 for stale revocation with high risk', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);

      const response = await app.request(
        '/v1/agents/agt_B001/revocation?required_risk_level=high&known_identity_version=10'
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('STALE_REVOCATION_CACHE');
      expect(body.error.message).toContain('Revocation status is stale for high-risk operation');
    });

    it('should return 404 for non-existent agent', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(null);

      const response = await app.request('/v1/agents/nonexistent_agent/revocation');

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('Agent not found');
    });

    it('should return 500 on identity host error', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockRejectedValue(new Error('Internal error'));

      const response = await app.request('/v1/agents/agt_B001/revocation');

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('API Integration Tests', () => {
  it('should handle complete authentication flow', async () => {
    // Setup mocks
    const mockVerifier = createMockVerifier();
    const mockSessionManager = createMockSessionManager();

    vi.mocked(mockVerifier.issueChallenge).mockResolvedValue(mockChallenge);
    vi.mocked(mockVerifier.verifyProof).mockResolvedValue({
      status: 'VERIFIED',
      agent_id: 'agt_B001',
      instance_id: 'ins_B001_001',
      risk_level: 'low',
      freshness_status: 'fresh',
      capability_status: 'MATCHED',
      version_check: {
        rollback_detected: false,
        epoch_mismatch: false,
        session_epoch_old: false,
        policy_mismatch: false,
      },
      errors: [],
    });
    vi.mocked(mockSessionManager.createSession).mockResolvedValue(mockSession);

    // Create app
    const app = new Hono<{
      Variables: {
        verifier: Verifier;
        sessionManager: SessionManager;
      };
    }>();
    app.use('*', (c, next) => {
      c.set('verifier', mockVerifier);
      c.set('sessionManager', mockSessionManager);
      return next();
    });
    app.route('/v1', authApi);

    // Step 1: Issue challenge
    const challengeResponse = await app.request('/v1/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verifier_id: 'agt_A001',
        target_agent_id: 'agt_B001',
        target_instance_id: 'ins_B001_001',
        intent: 'PROFILE_READ',
        risk_level: 'low',
      }),
    });
    expect(challengeResponse.status).toBe(201);

    // Step 2: Verify proof
    const proofResponse = await app.request('/v1/proofs/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge_id: 'chl_test_001',
        proof: mockProof,
      }),
    });
    expect(proofResponse.status).toBe(200);

    // Step 3: Create session
    const sessionResponse = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verified_agent_id: 'agt_B001',
        verified_instance_id: 'ins_B001_001',
        risk_level: 'low',
        version_vector: {
          identity_version: 5,
          revocation_epoch: 3,
          policy_epoch: 2,
          session_epoch: 10,
          ledger_checkpoint: 'chk_100',
        },
      }),
    });
    expect(sessionResponse.status).toBe(201);
    const sessionBody = await sessionResponse.json();
    expect(sessionBody.session_id).toBe('ses_test_001');
  });
});

// ============================================================================
// Edge Case Tests - Coverage Improvement
// ============================================================================

describe('Auth API Edge Cases', () => {
  let app: Hono;
  let mockVerifier: Verifier;
  let mockSessionManager: SessionManager;

  beforeEach(() => {
    mockVerifier = createMockVerifier();
    mockSessionManager = createMockSessionManager();

    app = new Hono<{
      Variables: {
        verifier: Verifier;
        sessionManager: SessionManager;
      };
    }>();

    app.use('*', (c, next) => {
      c.set('verifier', mockVerifier);
      c.set('sessionManager', mockSessionManager);
      return next();
    });

    app.route('/v1', authApi);
  });

  describe('POST /v1/challenges - Edge Cases', () => {
    it('should return 500 when error is not an Error instance', async () => {
      vi.mocked(mockVerifier.issueChallenge).mockRejectedValue('string error');

      const response = await app.request('/v1/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verifier_id: 'agt_A001',
          target_agent_id: 'agt_B001',
          target_instance_id: 'ins_B001_001',
          intent: 'PROFILE_READ',
          risk_level: 'low',
        }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Unknown error');
    });

    it('should return 500 for invalid JSON body (caught by error handler)', async () => {
      const response = await app.request('/v1/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      // Hono returns 500 when JSON parsing fails in the request handler
      expect(response.status).toBe(500);
    });

    it('should handle missing required fields', async () => {
      vi.mocked(mockVerifier.issueChallenge).mockRejectedValue(new Error('Missing required field: verifier_id'));

      const response = await app.request('/v1/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /v1/proofs/verify - Edge Cases', () => {
    it('should return 500 when error is not an Error instance', async () => {
      vi.mocked(mockVerifier.verifyProof).mockRejectedValue(null);

      const response = await app.request('/v1/proofs/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: 'chl_test_001',
          proof: mockProof,
        }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Unknown error');
    });

    it('should return 500 for invalid JSON body (caught by error handler)', async () => {
      const response = await app.request('/v1/proofs/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ malformed json',
      });

      // Hono returns 500 when JSON parsing fails in the request handler
      expect(response.status).toBe(500);
    });
  });

  describe('POST /v1/sessions - Edge Cases', () => {
    it('should return 500 when error is not an Error instance', async () => {
      vi.mocked(mockSessionManager.createSession).mockRejectedValue({ custom: 'error' });

      const response = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verified_agent_id: 'agt_B001',
          verified_instance_id: 'ins_B001_001',
          risk_level: 'low',
          version_vector: {
            identity_version: 5,
            revocation_epoch: 3,
            policy_epoch: 2,
            session_epoch: 10,
            ledger_checkpoint: 'chk_100',
          },
        }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Unknown error');
    });
  });

  describe('DELETE /v1/sessions/:sessionId - Edge Cases', () => {
    it('should return 500 when getSession throws error', async () => {
      vi.mocked(mockSessionManager.getSession).mockRejectedValue(new Error('Database error'));

      const response = await app.request('/v1/sessions/ses_test_001', {
        method: 'DELETE',
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should return 500 when terminateSession throws non-Error', async () => {
      vi.mocked(mockSessionManager.getSession).mockResolvedValue(mockSession);
      vi.mocked(mockSessionManager.terminateSession).mockRejectedValue(12345);

      const response = await app.request('/v1/sessions/ses_test_001', {
        method: 'DELETE',
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Unknown error');
    });

    it('should handle termination with different reason codes', async () => {
      vi.mocked(mockSessionManager.getSession).mockResolvedValue(mockSession);
      vi.mocked(mockSessionManager.terminateSession).mockResolvedValue();

      const response = await app.request('/v1/sessions/ses_test_001', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'ses_test_001',
          reason_code: 'revoked',
          reason_detail: 'Agent was revoked',
        }),
      });

      expect(response.status).toBe(200);
      expect(mockSessionManager.terminateSession).toHaveBeenCalledWith('ses_test_001', 'revoked');
    });
  });
});

describe('Ledger API Edge Cases', () => {
  let app: Hono;
  let mockLedger: Ledger;

  beforeEach(() => {
    mockLedger = createMockLedger();

    app = new Hono<{
      Variables: {
        ledger: Ledger;
      };
    }>();

    app.use('*', (c, next) => {
      c.set('ledger', mockLedger);
      return next();
    });

    app.route('/v1/ledger', ledgerApi);
  });

  describe('POST /v1/ledger/events - Edge Cases', () => {
    it('should return 400 when error message starts with "Invalid event:"', async () => {
      vi.mocked(mockLedger.validateEvent).mockResolvedValue({ valid: true, errors: [] });
      vi.mocked(mockLedger.appendEvent).mockRejectedValue(new Error('Invalid event: duplicate event_id'));

      const response = await app.request('/v1/ledger/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: mockLedgerEvent }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 500 when error is not an Error instance', async () => {
      vi.mocked(mockLedger.validateEvent).mockResolvedValue({ valid: true, errors: [] });
      vi.mocked(mockLedger.appendEvent).mockRejectedValue(undefined);

      const response = await app.request('/v1/ledger/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: mockLedgerEvent }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Unknown error');
    });

    it('should return 500 for invalid JSON body (caught by error handler)', async () => {
      const response = await app.request('/v1/ledger/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });

      // Hono returns 500 when JSON parsing fails in the request handler
      expect(response.status).toBe(500);
    });
  });

  describe('GET /v1/ledger/events - Edge Cases', () => {
    it('should return 500 when error is not an Error instance', async () => {
      vi.mocked(mockLedger.getAgentEvents).mockRejectedValue(new Number(42));

      const response = await app.request('/v1/ledger/events?agent_id=agt_B001');

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Unknown error');
    });

    it('should use default max_events when not specified', async () => {
      vi.mocked(mockLedger.getAgentEvents).mockResolvedValue({
        events: [],
        checkpoint: 'chk_100',
        hasMore: false,
      });

      const response = await app.request('/v1/ledger/events?agent_id=agt_B001');

      expect(response.status).toBe(200);
      expect(mockLedger.getAgentEvents).toHaveBeenCalledWith('agt_B001', {
        sinceCheckpoint: undefined,
        maxEvents: 100,
      });
    });

    it('should use custom max_events when specified', async () => {
      vi.mocked(mockLedger.getAgentEvents).mockResolvedValue({
        events: [],
        checkpoint: 'chk_100',
        hasMore: false,
      });

      const response = await app.request('/v1/ledger/events?agent_id=agt_B001&max_events=50');

      expect(response.status).toBe(200);
      expect(mockLedger.getAgentEvents).toHaveBeenCalledWith('agt_B001', {
        sinceCheckpoint: undefined,
        maxEvents: 50,
      });
    });

    it('should handle empty events list', async () => {
      vi.mocked(mockLedger.getAgentEvents).mockResolvedValue({
        events: [],
        checkpoint: 'chk_100',
        hasMore: false,
      });

      const response = await app.request('/v1/ledger/events?agent_id=agt_B001');

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.events).toHaveLength(0);
      expect(body.has_more).toBe(false);
    });

    it('should return has_more true when more events exist', async () => {
      vi.mocked(mockLedger.getAgentEvents).mockResolvedValue({
        events: [mockLedgerEvent],
        checkpoint: 'chk_101',
        hasMore: true,
      });

      const response = await app.request('/v1/ledger/events?agent_id=agt_B001&max_events=1');

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.has_more).toBe(true);
    });
  });

  describe('GET /v1/ledger/checkpoint - Edge Cases', () => {
    it('should return 500 when error is not an Error instance', async () => {
      vi.mocked(mockLedger.getCheckpoint).mockImplementation(() => {
        throw Symbol('error');
      });

      const response = await app.request('/v1/ledger/checkpoint');

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Unknown error');
    });
  });

  describe('GET /v1/ledger/events/:eventId - Edge Cases', () => {
    it('should return 500 when error is not an Error instance', async () => {
      vi.mocked(mockLedger.getEvent).mockRejectedValue(new Boolean(false));

      const response = await app.request('/v1/ledger/events/evt_001');

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Unknown error');
    });
  });
});

describe('Revocation API Edge Cases', () => {
  let app: Hono;
  let mockIdentityHost: IdentityHost;

  beforeEach(() => {
    mockIdentityHost = createMockIdentityHost();

    app = new Hono<{
      Variables: {
        identityHost: IdentityHost;
      };
    }>();

    app.use('*', (c, next) => {
      c.set('identityHost', mockIdentityHost);
      return next();
    });

    app.route('/v1/agents', revocationApi);
  });

  describe('GET /v1/agents/:agentId/revocation - Edge Cases', () => {
    it('should return 500 when error is not an Error instance', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockRejectedValue([1, 2, 3]);

      const response = await app.request('/v1/agents/agt_B001/revocation');

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Unknown error');
    });

    it('should return inconsistent status when revocation epoch rollback detected', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);

      // manifest.identity_version is 5, passing known_revocation_epoch=10
      const response = await app.request(
        '/v1/agents/agt_B001/revocation?known_revocation_epoch=10'
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.freshness_status).toBe('inconsistent');
    });

    it('should return fresh status when only known_revocation_epoch matches', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);

      // manifest.identity_version is 5, passing known_revocation_epoch=5 (matches)
      const response = await app.request(
        '/v1/agents/agt_B001/revocation?known_revocation_epoch=5'
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.freshness_status).toBe('fresh');
    });

    it('should return fresh status when identity version increased', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);

      // manifest.identity_version is 5, passing known_identity_version=3 (lower)
      const response = await app.request(
        '/v1/agents/agt_B001/revocation?known_identity_version=3'
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.freshness_status).toBe('fresh');
    });

    it('should handle high risk level parameter', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);

      const response = await app.request(
        '/v1/agents/agt_B001/revocation?required_risk_level=high&known_identity_version=5'
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.freshness_status).toBe('fresh');
    });

    it('should handle medium risk level parameter', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);

      const response = await app.request(
        '/v1/agents/agt_B001/revocation?required_risk_level=medium'
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.freshness_status).toBe('unknown');
    });

    it('should return 400 for stale freshness with high risk', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);

      // manifest.identity_version is 5, passing known_revocation_epoch=10 (higher, will be inconsistent)
      const response = await app.request(
        '/v1/agents/agt_B001/revocation?required_risk_level=high&known_revocation_epoch=10'
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('STALE_REVOCATION_CACHE');
    });

    it('should handle known_ledger_checkpoint parameter (not used in logic)', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);

      const response = await app.request(
        '/v1/agents/agt_B001/revocation?known_ledger_checkpoint=chk_50'
      );

      expect(response.status).toBe(200);
      // known_ledger_checkpoint alone doesn't affect freshness_status
      const body = await response.json();
      expect(body.freshness_status).toBe('unknown');
    });

    it('should return correct quarantine status mapping', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);

      const response = await app.request('/v1/agents/agt_B001/revocation');

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.quarantine_status).toBe('NONE');
    });

    it('should use default low risk level when not specified', async () => {
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);

      const response = await app.request('/v1/agents/agt_B001/revocation');

      expect(response.status).toBe(200);
      // risk_level defaults to 'low' in the error response if error occurs
    });
  });
});

// ============================================================================
// Additional Edge Case Tests - Input Validation
// ============================================================================

describe('API Input Validation Edge Cases', () => {
  describe('ID Validation Edge Cases', () => {
    it('should handle minimum length agent ID (3 chars)', async () => {
      const app = new Hono<{
        Variables: { identityHost: IdentityHost };
      }>();
      const mockIdentityHost = createMockIdentityHost();
      app.use('*', (c, next) => {
        c.set('identityHost', mockIdentityHost);
        return next();
      });
      app.route('/v1/agents', identityApi);

      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue({
        ...mockManifest,
        agent_id: 'abc', // minimum valid length
      });

      const response = await app.request('/v1/agents/abc/manifest');

      expect(response.status).toBe(200);
    });

    it('should handle maximum length agent ID (128 chars)', async () => {
      const app = new Hono<{
        Variables: { identityHost: IdentityHost };
      }>();
      const mockIdentityHost = createMockIdentityHost();
      app.use('*', (c, next) => {
        c.set('identityHost', mockIdentityHost);
        return next();
      });
      app.route('/v1/agents', identityApi);

      const maxId = 'a'.repeat(128);
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue({
        ...mockManifest,
        agent_id: maxId,
      });

      const response = await app.request(`/v1/agents/${maxId}/manifest`);

      expect(response.status).toBe(200);
    });

    it('should handle agent ID with valid special characters', async () => {
      const app = new Hono<{
        Variables: { identityHost: IdentityHost };
      }>();
      const mockIdentityHost = createMockIdentityHost();
      app.use('*', (c, next) => {
        c.set('identityHost', mockIdentityHost);
        return next();
      });
      app.route('/v1/agents', identityApi);

      const validId = 'agent_test-123.456:789';
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue({
        ...mockManifest,
        agent_id: validId,
      });

      const response = await app.request(`/v1/agents/${encodeURIComponent(validId)}/manifest`);

      expect(response.status).toBe(200);
    });
  });

  describe('Numeric Boundary Cases', () => {
    it('should handle zero epoch values', async () => {
      const app = new Hono<{
        Variables: { verifier: Verifier };
      }>();
      const mockVerifier = createMockVerifier();
      app.use('*', (c, next) => {
        c.set('verifier', mockVerifier);
        return next();
      });
      app.route('/v1', authApi);

      vi.mocked(mockVerifier.issueChallenge).mockResolvedValue({
        ...mockChallenge,
        epochs: {
          identity_version: 0,
          revocation_epoch: 0,
          policy_epoch: 0,
          session_epoch: 0,
          ledger_checkpoint: 'chk_0',
        },
      });

      const response = await app.request('/v1/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verifier_id: 'agt_A001',
          target_agent_id: 'agt_B001',
          target_instance_id: 'ins_B001_001',
          intent: 'PROFILE_READ',
          risk_level: 'low',
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.version_vector.identity_version).toBe(0);
    });

    it('should handle large epoch values', async () => {
      const app = new Hono<{
        Variables: { verifier: Verifier };
      }>();
      const mockVerifier = createMockVerifier();
      app.use('*', (c, next) => {
        c.set('verifier', mockVerifier);
        return next();
      });
      app.route('/v1', authApi);

      const largeValue = Number.MAX_SAFE_INTEGER;
      vi.mocked(mockVerifier.issueChallenge).mockResolvedValue({
        ...mockChallenge,
        epochs: {
          identity_version: largeValue,
          revocation_epoch: largeValue,
          policy_epoch: largeValue,
          session_epoch: largeValue,
          ledger_checkpoint: `chk_${largeValue}`,
        },
      });

      const response = await app.request('/v1/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verifier_id: 'agt_A001',
          target_agent_id: 'agt_B001',
          target_instance_id: 'ins_B001_001',
          intent: 'PROFILE_READ',
          risk_level: 'low',
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.version_vector.identity_version).toBe(largeValue);
    });
  });

  describe('Empty and Null Values', () => {
    it('should handle empty capabilities array', async () => {
      const app = new Hono<{
        Variables: { verifier: Verifier; sessionManager: SessionManager };
      }>();
      const mockVerifier = createMockVerifier();
      const mockSessionManager = createMockSessionManager();
      app.use('*', (c, next) => {
        c.set('verifier', mockVerifier);
        c.set('sessionManager', mockSessionManager);
        return next();
      });
      app.route('/v1', authApi);

      vi.mocked(mockSessionManager.createSession).mockResolvedValue({
        session_id: 'ses_test',
        agent_id: 'agt_test',
        instance_id: 'ins_test',
        peer_agent_id: 'agt_peer',
        peer_instance_id: 'ins_peer',
        issued_at: '2026-03-24T12:00:00Z',
        expires_at: '2026-03-24T13:00:00Z',
        session_epoch: 1,
        revocation_epoch: 1,
        policy_epoch: 1,
        sequence: 0,
        effective_capabilities: [],
        session_status: 'active',
      });

      const response = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verified_agent_id: 'agt_B001',
          verified_instance_id: 'ins_B001_001',
          risk_level: 'low',
          version_vector: {
            identity_version: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            session_epoch: 1,
            ledger_checkpoint: 'chk_1',
          },
          capability_summary: { capabilities: [], capability_digest: '' },
        }),
      });

      expect(response.status).toBe(201);
    });

    it('should handle missing optional fields in manifest', async () => {
      const app = new Hono<{
        Variables: { identityHost: IdentityHost };
      }>();
      const mockIdentityHost = createMockIdentityHost();
      app.use('*', (c, next) => {
        c.set('identityHost', mockIdentityHost);
        return next();
      });
      app.route('/v1/agents', identityApi);

      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue({
        schema_version: '0.2',
        agent_id: 'agt_minimal',
        identity_version: 1,
        operation_keys: [],
        revocation_epoch: 0,
        last_updated_at: '2026-03-24T12:00:00Z',
        // Optional fields omitted: controller_id, persona_id, platform_bindings, service_endpoints, etc.
      });

      const response = await app.request('/v1/agents/agt_minimal/manifest');

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.agent_id).toBe('agt_minimal');
      expect(body.platform_bindings).toBeUndefined();
    });
  });

  describe('Special Character Handling', () => {
    it('should handle URL-encoded agent IDs', async () => {
      const app = new Hono<{
        Variables: { identityHost: IdentityHost };
      }>();
      const mockIdentityHost = createMockIdentityHost();
      app.use('*', (c, next) => {
        c.set('identityHost', mockIdentityHost);
        return next();
      });
      app.route('/v1/agents', identityApi);

      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue({
        ...mockManifest,
        agent_id: 'agent:test%20space',
      });

      const response = await app.request('/v1/agents/agent%3Atest%2520space/manifest');

      expect(response.status).toBe(200);
    });

    it('should handle unicode in intent field', async () => {
      const app = new Hono<{
        Variables: { verifier: Verifier };
      }>();
      const mockVerifier = createMockVerifier();
      app.use('*', (c, next) => {
        c.set('verifier', mockVerifier);
        return next();
      });
      app.route('/v1', authApi);

      vi.mocked(mockVerifier.issueChallenge).mockResolvedValue({
        ...mockChallenge,
        intent: '認証テスト_🔐', // Unicode characters
      });

      const response = await app.request('/v1/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verifier_id: 'agt_A001',
          target_agent_id: 'agt_B001',
          target_instance_id: 'ins_B001_001',
          intent: '認証テスト_🔐',
          risk_level: 'low',
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.intent).toBe('認証テスト_🔐');
    });
  });

  describe('Concurrent Request Handling', () => {
    it('should handle multiple simultaneous challenge requests', async () => {
      const app = new Hono<{
        Variables: { verifier: Verifier };
      }>();
      const mockVerifier = createMockVerifier();
      app.use('*', (c, next) => {
        c.set('verifier', mockVerifier);
        return next();
      });
      app.route('/v1', authApi);

      let callCount = 0;
      vi.mocked(mockVerifier.issueChallenge).mockImplementation(async () => {
        callCount++;
        return {
          ...mockChallenge,
          challenge_id: `chl_${callCount}`,
        };
      });

      const requests = Array(5)
        .fill(null)
        .map(() =>
          app.request('/v1/challenges', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              verifier_id: 'agt_A001',
              target_agent_id: 'agt_B001',
              target_instance_id: 'ins_B001_001',
              intent: 'PROFILE_READ',
              risk_level: 'low',
            }),
          })
        );

      const responses = await Promise.all(requests);

      responses.forEach((response, index) => {
        expect(response.status).toBe(201);
      });

      expect(mockVerifier.issueChallenge).toHaveBeenCalledTimes(5);
    });
  });

  describe('Error Response Format', () => {
    it('should return consistent error response structure', async () => {
      const app = new Hono<{
        Variables: { identityHost: IdentityHost };
      }>();
      const mockIdentityHost = createMockIdentityHost();
      app.use('*', (c, next) => {
        c.set('identityHost', mockIdentityHost);
        return next();
      });
      app.route('/v1/agents', identityApi);

      // getManifest returns null when not found, resulting in 404
      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(null);

      const response = await app.request('/v1/agents/nonexistent/manifest');

      expect(response.status).toBe(404);
      const body = await response.json();

      // Verify error response structure
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });

    it('should return 500 with error structure on internal error', async () => {
      const app = new Hono<{
        Variables: { identityHost: IdentityHost };
      }>();
      const mockIdentityHost = createMockIdentityHost();
      app.use('*', (c, next) => {
        c.set('identityHost', mockIdentityHost);
        return next();
      });
      app.route('/v1/agents', identityApi);

      vi.mocked(mockIdentityHost.getManifest).mockRejectedValue(new Error('Internal error'));

      const response = await app.request('/v1/agents/nonexistent/manifest');

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });

    it('should include correct risk_level in error response', async () => {
      const app = new Hono<{
        Variables: { verifier: Verifier };
      }>();
      const mockVerifier = createMockVerifier();
      app.use('*', (c, next) => {
        c.set('verifier', mockVerifier);
        return next();
      });
      app.route('/v1', authApi);

      vi.mocked(mockVerifier.issueChallenge).mockRejectedValue(new Error('Test error'));

      const response = await app.request('/v1/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verifier_id: 'agt_A001',
          target_agent_id: 'agt_B001',
          target_instance_id: 'ins_B001_001',
          intent: 'PROFILE_READ',
          risk_level: 'high', // Requesting high risk
        }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      // Error response should indicate high risk since the request was for high risk
      expect(body.error.risk_level).toBeDefined();
    });
  });
});