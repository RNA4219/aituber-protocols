/**
 * Exchange Flow Integration Tests
 *
 * Tests the complete message exchange flow using actual module interactions:
 * 1. Client-Server Message Exchange
 * 2. Encryption and Signature Verification
 * 3. Profile/Capability Negotiation
 * 4. Collaboration Flow
 * 5. Session Management Messages
 * 6. Error Recovery
 *
 * Uses real modules with minimal mocking to validate actual inter-module communication.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExchangeServer, createExchangeServer } from '../../../../server/src/exchange.js';
import { ExchangeClient, createExchangeClient } from '../../exchange-client.js';
import { SessionManagerImpl, type SessionManagerConfig } from '../../../../server/src/session-manager.js';
import { IdentityHostImpl, type IdentityManifest } from '../../../../server/src/identity-host.js';
import { VerifierImpl, DEFAULT_VERIFIER_CONFIG } from '../../../../server/src/verifier.js';
import { generateKeyPair, signObject, verifyObject } from '../../crypto.js';
import type { IdString, NonNegativeInteger, Timestamp, CapabilitySummary } from '../../types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/** Test Agent Configuration */
interface TestAgentConfig {
  agentId: string;
  instanceId: string;
  keyId: string;
  privateKey: string;
  publicKey: string;
}

/** Creates a test agent with real Ed25519 key pair */
async function createTestAgent(id: string): Promise<TestAgentConfig> {
  const keyPair = await generateKeyPair();
  return {
    agentId: `agt_${id}`,
    instanceId: `ins_${id}_001`,
    keyId: `key_${id}_001`,
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
  };
}

/** Creates a test Identity Manifest */
function createTestManifest(agent: TestAgentConfig): IdentityManifest {
  return {
    spec_version: '0.2',
    manifest_version: 1,
    controller_id: `controller_${agent.agentId}`,
    agent_id: agent.agentId,
    identity_version: 1,
    updated_at: new Date().toISOString(),
    ledger_ref: 'https://ledger.example.com/agent/1',
    revocation_ref: 'https://revocation.example.com/agent/1',
    keys: [{
      key_id: agent.keyId,
      scope: 'operation',
      algorithm: 'ed25519',
      public_key: agent.publicKey,
      status: 'active',
      valid_from: new Date().toISOString(),
    }],
    platform_bindings: [{
      platform_type: 'youtube',
      platform_account_id: `channel_${agent.agentId}`,
      display_handle: `@${agent.agentId}`,
      binding_status: 'active',
      verified_at: new Date().toISOString(),
      bound_by_key_id: agent.keyId,
      binding_version: 1,
    }],
    service_endpoints: [{
      name: 'exchange',
      url: 'https://exchange.example.com',
      kind: 'exchange',
    }],
    capability_summary: {
      capabilities: ['profile.read', 'chat.basic', 'collab.invite'],
      capability_digest: 'sha256:test_digest',
    },
    policy_ref: 'https://policy.example.com/1',
    signatures: [],
  };
}

/** Creates a test session for exchange */
interface TestSession {
  sessionId: IdString;
  agentId: IdString;
  instanceId: IdString;
  sequence: NonNegativeInteger;
  capabilities?: CapabilitySummary;
}

/** In-memory transport for testing without network */
class InMemoryTransport {
  private server: ExchangeServer | null = null;
  private messages: Array<{ from: string; to: string; message: unknown }> = [];

  setServer(server: ExchangeServer): void {
    this.server = server;
  }

  async sendToServer(message: unknown): Promise<unknown> {
    if (!this.server) {
      throw new Error('Server not connected');
    }
    this.messages.push({ from: 'client', to: 'server', message });
    return this.server.handleMessage(message);
  }

  getMessages(): Array<{ from: string; to: string; message: unknown }> {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Exchange Flow Integration Tests', () => {
  let server: ExchangeServer;
  let client: ExchangeClient;
  let sessionManager: SessionManagerImpl;
  let identityHost: IdentityHostImpl;
  let verifier: VerifierImpl;
  let transport: InMemoryTransport;

  let serverAgent: TestAgentConfig;
  let clientAgent: TestAgentConfig;
  let testSession: TestSession;

  const sessionConfig: SessionManagerConfig = {
    sessionTtl: 300,
    maxSessions: 100,
  };

  beforeEach(async () => {
    // Create test agents
    serverAgent = await createTestAgent('server');
    clientAgent = await createTestAgent('client');

    // Initialize server components
    sessionManager = new SessionManagerImpl(sessionConfig);
    identityHost = new IdentityHostImpl({
      storageRoot: '/tmp/test-identity',
      cacheTtl: 300,
      skipSignatureValidation: true,
    });
    verifier = new VerifierImpl(DEFAULT_VERIFIER_CONFIG);

    // Store manifests
    const serverManifest = createTestManifest(serverAgent);
    const clientManifest = createTestManifest(clientAgent);
    await identityHost.saveManifest(serverManifest);
    await identityHost.saveManifest(clientManifest);

    // Create exchange server
    server = createExchangeServer(
      { protocolVersion: '0.2' },
      {
        identityHost,
        sessionManager,
        verifier,
      }
    );

    // Create server session for client with proper CapabilitySummary format
    const session = await sessionManager.createSession({
      agent_id: clientAgent.agentId,
      instance_id: clientAgent.instanceId,
      risk_level: 'low',
      capabilities: {
        capabilities: ['profile.read', 'chat.basic', 'collab.invite'],
        capability_digest: 'sha256:test_digest',
      },
      identity_version: 1,
      revocation_epoch: 1,
      policy_epoch: 1,
      ledger_checkpoint: 'chk_1',
    });

    testSession = {
      sessionId: session.session_id,
      agentId: clientAgent.agentId,
      instanceId: clientAgent.instanceId,
      sequence: 0,
      capabilities: session.capabilities,
    };

    // Create exchange client
    client = createExchangeClient({
      agentId: clientAgent.agentId,
      instanceId: clientAgent.instanceId,
      sessionId: testSession.sessionId,
      exchangeEndpoint: 'https://test.example.com/exchange',
    });

    // Setup in-memory transport
    transport = new InMemoryTransport();
    transport.setServer(server);
  });

  afterEach(() => {
    transport.clear();
  });

  // ==========================================================================
  // Hello Message Flow
  // ==========================================================================

  describe('Hello Message Flow', () => {
    it('should send and receive hello message', async () => {
      const events: Array<{ type: string; data: unknown }> = [];
      server.addEventHandler((event) => {
        events.push({ type: event.type, data: event.data });
      });

      // Create hello message
      const helloBody = {
        display_name: 'Test Agent',
        capability_summary: {
          capabilities: ['profile.read', 'chat.basic'],
          capability_digest: 'sha256:abc123',
        },
        identity_version: 1,
        revocation_epoch: 1,
      };

      const message = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'hello' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: helloBody,
      };

      // Server processes hello
      const result = await server.handleMessage(message);

      // Hello doesn't expect a response
      expect(result).toBeUndefined();

      // Check event was emitted
      const helloEvent = events.find(e => e.type === 'session_event');
      expect(helloEvent).toBeDefined();
    });
  });

  // ==========================================================================
  // Profile Exchange Flow
  // ==========================================================================

  describe('Profile Exchange Flow', () => {
    it('should handle profile request-response cycle', async () => {
      // Client sends profile request
      const profileRequest = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'profile.request' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {
          requested_fields: ['display_name', 'platform_bindings'],
        },
      };

      // Server processes request
      const response = await server.handleMessage(profileRequest);

      expect(response).toBeDefined();
      expect(response?.message_type).toBe('profile.response');

      const responseBody = response?.body as { profile: { display_name?: string } };
      expect(responseBody.profile).toBeDefined();
    });

    it('should validate profile request format', async () => {
      const invalidRequest = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'profile.request' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {}, // Empty body
      };

      const response = await server.handleMessage(invalidRequest);
      expect(response).toBeDefined();
      expect(response?.message_type).toBe('profile.response');
    });
  });

  // ==========================================================================
  // Capability Negotiation Flow
  // ==========================================================================

  describe('Capability Negotiation Flow', () => {
    it('should handle capability request-response cycle', async () => {
      const capabilityRequest = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'capability.request' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {
          requested_capabilities: ['profile.read', 'chat.basic', 'admin.write'],
        },
      };

      const response = await server.handleMessage(capabilityRequest);

      expect(response).toBeDefined();
      expect(response?.message_type).toBe('capability.response');

      const responseBody = response?.body as {
        granted_capabilities: string[];
        denied_capabilities: string[];
      };

      // profile.read and chat.basic should be granted (in session capabilities)
      expect(responseBody.granted_capabilities).toContain('profile.read');
      expect(responseBody.granted_capabilities).toContain('chat.basic');

      // admin.write should be denied (not in session capabilities)
      expect(responseBody.denied_capabilities).toContain('admin.write');
    });

    it('should deny capabilities not in session', async () => {
      const capabilityRequest = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'capability.request' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {
          requested_capabilities: ['admin.delete', 'system.shutdown'],
        },
      };

      const response = await server.handleMessage(capabilityRequest);
      const responseBody = response?.body as {
        granted_capabilities: string[];
        denied_capabilities: string[];
      };

      expect(responseBody.granted_capabilities).toHaveLength(0);
      expect(responseBody.denied_capabilities).toHaveLength(2);
    });
  });

  // ==========================================================================
  // Collaboration Flow
  // ==========================================================================

  describe('Collaboration Flow', () => {
    it('should handle collab invite message', async () => {
      const events: Array<{ type: string; data: unknown }> = [];
      server.addEventHandler((event) => {
        events.push({ type: event.type, data: event.data });
      });

      const inviteId = `invite_${Date.now()}`;
      const collabInvite = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'collab.invite' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {
          invite_id: inviteId,
          title: 'Test Collaboration',
          summary: 'A test collaboration invitation',
          risk_level: 'low' as const,
          requires_fresh_reverification: false,
        },
      };

      await server.handleMessage(collabInvite);

      const inviteEvent = events.find(e =>
        e.type === 'session_event' &&
        (e.data as { event?: string })?.event === 'collab_invite_received'
      );
      expect(inviteEvent).toBeDefined();
    });

    it('should handle collab accept message', async () => {
      const events: Array<{ type: string; data: unknown }> = [];
      server.addEventHandler((event) => {
        events.push({ type: event.type, data: event.data });
      });

      const inviteId = `invite_${Date.now()}`;
      const collabAccept = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'collab.accept' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {
          invite_id: inviteId,
          accepted_at: new Date().toISOString(),
          conditions: ['condition_1'],
        },
      };

      await server.handleMessage(collabAccept);

      const acceptEvent = events.find(e =>
        e.type === 'session_event' &&
        (e.data as { event?: string })?.event === 'collab_accepted'
      );
      expect(acceptEvent).toBeDefined();
    });

    it('should handle collab reject message', async () => {
      const events: Array<{ type: string; data: unknown }> = [];
      server.addEventHandler((event) => {
        events.push({ type: event.type, data: event.data });
      });

      const inviteId = `invite_${Date.now()}`;
      const collabReject = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'collab.reject' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {
          invite_id: inviteId,
          rejected_at: new Date().toISOString(),
          reason_code: 'BUSY' as const,
        },
      };

      await server.handleMessage(collabReject);

      const rejectEvent = events.find(e =>
        e.type === 'session_event' &&
        (e.data as { event?: string })?.event === 'collab_rejected'
      );
      expect(rejectEvent).toBeDefined();
    });

    it('should handle collab defer message', async () => {
      const events: Array<{ type: string; data: unknown }> = [];
      server.addEventHandler((event) => {
        events.push({ type: event.type, data: event.data });
      });

      const inviteId = `invite_${Date.now()}`;
      const deferredUntil = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

      const collabDefer = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'collab.defer' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {
          invite_id: inviteId,
          deferred_until: deferredUntil,
          reason_code: 'SCHEDULE_CONFLICT' as const,
        },
      };

      await server.handleMessage(collabDefer);

      const deferEvent = events.find(e =>
        e.type === 'session_event' &&
        (e.data as { event?: string })?.event === 'collab_deferred'
      );
      expect(deferEvent).toBeDefined();
    });
  });

  // ==========================================================================
  // Status Notification Flow
  // ==========================================================================

  describe('Status Notification Flow', () => {
    it('should handle status notify message', async () => {
      const events: Array<{ type: string; data: unknown }> = [];
      server.addEventHandler((event) => {
        events.push({ type: event.type, data: event.data });
      });

      const statusNotify = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'status.notify' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {
          status_type: 'ACTIVE' as const,
          detail: 'Agent is fully operational',
          effective_capabilities: ['profile.read', 'chat.basic'],
        },
      };

      await server.handleMessage(statusNotify);

      const statusEvent = events.find(e =>
        e.type === 'session_event' &&
        (e.data as { event?: string })?.event === 'status_update'
      );
      expect(statusEvent).toBeDefined();
    });

    it('should handle degraded status notification', async () => {
      const events: Array<{ type: string; data: unknown }> = [];
      server.addEventHandler((event) => {
        events.push({ type: event.type, data: event.data });
      });

      const statusNotify = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'status.notify' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {
          status_type: 'DEGRADED' as const,
          detail: 'Running in safe mode',
        },
      };

      await server.handleMessage(statusNotify);

      const statusEvent = events.find(e =>
        e.type === 'session_event' &&
        (e.data as { event?: string })?.event === 'status_update'
      );
      expect(statusEvent).toBeDefined();
      expect((statusEvent?.data as { status_type?: string })?.status_type).toBe('DEGRADED');
    });
  });

  // ==========================================================================
  // Session Management Messages
  // ==========================================================================

  describe('Session Management Messages', () => {
    it('should handle session renew message', async () => {
      const events: Array<{ type: string; data: unknown }> = [];
      server.addEventHandler((event) => {
        events.push({ type: event.type, data: event.data });
      });

      // Create a new session ID for the renewal
      const newSessionId = `ses_${Date.now()}_new`;

      const sessionRenew = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'session.renew' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {
          current_session_id: testSession.sessionId,
          next_session_id: newSessionId,
          reason_code: 'EXPIRY_APPROACHING',
          new_session_epoch: 2 as NonNegativeInteger,
          effective_at: new Date().toISOString(),
        },
      };

      await server.handleMessage(sessionRenew);

      const renewEvent = events.find(e =>
        e.type === 'session_event' &&
        (e.data as { event?: string })?.event === 'session_renewed'
      );
      expect(renewEvent).toBeDefined();
    });

    it('should handle session terminate message', async () => {
      const events: Array<{ type: string; data: unknown }> = [];
      server.addEventHandler((event) => {
        events.push({ type: event.type, data: event.data });
      });

      const sessionTerminate = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'session.terminate' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {
          session_id: testSession.sessionId,
          reason_code: 'MANUAL_TERMINATION',
          reason_detail: 'User requested termination',
          terminated_at: new Date().toISOString(),
        },
      };

      await server.handleMessage(sessionTerminate);

      const terminateEvent = events.find(e =>
        e.type === 'session_event' &&
        (e.data as { event?: string })?.event === 'session_terminated'
      );
      expect(terminateEvent).toBeDefined();
    });
  });

  // ==========================================================================
  // Warning and Policy Messages
  // ==========================================================================

  describe('Warning and Policy Messages', () => {
    it('should handle warning.compromised message', async () => {
      const events: Array<{ type: string; data: unknown }> = [];
      server.addEventHandler((event) => {
        events.push({ type: event.type, data: event.data });
      });

      const warningCompromised = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'warning.compromised' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {
          warning_type: 'SESSION_KEY_COMPROMISED' as const,
          reported_at: new Date().toISOString(),
          recommended_action: 'TERMINATE_AND_REVERIFY' as const,
        },
      };

      await server.handleMessage(warningCompromised);

      const warningEvent = events.find(e =>
        e.type === 'session_event' &&
        (e.data as { event?: string })?.event === 'warning_compromised'
      );
      expect(warningEvent).toBeDefined();
    });

    it('should handle policy.update message', async () => {
      const events: Array<{ type: string; data: unknown }> = [];
      server.addEventHandler((event) => {
        events.push({ type: event.type, data: event.data });
      });

      const policyUpdate = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'policy.update' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {
          policy_epoch: 2 as NonNegativeInteger,
          previous_policy_epoch: 1 as NonNegativeInteger,
          effective_at: new Date().toISOString(),
          reauth_required: true,
        },
      };

      await server.handleMessage(policyUpdate);

      const policyEvent = events.find(e =>
        e.type === 'session_event' &&
        (e.data as { event?: string })?.event === 'policy_updated'
      );
      expect(policyEvent).toBeDefined();
    });
  });

  // ==========================================================================
  // Error Handling and Validation
  // ==========================================================================

  describe('Error Handling and Validation', () => {
    it('should reject message with invalid protocol version', async () => {
      const invalidMessage = {
        protocol_version: '0.1', // Invalid version
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'hello' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {},
      };

      await expect(server.handleMessage(invalidMessage)).rejects.toThrow('Unsupported protocol version');
    });

    it('should reject message with missing required fields', async () => {
      const invalidMessage = {
        protocol_version: '0.2',
        // Missing message_id
        message_type: 'hello' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {},
      };

      await expect(server.handleMessage(invalidMessage)).rejects.toThrow('Missing message_id');
    });

    it('should reject message with non-existent session', async () => {
      const messageWithInvalidSession = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'hello' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: 'nonexistent_session' as IdString,
        sequence: 1 as NonNegativeInteger,
        body: {},
      };

      await expect(server.handleMessage(messageWithInvalidSession)).rejects.toThrow('Session not found');
    });

    it('should reject message with session ownership mismatch', async () => {
      // Create another agent's session
      const otherAgent = await createTestAgent('other');
      const otherSession = await sessionManager.createSession({
        agent_id: otherAgent.agentId,
        instance_id: otherAgent.instanceId,
        risk_level: 'low',
        identity_version: 1,
        revocation_epoch: 1,
        policy_epoch: 1,
        ledger_checkpoint: 'chk_1',
      });

      const messageWithWrongOwner = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'hello' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId, // Wrong agent
        instance_id: clientAgent.instanceId,
        session_id: otherSession.session_id, // Other agent's session
        sequence: 1 as NonNegativeInteger,
        body: {},
      };

      await expect(server.handleMessage(messageWithWrongOwner)).rejects.toThrow('Session ownership mismatch');
    });

    it('should reject message with timestamp outside tolerance', async () => {
      const messageWithOldTimestamp = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'hello' as const,
        timestamp: new Date(Date.now() - 300000).toISOString() as Timestamp, // 5 minutes ago
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {},
      };

      await expect(server.handleMessage(messageWithOldTimestamp)).rejects.toThrow('Timestamp skew');
    });
  });

  // ==========================================================================
  // Client-Side Tests
  // ==========================================================================

  describe('Client Message Creation', () => {
    it('should create valid hello message (sequence increment)', async () => {
      const initialSequence = client.getSequence();

      // sendHello will fail due to network, but sequence should still increment
      try {
        await client.sendHello({
          display_name: 'Test Client',
          capability_summary: {
            capabilities: ['profile.read'],
            capability_digest: 'sha256:test',
          },
          identity_version: 1,
          revocation_epoch: 1,
        });
      } catch {
        // Network error is expected in test environment
      }

      // Message was created (sequence should increment even on network failure)
      expect(client.getSequence()).toBe(initialSequence + 1);
    });

    it('should increment sequence number correctly', async () => {
      const initialSequence = client.getSequence();

      // First message
      try {
        await client.sendHello({
          display_name: 'Test',
          capability_summary: { capabilities: [], capability_digest: '' },
          identity_version: 1,
          revocation_epoch: 1,
        });
      } catch {
        // Network error expected
      }

      expect(client.getSequence()).toBe(initialSequence + 1);

      // Second message
      try {
        await client.sendHello({
          display_name: 'Test',
          capability_summary: { capabilities: [], capability_digest: '' },
          identity_version: 1,
          revocation_epoch: 1,
        });
      } catch {
        // Network error expected
      }

      expect(client.getSequence()).toBe(initialSequence + 2);
    });

    it('should handle message handlers registration', async () => {
      const receivedMessages: unknown[] = [];

      client.onMessage('profile.response', async (message) => {
        receivedMessages.push(message);
        return;
      });

      // Simulate receiving a profile response
      const profileResponse = {
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}` as IdString,
        message_type: 'profile.response' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: serverAgent.agentId,
        instance_id: serverAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: 1 as NonNegativeInteger,
        body: {
          profile: {
            display_name: 'Server Agent',
          },
        },
      };

      await client.handleIncomingMessage(profileResponse);

      expect(receivedMessages).toHaveLength(1);
    });

    it('should validate incoming message format', async () => {
      const invalidMessage = {
        // Missing required fields
        message_type: 'hello' as const,
        body: {},
      };

      await expect(client.handleIncomingMessage(invalidMessage)).rejects.toThrow('missing');
    });

    it('should update session ID', () => {
      const newSessionId = 'ses_new_session';
      client.updateSessionId(newSessionId);

      const config = client.getConfig();
      expect(config.sessionId).toBe(newSessionId);
    });
  });

  // ==========================================================================
  // Cryptographic Integration
  // ==========================================================================

  describe('Cryptographic Integration', () => {
    it('should create valid signatures for messages', async () => {
      const testData = { message: 'test', nonce: 'abc123' };
      const signature = await signObject(testData, clientAgent.privateKey);

      expect(signature).toBeTruthy();
      expect(signature).toHaveLength(128); // 64 bytes in hex

      // Verify signature
      const isValid = await verifyObject(testData, signature, clientAgent.publicKey);
      expect(isValid).toBe(true);
    });

    it('should reject tampered signatures', async () => {
      const testData = { message: 'original', nonce: 'abc123' };
      const signature = await signObject(testData, clientAgent.privateKey);

      // Tamper with data
      const tamperedData = { message: 'tampered', nonce: 'abc123' };
      const isValid = await verifyObject(tamperedData, signature, clientAgent.publicKey);

      expect(isValid).toBe(false);
    });
  });

  // ==========================================================================
  // Concurrent Operations
  // ==========================================================================

  describe('Concurrent Operations', () => {
    it('should handle multiple concurrent messages', async () => {
      const messages = Array.from({ length: 5 }, (_, i) => ({
        protocol_version: '0.2',
        message_id: `msg_${Date.now()}_${i}` as IdString,
        message_type: 'hello' as const,
        timestamp: new Date().toISOString() as Timestamp,
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        session_id: testSession.sessionId,
        sequence: (i + 1) as NonNegativeInteger,
        body: {
          display_name: `Test ${i}`,
          capability_summary: { capabilities: [], capability_digest: '' },
          identity_version: 1,
          revocation_epoch: 1,
        },
      }));

      const results = await Promise.all(
        messages.map(msg => server.handleMessage(msg))
      );

      // All messages should be processed
      expect(results).toHaveLength(5);
    });

    it('should handle concurrent session operations', async () => {
      // Create multiple sessions concurrently
      const createPromises = Array.from({ length: 5 }, (_, i) =>
        sessionManager.createSession({
          agent_id: `agt_concurrent_${i}`,
          instance_id: `ins_concurrent_${i}`,
          risk_level: 'low',
          identity_version: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          ledger_checkpoint: 'chk_1',
        })
      );

      const sessions = await Promise.all(createPromises);

      // All sessions should be created with unique IDs
      const sessionIds = sessions.map(s => s.session_id);
      const uniqueIds = new Set(sessionIds);
      expect(uniqueIds.size).toBe(5);
    });
  });

  // ==========================================================================
  // Network Error Recovery
  // ==========================================================================

  describe('Network Error Recovery', () => {
    it('should timeout on slow responses', async () => {
      const shortTimeoutClient = createExchangeClient({
        agentId: clientAgent.agentId,
        instanceId: clientAgent.instanceId,
        sessionId: testSession.sessionId,
        exchangeEndpoint: 'https://nonexistent.example.com',
        timeout: 100, // 100ms timeout
      });

      // This should timeout or fail quickly
      await expect(
        shortTimeoutClient.requestProfile(['display_name'])
      ).rejects.toThrow();
    });

    it('should cleanup pending requests on dispose', async () => {
      // Create a client with a pending request
      const pendingClient = createExchangeClient({
        agentId: clientAgent.agentId,
        instanceId: clientAgent.instanceId,
        sessionId: testSession.sessionId,
        exchangeEndpoint: 'https://nonexistent.example.com',
        timeout: 30000, // Long timeout so network doesn't fail first
      });

      // Start a request that will be pending
      const requestPromise = pendingClient.requestProfile(['display_name']);

      // Give it a moment to register the pending request
      await new Promise(resolve => setTimeout(resolve, 10));

      // Dispose immediately
      await pendingClient.dispose();

      // The pending request should be rejected (either by dispose or by network)
      // Catch the error to prevent unhandled rejection
      try {
        await requestPromise;
        // Should have thrown
        expect(true).toBe(false);
      } catch (error) {
        // Expected - request was rejected
        expect(error).toBeDefined();
      }
    });
  });
});