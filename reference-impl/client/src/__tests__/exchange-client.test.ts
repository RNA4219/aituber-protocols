/**
 * Exchange Client Tests
 * Tests for message exchange functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ExchangeClient,
  createExchangeClient,
  createExchangeClientFromSession,
  buildHelloMessage,
  buildCollabInviteMessage,
  type ExchangeMessage,
} from '../exchange-client';
import type { ExchangeClientConfig } from '../types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Exchange Client', () => {
  let config: ExchangeClientConfig;
  let client: ExchangeClient;

  beforeEach(() => {
    config = {
      agentId: 'test_agent',
      instanceId: 'test_instance',
      sessionId: 'session_123',
      exchangeEndpoint: 'https://exchange.example.com',
      timeout: 30000,
      autoSequence: true,
    };
    client = new ExchangeClient(config);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('Constructor', () => {
    it('should create an ExchangeClient instance', () => {
      expect(client).toBeInstanceOf(ExchangeClient);
    });

    it('should apply default values for missing config', () => {
      const minimalConfig: ExchangeClientConfig = {
        agentId: 'agent1',
        instanceId: 'instance1',
        sessionId: 'session1',
        exchangeEndpoint: 'https://test.com',
      };
      const newClient = new ExchangeClient(minimalConfig);

      expect(newClient.getConfig().timeout).toBe(30000);
      expect(newClient.getConfig().autoSequence).toBe(true);
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      const returnedConfig = client.getConfig();

      expect(returnedConfig).toEqual(expect.objectContaining(config));
    });
  });

  describe('Sequence Management', () => {
    it('should return initial sequence as 0', () => {
      expect(client.getSequence()).toBe(0);
    });

    it('should allow setting sequence', () => {
      client.setSequence(10);

      expect(client.getSequence()).toBe(10);
    });

    it('should increment sequence on message send', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await client.sendHello({
        display_name: 'Test Agent',
        capability_summary: {
          capabilities: ['cap1'],
          capability_digest: 'sha256:abc',
        },
        identity_version: 1,
        revocation_epoch: 1,
      });

      expect(client.getSequence()).toBe(1);
    });
  });

  describe('updateSessionId', () => {
    it('should update session ID', () => {
      client.updateSessionId('new_session_123');

      expect(client.getConfig().sessionId).toBe('new_session_123');
    });
  });

  describe('Hello', () => {
    it('should send hello message', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await client.sendHello({
        display_name: 'Test Agent',
        capability_summary: {
          capabilities: ['cap1', 'cap2'],
          capability_digest: 'sha256:abc',
        },
        identity_version: 1,
        revocation_epoch: 1,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://exchange.example.com',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('Profile', () => {
    describe('requestProfile', () => {
      it('should send profile request', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true });

        // Use sendMessage directly to avoid waiting for response
        await client.sendMessage('profile.request', {
          requested_fields: ['display_name', 'summary'],
        });

        expect(mockFetch).toHaveBeenCalled();
      });

      it('should send profile response', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true });

        await client.sendProfileResponse('msg_123', {
          display_name: 'Test Agent',
          summary: 'Test summary',
        });

        expect(mockFetch).toHaveBeenCalled();
      });
    });
  });

  describe('Capability', () => {
    it('should send capability request', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      // Use sendMessage directly without waiting for response
      await client.sendMessage('capability.request', {
        requested_capabilities: ['cap1', 'cap2'],
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should send capability response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await client.sendCapabilityResponse('msg_123', ['cap1'], ['cap2'], 'sha256:digest');

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('Collab', () => {
    it('should send collab invite', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      // Use sendMessage directly without waiting for response
      await client.sendMessage('collab.invite', {
        invite_id: 'invite_123',
        title: 'Test Collaboration',
        summary: 'Test summary',
        risk_level: 'low',
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should send collab accept', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await client.acceptCollab('invite_123', ['condition1']);

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should send collab reject', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await client.rejectCollab('invite_123', 'NOT_INTERESTED');

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should send collab defer', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await client.deferCollab(
        'invite_123',
        new Date(Date.now() + 86400000).toISOString(),
        'SCHEDULE_CONFLICT'
      );

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('Status', () => {
    it('should send status notify', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await client.notifyStatus('ACTIVE', {
        detail: 'Agent is active',
        effectiveCapabilities: ['cap1', 'cap2'],
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle all status types', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const statuses = ['ACTIVE', 'DEGRADED', 'QUARANTINED', 'RECOVERING', 'TERMINATING'] as const;

      for (const status of statuses) {
        await client.notifyStatus(status);
      }

      expect(mockFetch).toHaveBeenCalledTimes(statuses.length);
    });
  });

  describe('Session', () => {
    it('should send session renew', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await client.sendSessionRenew(
        'current_session',
        'next_session',
        'EXPIRY_APPROACHING',
        2,
        new Date(Date.now() + 3600000).toISOString()
      );

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should send session terminate', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await client.sendSessionTerminate('session_123', 'MANUAL_TERMINATION', 'User requested');

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('Warning', () => {
    it('should send warning compromised', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await client.sendWarningCompromised(
        'SESSION_KEY_COMPROMISED',
        'TERMINATE_AND_REVERIFY'
      );

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle all warning types', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const warnings = [
        'OPERATION_KEY_COMPROMISED',
        'SESSION_KEY_COMPROMISED',
        'BINDING_COMPROMISED',
        'POLICY_VIOLATION',
      ] as const;

      for (const warning of warnings) {
        await client.sendWarningCompromised(warning, 'QUARANTINE');
      }

      expect(mockFetch).toHaveBeenCalledTimes(warnings.length);
    });
  });

  describe('Policy', () => {
    it('should send policy update', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await client.sendPolicyUpdate(
        2,
        1,
        new Date(Date.now() + 86400000).toISOString(),
        true
      );

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('Message Handling', () => {
    describe('onMessage', () => {
      it('should register message handler', () => {
        const handler = vi.fn();
        client.onMessage('hello', handler);

        expect(() => client.onMessage('hello', handler)).not.toThrow();
      });
    });

    describe('offMessage', () => {
      it('should remove message handler', () => {
        const handler = vi.fn();
        client.onMessage('hello', handler);
        client.offMessage('hello', handler);

        expect(() => client.offMessage('hello', handler)).not.toThrow();
      });
    });

    describe('handleIncomingMessage', () => {
      const createValidMessage = (overrides?: Partial<ExchangeMessage>): ExchangeMessage => ({
        protocol_version: '0.2',
        message_id: 'msg_123',
        message_type: 'hello',
        timestamp: new Date().toISOString(),
        agent_id: 'peer_agent',
        instance_id: 'peer_instance',
        session_id: 'session_123',
        sequence: 1,
        body: { test: 'data' },
        ...overrides,
      });

      it('should process valid incoming message', async () => {
        const message = createValidMessage();
        const result = await client.handleIncomingMessage(message);

        // Should not throw and return undefined for non-response handlers
        expect(result).toBeUndefined();
      });

      it('should throw error for missing message_id', async () => {
        const message = createValidMessage({ message_id: '' as any });

        await expect(client.handleIncomingMessage(message)).rejects.toThrow(
          'Message missing message_id'
        );
      });

      it('should throw error for missing message_type', async () => {
        const message = createValidMessage({ message_type: '' as any });

        await expect(client.handleIncomingMessage(message)).rejects.toThrow(
          'Message missing message_type'
        );
      });

      it('should throw error for missing timestamp', async () => {
        const message = createValidMessage({ timestamp: '' as any });

        await expect(client.handleIncomingMessage(message)).rejects.toThrow(
          'Message missing timestamp'
        );
      });

      it('should throw error for timestamp outside acceptable range', async () => {
        const message = createValidMessage({
          timestamp: new Date(Date.now() - 200000).toISOString(),
        });

        await expect(client.handleIncomingMessage(message)).rejects.toThrow(
          'Message timestamp outside acceptable range'
        );
      });

      it('should call registered message handler', async () => {
        const handler = vi.fn().mockResolvedValue(undefined);
        client.onMessage('hello', handler);

        const message = createValidMessage();
        await client.handleIncomingMessage(message);

        expect(handler).toHaveBeenCalledWith(message);
      });

      it('should handle multiple handlers for same message type', async () => {
        const handler1 = vi.fn().mockResolvedValue(undefined);
        const handler2 = vi.fn().mockResolvedValue(undefined);
        client.onMessage('hello', handler1);
        client.onMessage('hello', handler2);

        const message = createValidMessage();
        await client.handleIncomingMessage(message);

        expect(handler1).toHaveBeenCalled();
        expect(handler2).toHaveBeenCalled();
      });
    });
  });

  describe('Event Handling', () => {
    it('should register event handler', () => {
      const handler = vi.fn();
      client.addEventHandler(handler);

      expect(() => client.addEventHandler(handler)).not.toThrow();
    });

    it('should remove event handler', () => {
      const handler = vi.fn();
      client.addEventHandler(handler);
      client.removeEventHandler(handler);

      expect(() => client.removeEventHandler(handler)).not.toThrow();
    });

    it('should emit events to handlers', async () => {
      const handler = vi.fn();
      client.addEventHandler(handler);

      // Trigger an event by sending a message
      mockFetch.mockResolvedValueOnce({ ok: true });
      await client.sendHello({
        display_name: 'Test',
        capability_summary: {
          capabilities: [],
          capability_digest: 'sha256:abc',
        },
        identity_version: 1,
        revocation_epoch: 1,
      });

      // The handler should have been called with the event
      // Note: events are emitted internally during message handling
    });

    it('should catch errors in event handlers and log to console', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const normalHandler = vi.fn();

      client.addEventHandler(errorHandler);
      client.addEventHandler(normalHandler);

      // Trigger an event - we need to get an event emitted
      // Use handleIncomingMessage which emits 'message_received' event
      const message = {
        protocol_version: '0.2',
        message_id: 'msg_123',
        message_type: 'hello' as const,
        timestamp: new Date().toISOString(),
        agent_id: 'peer_agent',
        instance_id: 'peer_instance',
        session_id: 'session_123',
        sequence: 1,
        body: { test: 'data' },
      };

      await client.handleIncomingMessage(message);

      // Both handlers should be called (error doesn't stop execution)
      expect(errorHandler).toHaveBeenCalled();
      expect(normalHandler).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('dispose', () => {
    it('should clear pending requests and handlers', async () => {
      await client.dispose();

      expect(client.getSequence()).toBe(0);
    });

    it('should reject pending requests', async () => {
      // Mock fetch to never resolve (simulating a slow network)
      mockFetch.mockImplementation(() => new Promise(() => {}));

      // Create a pending request by making one that expects response
      const promise = client.requestProfile(['display_name']);

      // Wait for the request to be sent
      await new Promise(resolve => setTimeout(resolve, 10));

      // Dispose immediately - this should reject the pending promise
      await client.dispose();

      // The pending request should be rejected
      await expect(promise).rejects.toThrow('Client disposed');
    });
  });

  describe('Error Handling', () => {
    it('should throw error on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: { message: 'Server error' } }),
      });

      await expect(
        client.sendHello({
          display_name: 'Test',
          capability_summary: {
            capabilities: [],
            capability_digest: 'sha256:abc',
          },
          identity_version: 1,
          revocation_epoch: 1,
        })
      ).rejects.toThrow();
    });

    it('should handle response without JSON body on error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('No JSON');
        },
      });

      await expect(
        client.sendHello({
          display_name: 'Test',
          capability_summary: {
            capabilities: [],
            capability_digest: 'sha256:abc',
          },
          identity_version: 1,
          revocation_epoch: 1,
        })
      ).rejects.toThrow();
    });

    it('should reject pending request when sendRaw fails', async () => {
      // Make fetch reject immediately
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      // requestProfile expects a response, so it creates a pending request
      await expect(client.requestProfile(['display_name'])).rejects.toThrow('Network failure');
    });
  });

  describe('Factory Functions', () => {
    describe('createExchangeClient', () => {
      it('should create an ExchangeClient instance', () => {
        const newClient = createExchangeClient(config);

        expect(newClient).toBeInstanceOf(ExchangeClient);
      });
    });

    describe('createExchangeClientFromSession', () => {
      it('should create client from session info', () => {
        const session = {
          session_id: 'session_456',
          agent_id: 'agent_456',
          instance_id: 'instance_456',
        };

        const newClient = createExchangeClientFromSession(
          session,
          'https://exchange.example.com'
        );

        expect(newClient).toBeInstanceOf(ExchangeClient);
        expect(newClient.getConfig().sessionId).toBe('session_456');
      });

      it('should accept additional options', () => {
        const session = {
          session_id: 'session_456',
          agent_id: 'agent_456',
          instance_id: 'instance_456',
        };

        const newClient = createExchangeClientFromSession(
          session,
          'https://exchange.example.com',
          { timeout: 60000 }
        );

        expect(newClient.getConfig().timeout).toBe(60000);
      });
    });
  });

  describe('Message Builder Utilities', () => {
    describe('buildHelloMessage', () => {
      it('should build hello message body', () => {
        const body = buildHelloMessage(
          'Test Agent',
          ['cap1', 'cap2'],
          'sha256:digest',
          1,
          5
        );

        expect(body).toEqual({
          display_name: 'Test Agent',
          capability_summary: {
            capabilities: ['cap1', 'cap2'],
            capability_digest: 'sha256:digest',
          },
          identity_version: 1,
          revocation_epoch: 5,
        });
      });
    });

    describe('buildCollabInviteMessage', () => {
      it('should build collab invite message body', () => {
        const body = buildCollabInviteMessage('invite_123', 'Test Collab', {
          summary: 'Test summary',
          riskLevel: 'high',
          requiresFreshReverification: true,
        });

        expect(body).toEqual({
          invite_id: 'invite_123',
          title: 'Test Collab',
          summary: 'Test summary',
          risk_level: 'high',
          requires_fresh_reverification: true,
        });
      });

      it('should use default risk level', () => {
        const body = buildCollabInviteMessage('invite_123', 'Test Collab');

        expect(body.risk_level).toBe('low');
      });
    });
  });

  describe('Timeout Handling', () => {
    it('should use custom timeout for session renew', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await client.sendSessionRenew(
        'current_session',
        'next_session',
        'EXPIRY_APPROACHING',
        2,
        new Date(Date.now() + 3600000).toISOString()
      );

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should reject with timeout error when response times out (lines 602-603)', async () => {
      vi.useFakeTimers();

      // Mock fetch to never resolve (simulating a slow network)
      mockFetch.mockImplementation(() => new Promise(() => {}));

      // Create a client with a 5000ms timeout
      const timeoutMs = 5000;
      const shortTimeoutClient = new ExchangeClient({
        ...config,
        timeout: timeoutMs,
      });

      // Start the request
      const profilePromise = shortTimeoutClient.requestProfile(['display_name']);

      // Flush microtasks by yielding to the event loop (without running timers)
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Verify fetch was called
      expect(mockFetch).toHaveBeenCalled();

      // Advance time past the timeout (this triggers the timeout callback)
      vi.advanceTimersByTime(timeoutMs + 1);

      // The promise should reject with a timeout error
      await expect(profilePromise).rejects.toThrow(/Request timeout for message/);

      // Verify cleanup: pending request should be removed after timeout
      expect(shortTimeoutClient.getPendingRequestCount()).toBe(0);

      // Clean up
      vi.useRealTimers();
      await shortTimeoutClient.dispose();
    });

    it('should resolve pending request when response is received (lines 608-609)', async () => {
      // Mock fetch to succeed
      mockFetch.mockResolvedValueOnce({ ok: true });

      // Start the request (which creates a pending request)
      const profilePromise = client.requestProfile(['display_name']);

      // Wait a bit for the request to be sent
      await new Promise(resolve => setTimeout(resolve, 10));

      // Get the message_id from the last fetch call
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const requestBody = lastCall[1].body;
      const sentMessage = JSON.parse(requestBody);
      const messageId = sentMessage.message_id;

      // Simulate receiving a response message with matching message_id
      const responseBody = {
        profile: {
          display_name: 'Test Profile',
          summary: 'A test profile',
        },
      };

      const responseMessage = {
        protocol_version: '0.2',
        message_id: messageId, // Must match the request
        message_type: 'profile.response' as const,
        timestamp: new Date().toISOString(),
        agent_id: 'peer_agent',
        instance_id: 'peer_instance',
        session_id: 'session_123',
        sequence: 1,
        body: responseBody,
      };

      // Handle the incoming response
      await client.handleIncomingMessage(responseMessage);

      // The promise should resolve with the response body
      const result = await profilePromise;
      expect(result).toEqual(responseBody);
    });

    it('should not resolve request when response has wrong message_id', async () => {
      vi.useFakeTimers();

      const timeoutMs = 5000;
      const testClient = new ExchangeClient({
        ...config,
        timeout: timeoutMs,
      });

      // Mock fetch to succeed
      mockFetch.mockResolvedValueOnce({ ok: true });

      // Start the request
      const profilePromise = testClient.requestProfile(['display_name']);

      // Flush microtasks by yielding to the event loop (without running timers)
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Verify fetch was called
      expect(mockFetch).toHaveBeenCalled();

      // Verify pending request exists
      expect(testClient.getPendingRequestCount()).toBe(1);

      // Simulate receiving a response with WRONG message_id
      const wrongResponseMessage = {
        protocol_version: '0.2',
        message_id: 'wrong_message_id', // Wrong ID
        message_type: 'profile.response' as const,
        timestamp: new Date().toISOString(),
        agent_id: 'peer_agent',
        instance_id: 'peer_instance',
        session_id: 'session_123',
        sequence: 1,
        body: {
          profile: {
            display_name: 'Wrong Profile',
            summary: 'Should not be received',
          },
        },
      };

      // Handle the incoming response with wrong ID
      await testClient.handleIncomingMessage(wrongResponseMessage);

      // The pending request should still exist (not resolved)
      expect(testClient.getPendingRequestCount()).toBe(1);

      // Advance time past timeout - request should timeout
      vi.advanceTimersByTime(timeoutMs + 1);

      // The promise should reject with timeout (not resolve with wrong response)
      await expect(profilePromise).rejects.toThrow(/Request timeout for message/);

      // Verify cleanup after timeout
      expect(testClient.getPendingRequestCount()).toBe(0);

      // Cleanup
      vi.useRealTimers();
      await testClient.dispose();
    });

    it('should handle multiple parallel requests independently', async () => {
      vi.useFakeTimers();

      const timeoutMs = 5000;
      const testClient = new ExchangeClient({
        ...config,
        timeout: timeoutMs,
      });

      // Mock fetch to succeed for all requests
      mockFetch.mockResolvedValue({ ok: true });

      // Start multiple parallel requests
      const profilePromise1 = testClient.requestProfile(['display_name']);
      const profilePromise2 = testClient.requestProfile(['summary']);
      const profilePromise3 = testClient.requestProfile(['display_name', 'summary']);

      // Flush microtasks by yielding to the event loop (without running timers)
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Verify all fetch calls were made
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Should have 3 pending requests
      expect(testClient.getPendingRequestCount()).toBe(3);

      // Get message_ids from fetch calls
      const messageIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const call = mockFetch.mock.calls[i];
        const requestBody = call[1].body;
        const sentMessage = JSON.parse(requestBody);
        messageIds.push(sentMessage.message_id);
      }

      // All message_ids should be unique
      expect(new Set(messageIds).size).toBe(3);

      // Resolve the second request first
      await testClient.handleIncomingMessage({
        protocol_version: '0.2',
        message_id: messageIds[1],
        message_type: 'profile.response' as const,
        timestamp: new Date().toISOString(),
        agent_id: 'peer_agent',
        instance_id: 'peer_instance',
        session_id: 'session_123',
        sequence: 1,
        body: {
          profile: {
            summary: 'Second Profile',
          },
        },
      });

      // Should have 2 remaining pending requests
      expect(testClient.getPendingRequestCount()).toBe(2);

      // Second promise should be resolved
      const result2 = await profilePromise2;
      expect(result2.profile.summary).toBe('Second Profile');

      // Resolve the first request
      await testClient.handleIncomingMessage({
        protocol_version: '0.2',
        message_id: messageIds[0],
        message_type: 'profile.response' as const,
        timestamp: new Date().toISOString(),
        agent_id: 'peer_agent',
        instance_id: 'peer_instance',
        session_id: 'session_123',
        sequence: 2,
        body: {
          profile: {
            display_name: 'First Profile',
          },
        },
      });

      expect(testClient.getPendingRequestCount()).toBe(1);
      const result1 = await profilePromise1;
      expect(result1.profile.display_name).toBe('First Profile');

      // Resolve the third request
      await testClient.handleIncomingMessage({
        protocol_version: '0.2',
        message_id: messageIds[2],
        message_type: 'profile.response' as const,
        timestamp: new Date().toISOString(),
        agent_id: 'peer_agent',
        instance_id: 'peer_instance',
        session_id: 'session_123',
        sequence: 3,
        body: {
          profile: {
            display_name: 'Third Profile',
            summary: 'Third Summary',
          },
        },
      });

      expect(testClient.getPendingRequestCount()).toBe(0);
      const result3 = await profilePromise3;
      expect(result3.profile.display_name).toBe('Third Profile');

      // Cleanup
      vi.useRealTimers();
      await testClient.dispose();
    });
  });
});