/**
 * Exchange Server Tests
 * Tests for message exchange server functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ExchangeServer,
  createExchangeServer,
  type ExchangeEnvelope,
  type HelloBody,
  type ProfileRequestBody,
  type ProfileResponseBody,
  type CapabilityRequestBody,
  type CapabilityResponseBody,
  type CollabInviteBody,
  type CollabAcceptBody,
  type CollabRejectBody,
  type CollabDeferBody,
  type StatusNotifyBody,
  type SessionRenewBody,
  type SessionTerminateBody,
  type WarningCompromisedBody,
  type PolicyUpdateBody,
} from '../exchange';
import type { SessionManager, Session } from '../session-manager';
import type { Verifier } from '../verifier';
import type { IdentityHost, IdentityManifest } from '../identity-host';
import { verifyObject } from '../crypto.js';

// Mock the crypto module
vi.mock('../crypto.js', () => ({
  verifyObject: vi.fn(),
}));

// Get the mocked function with proper typing
const mockVerifyObject = vi.mocked(verifyObject);

// ============================================================================
// Mock Factories
// ============================================================================

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

function createMockVerifier(): Verifier {
  return {
    issueChallenge: vi.fn(),
    verifyProof: vi.fn(),
    isNonceUsed: vi.fn(),
    markNonceUsed: vi.fn(),
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

// ============================================================================
// Test Fixtures
// ============================================================================

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
  capabilities: {
    capabilities: ['profile.read', 'profile.write'],
    capability_digest: 'sha256:digest_hex',
  },
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

function createMessage(
  messageType: ExchangeEnvelope['message_type'],
  body: unknown,
  overrides?: Partial<ExchangeEnvelope>
): ExchangeEnvelope {
  return {
    protocol_version: '0.2',
    message_id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    message_type: messageType,
    timestamp: new Date().toISOString(),
    agent_id: 'agt_B001',
    instance_id: 'ins_B001_001',
    session_id: 'ses_test_001',
    sequence: 0,
    body,
    ...overrides,
  };
}

// ============================================================================
// Exchange Server Tests
// ============================================================================

describe('ExchangeServer', () => {
  let server: ExchangeServer;
  let mockSessionManager: SessionManager;
  let mockVerifier: Verifier;
  let mockIdentityHost: IdentityHost;

  beforeEach(() => {
    mockSessionManager = createMockSessionManager();
    mockVerifier = createMockVerifier();
    mockIdentityHost = createMockIdentityHost();

    server = new ExchangeServer(
      {
        protocolVersion: '0.2',
        messageTimeout: 30000,
        maxSequenceSkew: 10,
        clockSkewTolerance: 120000,
      },
      {
        identityHost: mockIdentityHost,
        sessionManager: mockSessionManager,
        verifier: mockVerifier,
      }
    );

    // Default session mock
    vi.mocked(mockSessionManager.getSession).mockResolvedValue(mockSession);
    vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(mockManifest);
  });

  describe('Constructor', () => {
    it('should create an ExchangeServer instance', () => {
      expect(server).toBeInstanceOf(ExchangeServer);
    });

    it('should use default config values', () => {
      const defaultServer = new ExchangeServer(
        {},
        {
          identityHost: mockIdentityHost,
          sessionManager: mockSessionManager,
          verifier: mockVerifier,
        }
      );

      expect(defaultServer).toBeInstanceOf(ExchangeServer);
    });
  });

  describe('Message Validation', () => {
    it('should reject message without message_id', async () => {
      const message = createMessage('hello', {});
      delete (message as any).message_id;

      await expect(server.handleMessage(message)).rejects.toThrow('Missing or invalid message_id');
    });

    it('should reject message without message_type', async () => {
      const message = createMessage('hello', {});
      delete (message as any).message_type;

      await expect(server.handleMessage(message)).rejects.toThrow('Missing or invalid message_type');
    });

    it('should reject message without timestamp', async () => {
      const message = createMessage('hello', {});
      delete (message as any).timestamp;

      await expect(server.handleMessage(message)).rejects.toThrow('Missing or invalid timestamp');
    });

    it('should reject message with invalid protocol version', async () => {
      const message = createMessage('hello', {}, { protocol_version: '0.1' });

      await expect(server.handleMessage(message)).rejects.toThrow('Unsupported protocol version');
    });

    it('should reject message with timestamp too old', async () => {
      const message = createMessage('hello', {}, {
        timestamp: new Date(Date.now() - 200000).toISOString(),
      });

      await expect(server.handleMessage(message)).rejects.toThrow('Timestamp skew too large');
    });

    it('should reject message with non-existent session', async () => {
      vi.mocked(mockSessionManager.getSession).mockResolvedValue(null);

      const message = createMessage('hello', {});

      await expect(server.handleMessage(message)).rejects.toThrow('Session not found');
    });

    it('should reject message with session ownership mismatch', async () => {
      const message = createMessage('hello', {}, { agent_id: 'different_agent' });

      await expect(server.handleMessage(message)).rejects.toThrow('Session ownership mismatch');
    });
  });

  describe('Hello Message', () => {
    it('should handle hello message', async () => {
      const body: HelloBody = {
        display_name: 'Test Agent',
        capability_summary: {
          capabilities: ['profile.read'],
          capability_digest: 'sha256:abc',
        },
        identity_version: 1,
        revocation_epoch: 1,
      };

      const message = createMessage('hello', body);
      const result = await server.handleMessage(message);

      // Hello does not require a response
      expect(result).toBeUndefined();
    });
  });

  describe('Profile Messages', () => {
    describe('profile.request', () => {
      it('should handle profile request and return response', async () => {
        const body: ProfileRequestBody = {
          requested_fields: ['display_name', 'platform_bindings'],
        };

        const message = createMessage('profile.request', body);
        const result = await server.handleMessage(message);

        expect(result).toBeDefined();
        expect(result?.message_type).toBe('profile.response');

        const responseBody = result?.body as ProfileResponseBody;
        expect(responseBody.profile).toBeDefined();
      });

      it('should return 404 for non-existent agent manifest', async () => {
        vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(null);

        const body: ProfileRequestBody = { requested_fields: ['display_name'] };
        const message = createMessage('profile.request', body);

        await expect(server.handleMessage(message)).rejects.toThrow('Agent manifest not found');
      });
    });

    describe('profile.response', () => {
      it('should handle profile response', async () => {
        const body: ProfileResponseBody = {
          profile: {
            display_name: 'Test Agent',
            summary: 'A test agent',
          },
        };

        const message = createMessage('profile.response', body);
        const result = await server.handleMessage(message);

        expect(result).toBeUndefined();
      });
    });
  });

  describe('Capability Messages', () => {
    describe('capability.request', () => {
      it('should handle capability request and return response', async () => {
        const body: CapabilityRequestBody = {
          requested_capabilities: ['profile.read', 'profile.write', 'admin.access'],
        };

        const message = createMessage('capability.request', body);
        const result = await server.handleMessage(message);

        expect(result).toBeDefined();
        expect(result?.message_type).toBe('capability.response');

        const responseBody = result?.body as CapabilityResponseBody;
        expect(responseBody.granted_capabilities).toContain('profile.read');
        expect(responseBody.granted_capabilities).toContain('profile.write');
        expect(responseBody.denied_capabilities).toContain('admin.access');
      });

      it('should handle capability request with no session capabilities', async () => {
        vi.mocked(mockSessionManager.getSession).mockResolvedValue({
          ...mockSession,
          capabilities: undefined,
        });

        const body: CapabilityRequestBody = {
          requested_capabilities: ['profile.read'],
        };

        const message = createMessage('capability.request', body);
        const result = await server.handleMessage(message);

        const responseBody = result?.body as CapabilityResponseBody;
        expect(responseBody.denied_capabilities).toContain('profile.read');
      });
    });

    describe('capability.response', () => {
      it('should handle capability response', async () => {
        const body: CapabilityResponseBody = {
          granted_capabilities: ['profile.read'],
          denied_capabilities: ['admin.access'],
          effective_capability_digest: 'sha256:abc',
        };

        const message = createMessage('capability.response', body);
        const result = await server.handleMessage(message);

        expect(result).toBeUndefined();
      });
    });
  });

  describe('Collab Messages', () => {
    describe('collab.invite', () => {
      it('should handle collab invite', async () => {
        const body: CollabInviteBody = {
          invite_id: 'invite_001',
          title: 'Test Collaboration',
          summary: 'A test collaboration',
          risk_level: 'low',
        };

        const message = createMessage('collab.invite', body);
        const result = await server.handleMessage(message);

        expect(result).toBeUndefined();
      });
    });

    describe('collab.accept', () => {
      it('should handle collab accept', async () => {
        const body: CollabAcceptBody = {
          invite_id: 'invite_001',
          accepted_at: new Date().toISOString(),
          conditions: ['condition1'],
        };

        const message = createMessage('collab.accept', body);
        const result = await server.handleMessage(message);

        expect(result).toBeUndefined();
      });
    });

    describe('collab.reject', () => {
      it('should handle collab reject', async () => {
        const body: CollabRejectBody = {
          invite_id: 'invite_001',
          rejected_at: new Date().toISOString(),
          reason_code: 'NOT_INTERESTED',
        };

        const message = createMessage('collab.reject', body);
        const result = await server.handleMessage(message);

        expect(result).toBeUndefined();
      });
    });

    describe('collab.defer', () => {
      it('should handle collab defer', async () => {
        const body: CollabDeferBody = {
          invite_id: 'invite_001',
          deferred_until: new Date(Date.now() + 86400000).toISOString(),
          reason_code: 'SCHEDULE_CONFLICT',
        };

        const message = createMessage('collab.defer', body);
        const result = await server.handleMessage(message);

        expect(result).toBeUndefined();
      });
    });
  });

  describe('Status Messages', () => {
    it('should handle status notify', async () => {
      const body: StatusNotifyBody = {
        status_type: 'ACTIVE',
        detail: 'Agent is active',
        effective_capabilities: ['profile.read'],
      };

      const message = createMessage('status.notify', body);
      const result = await server.handleMessage(message);

      expect(result).toBeUndefined();
    });

    it('should handle all status types', async () => {
      const statuses = ['ACTIVE', 'DEGRADED', 'QUARANTINED', 'RECOVERING', 'TERMINATING'] as const;

      for (const status of statuses) {
        const body: StatusNotifyBody = { status_type: status };
        const message = createMessage('status.notify', body);
        const result = await server.handleMessage(message);

        expect(result).toBeUndefined();
      }
    });
  });

  describe('Session Messages', () => {
    describe('session.renew', () => {
      it('should handle session renew', async () => {
        vi.mocked(mockSessionManager.renewSession).mockResolvedValue({
          ...mockSession,
          session_epoch: 12,
        });

        const body: SessionRenewBody = {
          current_session_id: 'ses_test_001',
          next_session_id: 'ses_test_002',
          reason_code: 'EXPIRY_APPROACHING',
          new_session_epoch: 12,
          effective_at: new Date(Date.now() + 3600000).toISOString(),
        };

        const message = createMessage('session.renew', body);
        const result = await server.handleMessage(message);

        expect(result).toBeUndefined();
        expect(mockSessionManager.renewSession).toHaveBeenCalledWith('ses_test_001');
      });
    });

    describe('session.terminate', () => {
      it('should handle session terminate', async () => {
        vi.mocked(mockSessionManager.terminateSession).mockResolvedValue();

        const body: SessionTerminateBody = {
          session_id: 'ses_test_001',
          reason_code: 'MANUAL_TERMINATION',
          reason_detail: 'User requested',
          terminated_at: new Date().toISOString(),
        };

        const message = createMessage('session.terminate', body);
        const result = await server.handleMessage(message);

        expect(result).toBeUndefined();
        expect(mockSessionManager.terminateSession).toHaveBeenCalled();
      });
    });
  });

  describe('Warning Messages', () => {
    it('should handle warning compromised', async () => {
      const body: WarningCompromisedBody = {
        warning_type: 'SESSION_KEY_COMPROMISED',
        reported_at: new Date().toISOString(),
        recommended_action: 'TERMINATE_AND_REVERIFY',
      };

      const message = createMessage('warning.compromised', body);
      const result = await server.handleMessage(message);

      expect(result).toBeUndefined();
    });

    it('should handle all warning types', async () => {
      const warnings = [
        'OPERATION_KEY_COMPROMISED',
        'SESSION_KEY_COMPROMISED',
        'BINDING_COMPROMISED',
        'POLICY_VIOLATION',
      ] as const;

      for (const warning of warnings) {
        const body: WarningCompromisedBody = {
          warning_type: warning,
          reported_at: new Date().toISOString(),
          recommended_action: 'QUARANTINE',
        };

        const message = createMessage('warning.compromised', body);
        const result = await server.handleMessage(message);

        expect(result).toBeUndefined();
      }
    });
  });

  describe('Policy Messages', () => {
    it('should handle policy update', async () => {
      const body: PolicyUpdateBody = {
        policy_epoch: 3,
        previous_policy_epoch: 2,
        effective_at: new Date(Date.now() + 86400000).toISOString(),
        reauth_required: true,
      };

      const message = createMessage('policy.update', body);
      const result = await server.handleMessage(message);

      expect(result).toBeUndefined();
    });
  });

  describe('Event Handling', () => {
    it('should register and call event handler', async () => {
      const eventHandler = vi.fn();
      server.addEventHandler(eventHandler);

      const body: HelloBody = {
        capability_summary: { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
        identity_version: 1,
        revocation_epoch: 1,
      };

      const message = createMessage('hello', body);
      await server.handleMessage(message);

      expect(eventHandler).toHaveBeenCalled();
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message_received',
        })
      );
    });

    it('should remove event handler', async () => {
      const eventHandler = vi.fn();
      server.addEventHandler(eventHandler);
      server.removeEventHandler(eventHandler);

      const body: HelloBody = {
        capability_summary: { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
        identity_version: 1,
        revocation_epoch: 1,
      };

      const message = createMessage('hello', body);
      await server.handleMessage(message);

      expect(eventHandler).not.toHaveBeenCalled();
    });
  });

  describe('Custom Message Handlers', () => {
    it('should register custom message handler', async () => {
      const customHandler = vi.fn().mockResolvedValue(undefined);
      server.onMessage('hello', customHandler);

      const body: HelloBody = {
        capability_summary: { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
        identity_version: 1,
        revocation_epoch: 1,
      };

      const message = createMessage('hello', body);
      await server.handleMessage(message);

      expect(customHandler).toHaveBeenCalled();
    });

    it('should remove custom message handler', async () => {
      const customHandler = vi.fn().mockResolvedValue(undefined);
      server.onMessage('hello', customHandler);
      server.offMessage('hello', customHandler);

      const body: HelloBody = {
        capability_summary: { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
        identity_version: 1,
        revocation_epoch: 1,
      };

      const message = createMessage('hello', body);
      await server.handleMessage(message);

      // Default handler should still be called, but custom one shouldn't
      expect(customHandler).not.toHaveBeenCalled();
    });

    it('should allow custom handler to return response', async () => {
      const customResponse: ExchangeEnvelope = {
        protocol_version: '0.2',
        message_id: 'custom_msg',
        message_type: 'hello',
        timestamp: new Date().toISOString(),
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        session_id: 'ses_test_001',
        sequence: 1,
        body: { custom: true },
      };

      const customHandler = vi.fn().mockResolvedValue(customResponse);
      server.onMessage('hello', customHandler);

      const body: HelloBody = {
        capability_summary: { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
        identity_version: 1,
        revocation_epoch: 1,
      };

      const message = createMessage('hello', body);
      const result = await server.handleMessage(message);

      expect(result).toEqual(customResponse);
    });
  });

  describe('Signature Verification', () => {
    it('should fail closed when active key has no public_key', async () => {
      // Manifest with active key but no public_key property
      const manifestWithoutPublicKey: IdentityManifest = {
        ...mockManifest,
        keys: [
          {
            key_id: 'key_no_pk',
            scope: 'operation',
            algorithm: 'ed25519',
            public_key: '',  // Empty string is falsy
            status: 'active',
            valid_from: '2026-01-01T00:00:00Z',
          },
        ],
      };

      vi.mocked(mockIdentityHost.getManifest).mockResolvedValue(manifestWithoutPublicKey);

      const body: HelloBody = {
        capability_summary: { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
        identity_version: 1,
        revocation_epoch: 1,
      };

      const message = createMessage('hello', body, { signature_or_mac: 'signature_hex' });
      await expect(server.handleMessage(message)).rejects.toThrow('Signature verification failed');
    });

    it('should throw when signature verification fails', async () => {
      mockVerifyObject.mockResolvedValue(false);

      const body: HelloBody = {
        capability_summary: { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
        identity_version: 1,
        revocation_epoch: 1,
      };

      const message = createMessage('hello', body, { signature_or_mac: 'invalid_signature' });

      await expect(server.handleMessage(message)).rejects.toThrow('Signature verification failed');
    });

    it('should fail closed when other error occurs during signature verification', async () => {
      mockVerifyObject.mockRejectedValue(new Error('Network error'));

      const body: HelloBody = {
        capability_summary: { capabilities: ['cap1'], capability_digest: 'sha256:abc' },
        identity_version: 1,
        revocation_epoch: 1,
      };

      const message = createMessage('hello', body, { signature_or_mac: 'signature_hex' });
      await expect(server.handleMessage(message)).rejects.toThrow('Signature verification failed');
    });
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('createExchangeServer', () => {
  it('should create an ExchangeServer instance', () => {
    const mockSessionManager = createMockSessionManager();
    const mockVerifier = createMockVerifier();
    const mockIdentityHost = createMockIdentityHost();

    const server = createExchangeServer(
      { protocolVersion: '0.2' },
      {
        identityHost: mockIdentityHost,
        sessionManager: mockSessionManager,
        verifier: mockVerifier,
      }
    );

    expect(server).toBeInstanceOf(ExchangeServer);
  });
});
