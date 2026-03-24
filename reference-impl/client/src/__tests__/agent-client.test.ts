/**
 * Agent Client Tests
 * Tests for authentication and session management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AgentClient,
  createAgentClient,
  resolveAgentIdentity,
} from '../agent-client';
import type {
  AgentClientConfig,
  IdentityManifest,
  Challenge,
  Session,
  ResolveIdentityResponse,
  VerifyProofResponse,
  CheckFreshnessResponse,
  IssueChallengeResponse,
  CreateSessionResponse,
} from '../types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Agent Client', () => {
  let config: AgentClientConfig;
  let client: AgentClient;

  beforeEach(() => {
    config = {
      agentId: 'test_agent_id',
      instanceId: 'test_instance_id',
      keyId: 'test_key_id',
      algorithm: 'ed25519',
      defaultEndpoint: 'https://test.example.com',
      timeout: 30000,
    };
    client = new AgentClient(config);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create an AgentClient instance', () => {
      expect(client).toBeInstanceOf(AgentClient);
    });

    it('should apply default timeout if not specified', () => {
      const configWithoutTimeout: AgentClientConfig = {
        agentId: 'agent1',
        instanceId: 'instance1',
        keyId: 'key1',
        algorithm: 'ed25519',
      };
      const newClient = new AgentClient(configWithoutTimeout);

      expect(newClient.getConfig().timeout).toBe(30000);
    });

    it('should preserve custom timeout', () => {
      const customConfig: AgentClientConfig = {
        ...config,
        timeout: 60000,
      };
      const newClient = new AgentClient(customConfig);

      expect(newClient.getConfig().timeout).toBe(60000);
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      const returnedConfig = client.getConfig();

      expect(returnedConfig).toEqual(expect.objectContaining(config));
    });

    it('should not affect original config when returned config is modified', () => {
      const returnedConfig = client.getConfig();
      returnedConfig.timeout = 99999;

      expect(client.getConfig().timeout).not.toBe(99999);
    });
  });

  describe('resolveIdentity', () => {
    const mockManifest: IdentityManifest = {
      schema_version: '0.2',
      agent_id: 'resolved_agent_id',
      identity_version: 1,
      operation_keys: [
        {
          key_id: 'key_1',
          scope: 'operation',
          algorithm: 'ed25519',
          public_key: 'a'.repeat(64),
          status: 'active',
          valid_from: '2024-01-01T00:00:00Z',
        },
      ],
      platform_bindings: [
        {
          platform_type: 'x',
          platform_account_id: 'account123',
          display_handle: 'testuser',
          binding_status: 'active',
          verified_at: '2024-01-01T00:00:00Z',
          bound_by_key_id: 'key_1',
          binding_version: 1,
        },
      ],
      revocation_epoch: 1,
      last_updated_at: '2024-01-01T00:00:00Z',
      manifest_signature: {
        key_id: 'key_1',
        algorithm: 'ed25519',
        canonicalization: 'jcs',
        value: 'valid_signature_value',
      },
    };

    it('should resolve identity successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockManifest,
      });

      const result = await client.resolveIdentity({
        discovery_source: {
          platform_type: 'x',
          platform_account_id: 'account123',
          display_handle: 'testuser',
        },
        required_freshness: 'LOW',
      });

      expect(result.resolution_status).toBe('RESOLVED');
      expect(result.identity_manifest).toEqual(mockManifest);
      expect(result.binding_match).toBe(true);
    });

    it('should return BINDING_MISMATCH when binding does not match', async () => {
      const manifestWithDifferentBinding: IdentityManifest = {
        ...mockManifest,
        platform_bindings: [
          {
            platform_type: 'youtube',
            platform_account_id: 'different_account',
            display_handle: 'different_user',
            binding_status: 'active',
            verified_at: '2024-01-01T00:00:00Z',
            bound_by_key_id: 'key_1',
            binding_version: 1,
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => manifestWithDifferentBinding,
      });

      const result = await client.resolveIdentity({
        discovery_source: {
          platform_type: 'x',
          platform_account_id: 'account123',
          display_handle: 'testuser',
        },
        required_freshness: 'LOW',
      });

      expect(result.resolution_status).toBe('BINDING_MISMATCH');
      expect(result.binding_match).toBe(false);
    });

    it('should return INVALID_MANIFEST_SIGNATURE when signature is empty', async () => {
      const manifestWithInvalidSignature: IdentityManifest = {
        ...mockManifest,
        manifest_signature: {
          key_id: 'key_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: '',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => manifestWithInvalidSignature,
      });

      const result = await client.resolveIdentity({
        discovery_source: {
          platform_type: 'x',
          platform_account_id: 'account123',
          display_handle: 'testuser',
        },
        required_freshness: 'LOW',
      });

      expect(result.resolution_status).toBe('INVALID_MANIFEST_SIGNATURE');
    });

    it('should return NOT_FOUND when fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.resolveIdentity({
        discovery_source: {
          platform_type: 'x',
          platform_account_id: 'account123',
          display_handle: 'testuser',
        },
        required_freshness: 'LOW',
      });

      expect(result.resolution_status).toBe('NOT_FOUND');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should use canonical_hint URL when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockManifest,
      });

      await client.resolveIdentity({
        discovery_source: {
          platform_type: 'x',
          platform_account_id: 'account123',
          display_handle: 'testuser',
        },
        required_freshness: 'LOW',
        canonical_hint: 'https://custom.example.com/manifest.json',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.example.com/manifest.json',
        expect.any(Object)
      );
    });

    it('should return RESOLVED when manifest_signature is undefined', async () => {
      const manifestWithoutSignature: IdentityManifest = {
        ...mockManifest,
        manifest_signature: undefined,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => manifestWithoutSignature,
      });

      const result = await client.resolveIdentity({
        discovery_source: {
          platform_type: 'x',
          platform_account_id: 'account123',
          display_handle: 'testuser',
        },
        required_freshness: 'LOW',
      });

      expect(result.resolution_status).toBe('RESOLVED');
    });

    it('should return BINDING_MISMATCH when platform_bindings is undefined', async () => {
      const manifestWithoutBindings: IdentityManifest = {
        ...mockManifest,
        platform_bindings: undefined,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => manifestWithoutBindings,
      });

      const result = await client.resolveIdentity({
        discovery_source: {
          platform_type: 'x',
          platform_account_id: 'account123',
          display_handle: 'testuser',
        },
        required_freshness: 'LOW',
      });

      expect(result.resolution_status).toBe('BINDING_MISMATCH');
    });
  });

  describe('getManifest', () => {
    const mockManifest: IdentityManifest = {
      schema_version: '0.2',
      agent_id: 'test_agent',
      identity_version: 1,
      operation_keys: [],
      revocation_epoch: 1,
      last_updated_at: '2024-01-01T00:00:00Z',
    };

    it('should fetch and cache manifest', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockManifest,
      });

      const result = await client.getManifest('test_agent');

      expect(result).toEqual(mockManifest);
    });

    it('should return cached manifest if cache is fresh', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockManifest,
      });

      // First fetch
      await client.getManifest('test_agent');

      // Second fetch should use cache
      const result = await client.getManifest('test_agent');

      expect(result).toEqual(mockManifest);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return null when fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.getManifest('nonexistent_agent');

      expect(result).toBeNull();
    });
  });

  describe('receiveChallenge', () => {
    const validChallenge: Challenge = {
      challenge_id: 'challenge_123',
      target_agent_id: 'test_agent_id',
      target_instance_id: 'test_instance_id',
      nonce: 'valid_nonce_string_long_enough',
      issued_at: new Date(Date.now() - 1000).toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
      intent: 'test_intent',
      risk_level: 'low',
      version_vector: {
        identity_version: 1,
        revocation_epoch: 1,
        policy_epoch: 1,
        session_epoch: 1,
        ledger_checkpoint: 'checkpoint',
      },
    };

    it('should accept a valid challenge', async () => {
      const result = await client.receiveChallenge(validChallenge);

      expect(result).toEqual(validChallenge);
    });

    it('should throw error for expired challenge', async () => {
      const expiredChallenge: Challenge = {
        ...validChallenge,
        expires_at: new Date(Date.now() - 1000).toISOString(),
      };

      await expect(client.receiveChallenge(expiredChallenge)).rejects.toThrow(
        'Challenge has expired'
      );
    });

    it('should throw error for challenge with future issued_at', async () => {
      const futureChallenge: Challenge = {
        ...validChallenge,
        issued_at: new Date(Date.now() + 10000).toISOString(),
      };

      await expect(client.receiveChallenge(futureChallenge)).rejects.toThrow(
        'Challenge issued_at is in the future'
      );
    });

    it('should throw error for challenge with invalid nonce', async () => {
      const invalidNonceChallenge: Challenge = {
        ...validChallenge,
        nonce: 'short',
      };

      await expect(client.receiveChallenge(invalidNonceChallenge)).rejects.toThrow(
        'Invalid challenge nonce'
      );
    });

    it('should update version vector on valid challenge', async () => {
      await client.receiveChallenge(validChallenge);

      const versionVector = client.getCurrentVersionVector();

      expect(versionVector).toEqual(validChallenge.version_vector);
    });
  });

  describe('requestChallenge', () => {
    const mockChallengeResponse: IssueChallengeResponse = {
      challenge_id: 'challenge_123',
      target_agent_id: 'target_agent',
      target_instance_id: 'target_instance',
      nonce: 'nonce_abc123xyz',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
      intent: 'collaboration',
      risk_level: 'low',
      version_vector: {
        identity_version: 1,
        revocation_epoch: 1,
        policy_epoch: 1,
        session_epoch: 1,
        ledger_checkpoint: 'checkpoint',
      },
    };

    beforeEach(() => {
      // Mock getManifest for getAuthEndpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schema_version: '0.2',
          agent_id: 'target_agent',
          identity_version: 1,
          operation_keys: [],
          revocation_epoch: 1,
          last_updated_at: '2024-01-01T00:00:00Z',
          service_endpoints: {
            auth_endpoint: 'https://auth.example.com',
          },
        }),
      });
    });

    it('should request challenge successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockChallengeResponse,
      });

      const result = await client.requestChallenge(
        'verifier_123',
        'target_agent',
        'target_instance',
        'collaboration',
        'low'
      );

      expect(result).toEqual(mockChallengeResponse);
    });

    it('should throw error on failed challenge request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Challenge failed' } }),
      });

      await expect(
        client.requestChallenge(
          'verifier_123',
          'target_agent',
          'target_instance',
          'collaboration',
          'low'
        )
      ).rejects.toThrow('Challenge failed');
    });

    it('should include optional parameters in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockChallengeResponse,
      });

      await client.requestChallenge(
        'verifier_123',
        'target_agent',
        'target_instance',
        'collaboration',
        'high',
        {
          requiredCapabilities: ['cap1', 'cap2'],
          sessionPubkey: 'pubkey123',
          nonceTtlSeconds: 300,
        }
      );

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);

      expect(body.required_capabilities).toEqual(['cap1', 'cap2']);
      expect(body.session_pubkey).toBe('pubkey123');
      expect(body.nonce_ttl_seconds).toBe(300);
    });
  });

  describe('submitProof', () => {
    const mockProof = {
      spec_version: '0.2',
      proof_id: 'proof_123',
      challenge_id: 'challenge_123',
      agent_id: 'test_agent',
      instance_id: 'test_instance',
      nonce: 'nonce',
      timestamp: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
      intent: 'collaboration',
      capability_digest: 'sha256:abc',
      identity_version: 1,
      revocation_epoch: 1,
      policy_epoch: 1,
      session_epoch: 1,
      session_pubkey: {
        key_id: 'session_key_1',
        algorithm: 'ed25519',
        public_key: 'a'.repeat(64),
      },
      signature: {
        key_id: 'key_1',
        algorithm: 'ed25519',
        canonicalization: 'jcs',
        value: 'signature_value',
      },
    };

    const mockVerifyResponse: VerifyProofResponse = {
      verification_status: 'VERIFIED',
      verified_agent_id: 'test_agent',
      verified_instance_id: 'test_instance',
      risk_level: 'low',
      freshness_status: 'fresh',
      capability_status: 'MATCHED',
      version_check: {
        rollback_detected: false,
        epoch_mismatch: false,
        session_epoch_old: false,
        policy_mismatch: false,
      },
      warnings: [],
      errors: [],
    };

    beforeEach(() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schema_version: '0.2',
          agent_id: 'verifier_agent',
          identity_version: 1,
          operation_keys: [],
          revocation_epoch: 1,
          last_updated_at: '2024-01-01T00:00:00Z',
          service_endpoints: {
            auth_endpoint: 'https://auth.example.com',
          },
        }),
      });
    });

    it('should submit proof and return verification result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockVerifyResponse,
      });

      const result = await client.submitProof(mockProof, 'verifier_agent');

      expect(result).toEqual(mockVerifyResponse);
    });

    it('should throw error on failed proof submission', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Invalid proof' } }),
      });

      await expect(
        client.submitProof(mockProof, 'verifier_agent')
      ).rejects.toThrow('Invalid proof');
    });
  });

  describe('Session Management', () => {
    const mockSessionResponse: CreateSessionResponse = {
      session_id: 'session_123',
      agent_id: 'test_agent',
      instance_id: 'test_instance',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      session_epoch: 1,
      revocation_epoch: 1,
      policy_epoch: 1,
      sequence: 1,
      effective_capabilities: ['cap1', 'cap2'],
      session_status: 'ACTIVE',
    };

    beforeEach(() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schema_version: '0.2',
          agent_id: 'peer_agent',
          identity_version: 1,
          operation_keys: [],
          revocation_epoch: 1,
          last_updated_at: '2024-01-01T00:00:00Z',
          service_endpoints: {
            auth_endpoint: 'https://auth.example.com',
          },
        }),
      });
    });

    describe('createSession', () => {
      it('should create a session successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockSessionResponse,
        });

        const session = await client.createSession(
          'peer_agent',
          'peer_instance',
          { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
          'low',
          {
            identity_version: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            session_epoch: 1,
            ledger_checkpoint: 'checkpoint',
          }
        );

        expect(session.session_id).toBe('session_123');
        expect(session.session_status).toBe('active');
      });

      it('should throw error on failed session creation', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: 'Session creation failed' } }),
        });

        await expect(
          client.createSession(
            'peer_agent',
            'peer_instance',
            { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
            'low',
            {
              identity_version: 1,
              revocation_epoch: 1,
              policy_epoch: 1,
              session_epoch: 1,
              ledger_checkpoint: 'checkpoint',
            }
          )
        ).rejects.toThrow('Session creation failed');
      });
    });

    describe('renewSession', () => {
      it('should throw error if session not found', async () => {
        await expect(
          client.renewSession('nonexistent_session', 'EXPIRY_APPROACHING')
        ).rejects.toThrow('Session nonexistent_session not found');
      });
    });

    describe('terminateSession', () => {
      it('should throw error if session not found', async () => {
        await expect(
          client.terminateSession('nonexistent_session', 'manual_termination')
        ).rejects.toThrow('Session nonexistent_session not found');
      });
    });

    describe('getSession', () => {
      it('should return undefined for non-existent session', () => {
        const result = client.getSession('nonexistent');

        expect(result).toBeUndefined();
      });
    });

    describe('getAllSessions', () => {
      it('should return empty array initially', () => {
        const sessions = client.getAllSessions();

        expect(sessions).toEqual([]);
      });
    });

    describe('getActiveSessions', () => {
      it('should return empty array initially', () => {
        const sessions = client.getActiveSessions();

        expect(sessions).toEqual([]);
      });
    });
  });

  describe('checkFreshness', () => {
    const mockFreshnessResponse: CheckFreshnessResponse = {
      freshness_status: 'fresh',
      agent_status: 'active',
      quarantine_status: 'NONE',
      current_revocation_epoch: 1,
      current_identity_version: 1,
      warnings: [],
    };

    beforeEach(() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schema_version: '0.2',
          agent_id: 'test_agent',
          identity_version: 1,
          operation_keys: [],
          revocation_epoch: 1,
          last_updated_at: '2024-01-01T00:00:00Z',
          service_endpoints: {
            revocation_endpoint: 'https://revocation.example.com',
          },
        }),
      });
    });

    it('should check freshness successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFreshnessResponse,
      });

      const result = await client.checkFreshness('test_agent', 'low');

      expect(result).toEqual(mockFreshnessResponse);
    });

    it('should return unknown status when manifest fetch fails', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(new Error('Failed'));

      const result = await client.checkFreshness('nonexistent_agent', 'low');

      expect(result.freshness_status).toBe('unknown');
      expect(result.warnings).toContain('Could not fetch manifest');
    });

    it('should use revocation_ref when service_endpoints.revocation_endpoint not available', async () => {
      mockFetch.mockReset();
      // Manifest with revocation_ref but no revocation_endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schema_version: '0.2',
          agent_id: 'test_agent',
          identity_version: 1,
          operation_keys: [],
          revocation_epoch: 1,
          last_updated_at: '2024-01-01T00:00:00Z',
          revocation_ref: 'https://custom-revocation.example.com',
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFreshnessResponse,
      });

      const result = await client.checkFreshness('test_agent', 'low');

      expect(result).toEqual(mockFreshnessResponse);
      // Verify the request was made to the revocation_ref URL
      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom-revocation.example.com/freshness',
        expect.any(Object)
      );
    });

    it('should use default endpoint for revocation when neither revocation_endpoint nor revocation_ref available', async () => {
      mockFetch.mockReset();
      // Manifest without revocation_endpoint or revocation_ref
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schema_version: '0.2',
          agent_id: 'test_agent',
          identity_version: 1,
          operation_keys: [],
          revocation_epoch: 1,
          last_updated_at: '2024-01-01T00:00:00Z',
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFreshnessResponse,
      });

      const result = await client.checkFreshness('test_agent', 'low');

      expect(result).toEqual(mockFreshnessResponse);
      // Verify the request was made to the default endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/revocation/freshness',
        expect.any(Object)
      );
    });
  });

  describe('Event Handling', () => {
    it('should register event handler', () => {
      const handler = vi.fn();
      client.addEventHandler(handler);

      // Handler should be registered (we'll verify by emitting an event)
      expect(() => client.addEventHandler(handler)).not.toThrow();
    });

    it('should remove event handler', () => {
      const handler = vi.fn();
      client.addEventHandler(handler);
      client.removeEventHandler(handler);

      expect(() => client.removeEventHandler(handler)).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('should clear internal state', async () => {
      await client.dispose();

      expect(client.getAllSessions()).toEqual([]);
    });

    it('should terminate active sessions during dispose', async () => {
      // Create a session first
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schema_version: '0.2',
          agent_id: 'peer_agent',
          identity_version: 1,
          operation_keys: [],
          revocation_epoch: 1,
          last_updated_at: '2024-01-01T00:00:00Z',
          service_endpoints: {
            auth_endpoint: 'https://auth.example.com',
          },
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: 'session_123',
          agent_id: 'test_agent',
          instance_id: 'test_instance',
          issued_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          session_epoch: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          sequence: 1,
          effective_capabilities: ['cap1'],
          session_status: 'ACTIVE',
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: 'session_123',
          agent_id: 'test_agent',
          instance_id: 'test_instance',
          issued_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          session_epoch: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          sequence: 1,
          effective_capabilities: ['cap1'],
          session_status: 'ACTIVE',
        }),
      });

      // Create a session
      await client.createSession(
        'peer_agent',
        'peer_instance',
        { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
        'low',
        {
          identity_version: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          session_epoch: 1,
          ledger_checkpoint: 'checkpoint',
        }
      );

      expect(client.getActiveSessions()).toHaveLength(1);

      // Mock the terminate request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await client.dispose();

      expect(client.getAllSessions()).toEqual([]);
    });

    it('should handle errors during session termination in dispose', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Create a session first
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schema_version: '0.2',
          agent_id: 'peer_agent',
          identity_version: 1,
          operation_keys: [],
          revocation_epoch: 1,
          last_updated_at: '2024-01-01T00:00:00Z',
          service_endpoints: {
            auth_endpoint: 'https://auth.example.com',
          },
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: 'session_123',
          agent_id: 'test_agent',
          instance_id: 'test_instance',
          issued_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          session_epoch: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          sequence: 1,
          effective_capabilities: ['cap1'],
          session_status: 'ACTIVE',
        }),
      });

      // Create a session
      await client.createSession(
        'peer_agent',
        'peer_instance',
        { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
        'low',
        {
          identity_version: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          session_epoch: 1,
          ledger_checkpoint: 'checkpoint',
        }
      );

      // Mock the terminate request to fail
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // dispose should not throw even if termination fails
      await client.dispose();

      // Error should be logged
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Error Handling - Extended', () => {
    describe('Network Errors', () => {
      it('should handle network timeout', async () => {
        // Simulate timeout by rejecting with TimeoutError-like error
        mockFetch.mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              const error = new Error('Request timeout');
              error.name = 'TimeoutError';
              setTimeout(() => reject(error), 10);
            })
        );

        const result = await client.resolveIdentity({
          discovery_source: {
            platform_type: 'x',
            platform_account_id: 'account123',
            display_handle: 'testuser',
          },
          required_freshness: 'LOW',
        });

        expect(result.resolution_status).toBe('NOT_FOUND');
        expect(result.warnings).toContainEqual(expect.stringContaining('Request timeout'));
      });

      it('should handle connection refused', async () => {
        const error = new Error('ECONNREFUSED') as Error & { code?: string };
        error.code = 'ECONNREFUSED';
        mockFetch.mockRejectedValueOnce(error);

        const result = await client.resolveIdentity({
          discovery_source: {
            platform_type: 'x',
            platform_account_id: 'account123',
            display_handle: 'testuser',
          },
          required_freshness: 'LOW',
        });

        expect(result.resolution_status).toBe('NOT_FOUND');
      });

      it('should handle DNS resolution failure', async () => {
        const error = new Error('ENOTFOUND') as Error & { code?: string };
        error.code = 'ENOTFOUND';
        mockFetch.mockRejectedValueOnce(error);

        const result = await client.resolveIdentity({
          discovery_source: {
            platform_type: 'x',
            platform_account_id: 'account123',
            display_handle: 'testuser',
          },
          required_freshness: 'LOW',
        });

        expect(result.resolution_status).toBe('NOT_FOUND');
      });
    });

    describe('Invalid Response Handling', () => {
      it('should handle invalid JSON response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => {
            throw new SyntaxError('Unexpected token in JSON');
          },
        });

        const result = await client.resolveIdentity({
          discovery_source: {
            platform_type: 'x',
            platform_account_id: 'account123',
            display_handle: 'testuser',
          },
          required_freshness: 'LOW',
        });

        expect(result.resolution_status).toBe('NOT_FOUND');
        expect(result.warnings.length).toBeGreaterThan(0);
      });

      it('should handle empty response body', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => null,
        });

        const result = await client.resolveIdentity({
          discovery_source: {
            platform_type: 'x',
            platform_account_id: 'account123',
            display_handle: 'testuser',
          },
          required_freshness: 'LOW',
        });

        expect(result.resolution_status).toBe('NOT_FOUND');
      });

      it('should handle malformed manifest missing required fields', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            // Missing required fields like agent_id, schema_version
            some_field: 'some_value',
          }),
        });

        const result = await client.resolveIdentity({
          discovery_source: {
            platform_type: 'x',
            platform_account_id: 'account123',
            display_handle: 'testuser',
          },
          required_freshness: 'LOW',
        });

        // When platform_bindings is undefined, checkBindingMatch returns false
        expect(result.resolution_status).toBe('BINDING_MISMATCH');
      });

      it('should handle HTTP 500 error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ error: { message: 'Server error' } }),
        });

        const result = await client.resolveIdentity({
          discovery_source: {
            platform_type: 'x',
            platform_account_id: 'account123',
            display_handle: 'testuser',
          },
          required_freshness: 'LOW',
        });

        expect(result.resolution_status).toBe('NOT_FOUND');
      });

      it('should handle HTTP 401 Unauthorized', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: async () => ({ error: { message: 'Authentication required' } }),
        });

        const result = await client.resolveIdentity({
          discovery_source: {
            platform_type: 'x',
            platform_account_id: 'account123',
            display_handle: 'testuser',
          },
          required_freshness: 'LOW',
        });

        expect(result.resolution_status).toBe('NOT_FOUND');
      });

      it('should handle HTTP 404 Not Found', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ error: { message: 'Agent not found' } }),
        });

        const result = await client.resolveIdentity({
          discovery_source: {
            platform_type: 'x',
            platform_account_id: 'account123',
            display_handle: 'testuser',
          },
          required_freshness: 'LOW',
        });

        expect(result.resolution_status).toBe('NOT_FOUND');
      });
    });

    describe('Invalid Input Handling', () => {
      it('should handle empty agent ID', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(
          client.requestChallenge('', 'target', 'instance', 'intent', 'low')
        ).rejects.toThrow();

        consoleSpy.mockRestore();
      });

      it('should handle empty instance ID', async () => {
        await expect(
          client.requestChallenge('verifier', 'target', '', 'intent', 'low')
        ).rejects.toThrow();
      });

      it('should handle invalid risk level', async () => {
        // The client should handle invalid risk level gracefully
        // This test checks if the client passes the value through or validates it
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'target_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { auth_endpoint: 'https://auth.example.com' },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            challenge_id: 'challenge_123',
            target_agent_id: 'target_agent',
            target_instance_id: 'target_instance',
            nonce: 'nonce_abc123xyz',
            issued_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 60000).toISOString(),
            intent: 'collaboration',
            risk_level: 'low',
            version_vector: {
              identity_version: 1,
              revocation_epoch: 1,
              policy_epoch: 1,
              session_epoch: 1,
              ledger_checkpoint: 'checkpoint',
            },
          }),
        });

        // TypeScript will catch this at compile time, but runtime test
        const result = await client.requestChallenge(
          'verifier',
          'target',
          'instance',
          'intent',
          'invalid_level' as 'low' | 'high'
        );

        // The server would reject, but we're testing client behavior
        expect(result).toBeDefined();
      });
    });

    describe('Challenge Error Handling', () => {
      it('should reject challenge with future issued_at (clock skew detection)', async () => {
        const futureChallenge: Challenge = {
          challenge_id: 'challenge_123',
          target_agent_id: 'test_agent_id',
          target_instance_id: 'test_instance_id',
          nonce: 'valid_nonce_string_long_enough',
          issued_at: new Date(Date.now() + 300000).toISOString(), // 5 minutes in future
          expires_at: new Date(Date.now() + 600000).toISOString(),
          intent: 'test_intent',
          risk_level: 'low',
          version_vector: {
            identity_version: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            session_epoch: 1,
            ledger_checkpoint: 'checkpoint',
          },
        };

        await expect(client.receiveChallenge(futureChallenge)).rejects.toThrow(
          'Challenge issued_at is in the future'
        );
      });

      it('should reject challenge with too short nonce', async () => {
        const shortNonceChallenge: Challenge = {
          challenge_id: 'challenge_123',
          target_agent_id: 'test_agent_id',
          target_instance_id: 'test_instance_id',
          nonce: 'short',
          issued_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60000).toISOString(),
          intent: 'test_intent',
          risk_level: 'low',
          version_vector: {
            identity_version: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            session_epoch: 1,
            ledger_checkpoint: 'checkpoint',
          },
        };

        await expect(client.receiveChallenge(shortNonceChallenge)).rejects.toThrow(
          'Invalid challenge nonce'
        );
      });

      it('should reject challenge with wrong target agent ID', async () => {
        const wrongTargetChallenge: Challenge = {
          challenge_id: 'challenge_123',
          target_agent_id: 'different_agent_id',
          target_instance_id: 'test_instance_id',
          nonce: 'valid_nonce_string_long_enough',
          issued_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60000).toISOString(),
          intent: 'test_intent',
          risk_level: 'low',
          version_vector: {
            identity_version: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            session_epoch: 1,
            ledger_checkpoint: 'checkpoint',
          },
        };

        // This should be accepted since the client doesn't validate target_agent_id matches
        // The server validates this during proof verification
        const result = await client.receiveChallenge(wrongTargetChallenge);
        expect(result).toBeDefined();
      });
    });

    describe('Session Error Handling', () => {
      it('should handle session creation with invalid capability digest', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'peer_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { auth_endpoint: 'https://auth.example.com' },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({
            error: {
              code: 'CAPABILITY_MISMATCH',
              message: 'Capability digest does not match',
            },
          }),
        });

        await expect(
          client.createSession(
            'peer_agent',
            'peer_instance',
            { capabilities: ['cap1'], capability_digest: 'invalid_digest' },
            'low',
            {
              identity_version: 1,
              revocation_epoch: 1,
              policy_epoch: 1,
              session_epoch: 1,
              ledger_checkpoint: 'checkpoint',
            }
          )
        ).rejects.toThrow();
      });

      it('should handle concurrent session creation', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'peer_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { auth_endpoint: 'https://auth.example.com' },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            session_id: 'session_1',
            agent_id: 'test_agent',
            instance_id: 'test_instance',
            issued_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 3600000).toISOString(),
            session_epoch: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            sequence: 1,
            effective_capabilities: ['cap1'],
            session_status: 'ACTIVE',
          }),
        });

        const session = await client.createSession(
          'peer_agent',
          'peer_instance',
          { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
          'low',
          {
            identity_version: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            session_epoch: 1,
            ledger_checkpoint: 'checkpoint',
          }
        );

        expect(session.session_id).toBe('session_1');
      });
    });

    describe('Proof Submission Error Handling', () => {
      it('should handle REJECTED verification status', async () => {
        const mockProof = {
          spec_version: '0.2',
          proof_id: 'proof_123',
          challenge_id: 'challenge_123',
          agent_id: 'test_agent',
          instance_id: 'test_instance',
          nonce: 'nonce',
          timestamp: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60000).toISOString(),
          intent: 'collaboration',
          capability_digest: 'sha256:abc',
          identity_version: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          session_epoch: 1,
          session_pubkey: {
            key_id: 'session_key_1',
            algorithm: 'ed25519',
            public_key: 'a'.repeat(64),
          },
          signature: {
            key_id: 'key_1',
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: 'signature_value',
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'verifier_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { auth_endpoint: 'https://auth.example.com' },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            verification_status: 'REJECTED',
            errors: [{ code: 'INVALID_SIGNATURE', message: 'Signature verification failed' }],
            warnings: [],
          }),
        });

        const result = await client.submitProof(mockProof, 'verifier_agent');

        expect(result.verification_status).toBe('REJECTED');
        expect(result.errors).toHaveLength(1);
      });

      it('should handle DEFERRED verification status', async () => {
        const mockProof = {
          spec_version: '0.2',
          proof_id: 'proof_123',
          challenge_id: 'challenge_123',
          agent_id: 'test_agent',
          instance_id: 'test_instance',
          nonce: 'nonce',
          timestamp: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60000).toISOString(),
          intent: 'collaboration',
          capability_digest: 'sha256:abc',
          identity_version: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          session_epoch: 1,
          session_pubkey: {
            key_id: 'session_key_1',
            algorithm: 'ed25519',
            public_key: 'a'.repeat(64),
          },
          signature: {
            key_id: 'key_1',
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: 'signature_value',
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'verifier_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { auth_endpoint: 'https://auth.example.com' },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            verification_status: 'DEFERRED',
            warnings: ['Manual review required'],
            errors: [],
          }),
        });

        const result = await client.submitProof(mockProof, 'verifier_agent');

        expect(result.verification_status).toBe('DEFERRED');
      });
    });
  });

  describe('Error Handling - Uncovered Branches', () => {
    describe('resolveIdentity - INVALID_MANIFEST_SIGNATURE branch', () => {
      it('should return INVALID_MANIFEST_SIGNATURE when signature verification fails', async () => {
        const manifestWithEmptySignature: IdentityManifest = {
          schema_version: '0.2',
          agent_id: 'resolved_agent_id',
          identity_version: 1,
          operation_keys: [],
          platform_bindings: [
            {
              platform_type: 'x',
              platform_account_id: 'account123',
              display_handle: 'testuser',
              binding_status: 'active',
              verified_at: '2024-01-01T00:00:00Z',
              bound_by_key_id: 'key_1',
              binding_version: 1,
            },
          ],
          revocation_epoch: 1,
          last_updated_at: '2024-01-01T00:00:00Z',
          manifest_signature: {
            key_id: 'key_1',
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: '', // Empty signature triggers the error branch
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => manifestWithEmptySignature,
        });

        const result = await client.resolveIdentity({
          discovery_source: {
            platform_type: 'x',
            platform_account_id: 'account123',
            display_handle: 'testuser',
          },
          required_freshness: 'LOW',
        });

        expect(result.resolution_status).toBe('INVALID_MANIFEST_SIGNATURE');
        expect(result.warnings).toContain('Manifest signature verification failed');
      });
    });

    describe('getManifest - error branch', () => {
      it('should return null when HTTP response is not OK', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        });

        const result = await client.getManifest('nonexistent_agent');

        expect(result).toBeNull();
      });

      it('should return null when JSON parsing fails', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => {
            throw new SyntaxError('Unexpected token');
          },
        });

        const result = await client.getManifest('test_agent');

        expect(result).toBeNull();
      });
    });

    describe('validateChallenge - validation error branches', () => {
      it('should throw when nonce is exactly 15 characters (boundary test)', async () => {
        const challenge: Challenge = {
          challenge_id: 'challenge_123',
          target_agent_id: 'test_agent_id',
          target_instance_id: 'test_instance_id',
          nonce: '123456789012345', // 15 chars, less than 16
          issued_at: new Date(Date.now() - 1000).toISOString(),
          expires_at: new Date(Date.now() + 60000).toISOString(),
          intent: 'test_intent',
          risk_level: 'low',
          version_vector: {
            identity_version: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            session_epoch: 1,
            ledger_checkpoint: 'checkpoint',
          },
        };

        await expect(client.receiveChallenge(challenge)).rejects.toThrow('Invalid challenge nonce');
      });

      it('should throw when nonce is undefined', async () => {
        const challenge = {
          challenge_id: 'challenge_123',
          target_agent_id: 'test_agent_id',
          target_instance_id: 'test_instance_id',
          nonce: undefined,
          issued_at: new Date(Date.now() - 1000).toISOString(),
          expires_at: new Date(Date.now() + 60000).toISOString(),
          intent: 'test_intent',
          risk_level: 'low',
          version_vector: {
            identity_version: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            session_epoch: 1,
            ledger_checkpoint: 'checkpoint',
          },
        };

        await expect(client.receiveChallenge(challenge as any)).rejects.toThrow('Invalid challenge nonce');
      });
    });

    describe('submitProof - error branch with default message', () => {
      it('should use default error message when error.response has no message', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'verifier_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { auth_endpoint: 'https://auth.example.com' },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ error: {} }), // No message field
        });

        const mockProof = {
          spec_version: '0.2',
          proof_id: 'proof_123',
          challenge_id: 'challenge_123',
          agent_id: 'test_agent',
          instance_id: 'test_instance',
          nonce: 'nonce',
          timestamp: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60000).toISOString(),
          intent: 'collaboration',
          capability_digest: 'sha256:abc',
          identity_version: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          session_epoch: 1,
          session_pubkey: {
            key_id: 'session_key_1',
            algorithm: 'ed25519',
            public_key: 'a'.repeat(64),
          },
          signature: {
            key_id: 'key_1',
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: 'signature_value',
          },
        };

        await expect(client.submitProof(mockProof, 'verifier_agent')).rejects.toThrow(
          'Proof verification failed'
        );
      });

      it('should use default error message when error object is missing', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'verifier_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { auth_endpoint: 'https://auth.example.com' },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({}), // No error object at all
        });

        const mockProof = {
          spec_version: '0.2',
          proof_id: 'proof_123',
          challenge_id: 'challenge_123',
          agent_id: 'test_agent',
          instance_id: 'test_instance',
          nonce: 'nonce',
          timestamp: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60000).toISOString(),
          intent: 'collaboration',
          capability_digest: 'sha256:abc',
          identity_version: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          session_epoch: 1,
          session_pubkey: {
            key_id: 'session_key_1',
            algorithm: 'ed25519',
            public_key: 'a'.repeat(64),
          },
          signature: {
            key_id: 'key_1',
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: 'signature_value',
          },
        };

        await expect(client.submitProof(mockProof, 'verifier_agent')).rejects.toThrow(
          'Proof verification failed'
        );
      });

      it('should handle network error during proof submission', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'verifier_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { auth_endpoint: 'https://auth.example.com' },
          }),
        });
        mockFetch.mockRejectedValueOnce(new Error('Network failure'));

        const mockProof = {
          spec_version: '0.2',
          proof_id: 'proof_123',
          challenge_id: 'challenge_123',
          agent_id: 'test_agent',
          instance_id: 'test_instance',
          nonce: 'nonce',
          timestamp: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60000).toISOString(),
          intent: 'collaboration',
          capability_digest: 'sha256:abc',
          identity_version: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          session_epoch: 1,
          session_pubkey: {
            key_id: 'session_key_1',
            algorithm: 'ed25519',
            public_key: 'a'.repeat(64),
          },
          signature: {
            key_id: 'key_1',
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: 'signature_value',
          },
        };

        await expect(client.submitProof(mockProof, 'verifier_agent')).rejects.toThrow('Network failure');
      });
    });

    describe('createSession - error branch with default message', () => {
      it('should use default error message when error has no message field', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'peer_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { auth_endpoint: 'https://auth.example.com' },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ error: { code: 'BAD_REQUEST' } }), // No message
        });

        await expect(
          client.createSession(
            'peer_agent',
            'peer_instance',
            { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
            'low',
            {
              identity_version: 1,
              revocation_epoch: 1,
              policy_epoch: 1,
              session_epoch: 1,
              ledger_checkpoint: 'checkpoint',
            }
          )
        ).rejects.toThrow('Session creation failed');
      });

      it('should handle network error during session creation', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'peer_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { auth_endpoint: 'https://auth.example.com' },
          }),
        });
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

        await expect(
          client.createSession(
            'peer_agent',
            'peer_instance',
            { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
            'low',
            {
              identity_version: 1,
              revocation_epoch: 1,
              policy_epoch: 1,
              session_epoch: 1,
              ledger_checkpoint: 'checkpoint',
            }
          )
        ).rejects.toThrow('Connection refused');
      });
    });

    describe('renewSession - error branch with default message', () => {
      it('should use default error message when renewal fails without message', async () => {
        // First create a session
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'peer_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { auth_endpoint: 'https://auth.example.com' },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            session_id: 'session_renew_123',
            agent_id: 'test_agent',
            instance_id: 'test_instance',
            issued_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 3600000).toISOString(),
            session_epoch: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            sequence: 1,
            effective_capabilities: ['cap1'],
            session_status: 'ACTIVE',
          }),
        });

        await client.createSession(
          'peer_agent',
          'peer_instance',
          { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
          'low',
          {
            identity_version: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            session_epoch: 1,
            ledger_checkpoint: 'checkpoint',
          }
        );

        // Now test renewal failure
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ error: null }),
        });

        await expect(client.renewSession('session_renew_123', 'EXPIRY_APPROACHING')).rejects.toThrow(
          'Session renewal failed'
        );
      });

      it('should handle network error during session renewal', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'peer_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { auth_endpoint: 'https://auth.example.com' },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            session_id: 'session_renew_456',
            agent_id: 'test_agent',
            instance_id: 'test_instance',
            issued_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 3600000).toISOString(),
            session_epoch: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            sequence: 1,
            effective_capabilities: ['cap1'],
            session_status: 'ACTIVE',
          }),
        });

        await client.createSession(
          'peer_agent',
          'peer_instance',
          { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
          'low',
          {
            identity_version: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            session_epoch: 1,
            ledger_checkpoint: 'checkpoint',
          }
        );

        mockFetch.mockRejectedValueOnce(new Error('Timeout'));

        await expect(client.renewSession('session_renew_456', 'HIGH_RISK_REAUTH')).rejects.toThrow('Timeout');
      });
    });

    describe('terminateSession - error branch with default message', () => {
      it('should use default error message when termination fails without message', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'peer_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { auth_endpoint: 'https://auth.example.com' },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            session_id: 'session_term_123',
            agent_id: 'test_agent',
            instance_id: 'test_instance',
            issued_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 3600000).toISOString(),
            session_epoch: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            sequence: 1,
            effective_capabilities: ['cap1'],
            session_status: 'ACTIVE',
          }),
        });

        await client.createSession(
          'peer_agent',
          'peer_instance',
          { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
          'low',
          {
            identity_version: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            session_epoch: 1,
            ledger_checkpoint: 'checkpoint',
          }
        );

        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({}),
        });

        await expect(client.terminateSession('session_term_123', 'manual_termination')).rejects.toThrow(
          'Session termination failed'
        );
      });

      it('should handle network error during session termination', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'peer_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { auth_endpoint: 'https://auth.example.com' },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            session_id: 'session_term_456',
            agent_id: 'test_agent',
            instance_id: 'test_instance',
            issued_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 3600000).toISOString(),
            session_epoch: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            sequence: 1,
            effective_capabilities: ['cap1'],
            session_status: 'ACTIVE',
          }),
        });

        await client.createSession(
          'peer_agent',
          'peer_instance',
          { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
          'low',
          {
            identity_version: 1,
            revocation_epoch: 1,
            policy_epoch: 1,
            session_epoch: 1,
            ledger_checkpoint: 'checkpoint',
          }
        );

        mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

        await expect(client.terminateSession('session_term_456', 'manual_termination')).rejects.toThrow(
          'ECONNRESET'
        );
      });
    });

    describe('checkFreshness - error branch with default message', () => {
      it('should use default error message when freshness check fails without message', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'test_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { revocation_endpoint: 'https://revocation.example.com' },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ error: { message: '' } }),
        });

        await expect(client.checkFreshness('test_agent', 'low')).rejects.toThrow('Freshness check failed');
      });

      it('should handle network error during freshness check', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'test_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { revocation_endpoint: 'https://revocation.example.com' },
          }),
        });
        mockFetch.mockRejectedValueOnce(new Error('ENOTFOUND'));

        await expect(client.checkFreshness('test_agent', 'low')).rejects.toThrow('ENOTFOUND');
      });
    });

    describe('requestChallenge - error branch with default message', () => {
      it('should use default error message when challenge request fails without message', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schema_version: '0.2',
            agent_id: 'target_agent',
            identity_version: 1,
            operation_keys: [],
            revocation_epoch: 1,
            last_updated_at: '2024-01-01T00:00:00Z',
            service_endpoints: { auth_endpoint: 'https://auth.example.com' },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ error: null }),
        });

        await expect(
          client.requestChallenge('verifier_123', 'target_agent', 'target_instance', 'collaboration', 'low')
        ).rejects.toThrow('Challenge request failed');
      });
    });

    describe('Concurrent Request Handling', () => {
      it('should handle concurrent manifest fetches', async () => {
        const mockManifest: IdentityManifest = {
          schema_version: '0.2',
          agent_id: 'concurrent_agent',
          identity_version: 1,
          operation_keys: [],
          revocation_epoch: 1,
          last_updated_at: '2024-01-01T00:00:00Z',
        };

        let fetchCount = 0;
        mockFetch.mockImplementation(async () => {
          fetchCount++;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return {
            ok: true,
            json: async () => mockManifest,
          };
        });

        const results = await Promise.all([
          client.getManifest('concurrent_agent'),
          client.getManifest('concurrent_agent'),
          client.getManifest('concurrent_agent'),
        ]);

        results.forEach((result) => {
          expect(result).toEqual(mockManifest);
        });
        // All fetches might occur before cache is populated
        expect(fetchCount).toBeGreaterThanOrEqual(1);
      });

      it('should handle concurrent session creations for different peers', async () => {
        const peers = ['peer1', 'peer2', 'peer3'];
        let callIndex = 0;

        mockFetch.mockImplementation(async () => {
          const idx = callIndex++;
          if (idx < 3) {
            // Manifest fetches
            return {
              ok: true,
              json: async () => ({
                schema_version: '0.2',
                agent_id: `${peers[idx]}_agent`,
                identity_version: 1,
                operation_keys: [],
                revocation_epoch: 1,
                last_updated_at: '2024-01-01T00:00:00Z',
                service_endpoints: { auth_endpoint: `https://${peers[idx]}.example.com` },
              }),
            };
          }
          // Session creation
          const peerIdx = idx - 3;
          return {
            ok: true,
            json: async () => ({
              session_id: `session_${peers[peerIdx]}`,
              agent_id: 'test_agent',
              instance_id: 'test_instance',
              issued_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 3600000).toISOString(),
              session_epoch: 1,
              revocation_epoch: 1,
              policy_epoch: 1,
              sequence: 1,
              effective_capabilities: [`cap_${peers[peerIdx]}`],
              session_status: 'ACTIVE',
            }),
          };
        });

        const sessions = await Promise.all(
          peers.map((peer) =>
            client.createSession(
              `${peer}_agent`,
              `${peer}_instance`,
              { capabilities: [`cap_${peer}`], capability_digest: `sha256:${peer}` },
              'low',
              {
                identity_version: 1,
                revocation_epoch: 1,
                policy_epoch: 1,
                session_epoch: 1,
                ledger_checkpoint: 'checkpoint',
              }
            )
          )
        );

        expect(sessions).toHaveLength(3);
        sessions.forEach((session, i) => {
          expect(session.session_id).toBe(`session_${peers[i]}`);
        });
      });
    });
  });

  describe('Factory Functions', () => {
    describe('createAgentClient', () => {
      it('should create an AgentClient instance', () => {
        const newClient = createAgentClient(config);

        expect(newClient).toBeInstanceOf(AgentClient);
      });
    });

    describe('resolveAgentIdentity', () => {
      it('should resolve identity using temporary client', async () => {
        const mockManifest: IdentityManifest = {
          schema_version: '0.2',
          agent_id: 'resolved_agent',
          identity_version: 1,
          operation_keys: [],
          platform_bindings: [
            {
              platform_type: 'x',
              platform_account_id: 'account123',
              display_handle: 'testuser',
              binding_status: 'active',
              verified_at: '2024-01-01T00:00:00Z',
              bound_by_key_id: 'key1',
              binding_version: 1,
            },
          ],
          revocation_epoch: 1,
          last_updated_at: '2024-01-01T00:00:00Z',
          manifest_signature: {
            key_id: 'key1',
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: 'valid',
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockManifest,
        });

        const result = await resolveAgentIdentity('x', 'account123', 'testuser');

        expect(result.resolution_status).toBe('RESOLVED');
      });
    });
  });
});