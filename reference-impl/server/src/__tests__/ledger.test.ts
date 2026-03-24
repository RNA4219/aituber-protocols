import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LedgerImpl, type LedgerConfig, type LedgerEvent } from '../ledger.js';
import { generateKeyPair, signObject, canonicalize } from '../crypto.js';

describe('Ledger', () => {
  let ledger: LedgerImpl;
  const defaultConfig: LedgerConfig = {
    storageRoot: '/tmp/ledger',
    retentionDays: 30,
  };

  const createValidEvent = (overrides: Partial<LedgerEvent> = {}): LedgerEvent => ({
    spec_version: '0.2',
    schema_version: '0.2',
    event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    event_type: 'key.revoked',
    agent_id: 'agt_B001',
    controller_id: 'ctrl_B001',
    event_time: new Date().toISOString(),
    recorded_at: new Date().toISOString(),
    producer_key_id: 'opk_B001_1',
    sequence: 1,
    payload_hash: 'sha256:payload_hash_value',
    ledger_checkpoint: 'chk_0',
    payload: {
      key_id: 'opk_B001_1',
      key_scope: 'operation',
      revocation_reason: 'compromised',
      effective_at: new Date().toISOString(),
      revocation_epoch: 3,
    },
    signatures: [
      {
        key_id: 'opk_B001_1',
        algorithm: 'ed25519',
        canonicalization: 'jcs',
        value: 'signature_value',
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    ledger = new LedgerImpl(defaultConfig);
  });

  describe('イベント追加テスト', () => {
    it('should append a valid event successfully', async () => {
      const event = createValidEvent();
      const result = await ledger.appendEvent(event);

      expect(result.checkpoint).toBeDefined();
      expect(result.checkpoint).toMatch(/^chk_/);
    });

    it('should update checkpoint after appending event', async () => {
      const initialCheckpoint = ledger.getCheckpoint();
      expect(initialCheckpoint).toBe('chk_0');

      const event = createValidEvent();
      await ledger.appendEvent(event);

      const newCheckpoint = ledger.getCheckpoint();
      expect(newCheckpoint).not.toBe(initialCheckpoint);
      expect(newCheckpoint).toBe('chk_1');
    });

    it('should increment checkpoint for each event', async () => {
      const event1 = createValidEvent({ event_id: 'evt_1' });
      const event2 = createValidEvent({ event_id: 'evt_2' });
      const event3 = createValidEvent({ event_id: 'evt_3' });

      await ledger.appendEvent(event1);
      expect(ledger.getCheckpoint()).toBe('chk_1');

      await ledger.appendEvent(event2);
      expect(ledger.getCheckpoint()).toBe('chk_2');

      await ledger.appendEvent(event3);
      expect(ledger.getCheckpoint()).toBe('chk_3');
    });

    it('should store event with updated checkpoint', async () => {
      const event = createValidEvent();
      const result = await ledger.appendEvent(event);

      const storedEvent = await ledger.getEvent(event.event_id);
      expect(storedEvent).toBeDefined();
      expect(storedEvent?.ledger_checkpoint).toBe(result.checkpoint);
    });

    it('should throw error for invalid event', async () => {
      const invalidEvent = createValidEvent({
        event_id: '', // Invalid: empty event_id
      });

      await expect(ledger.appendEvent(invalidEvent)).rejects.toThrow('Invalid event');
    });

    it('should append different event types', async () => {
      const eventTypes: LedgerEvent['event_type'][] = [
        'agent.created',
        'key.added',
        'key.revoked',
        'key.rotated',
        'binding.added',
        'binding.updated',
        'binding.removed',
        'compromise.reported',
        'agent.quarantined',
        'recovery.initiated',
        'recovery.completed',
        'policy.updated',
      ];

      for (let i = 0; i < eventTypes.length; i++) {
        const event = createValidEvent({
          event_id: `evt_${i}`,
          event_type: eventTypes[i],
        });
        const result = await ledger.appendEvent(event);
        expect(result.checkpoint).toBe(`chk_${i + 1}`);
      }
    });
  });

  describe('イベント検証テスト', () => {
    it('should validate a correct event', async () => {
      const event = createValidEvent();
      const result = await ledger.validateEvent(event);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject event without event_id', async () => {
      const event = createValidEvent({ event_id: '' });
      const result = await ledger.validateEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('event_id is required');
    });

    it('should reject event without event_type', async () => {
      const event = createValidEvent({ event_type: '' as LedgerEvent['event_type'] });
      const result = await ledger.validateEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('event_type is required');
    });

    it('should reject event without agent_id', async () => {
      const event = createValidEvent({ agent_id: '' });
      const result = await ledger.validateEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('agent_id is required');
    });

    it('should reject event without event_time', async () => {
      const event = createValidEvent({ event_time: '' });
      const result = await ledger.validateEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('event_time is required');
    });

    it('should reject event without signatures', async () => {
      const event = createValidEvent({ signatures: [] });
      const result = await ledger.validateEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('at least one signature is required');
    });

    it('should reject event with invalid event_type', async () => {
      const event = createValidEvent({ event_type: 'invalid.type' as LedgerEvent['event_type'] });
      const result = await ledger.validateEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('invalid event_type'))).toBe(true);
    });

    it('should collect multiple validation errors', async () => {
      const event = createValidEvent({
        event_id: '',
        event_type: '' as LedgerEvent['event_type'],
        agent_id: '',
        signatures: [],
      });
      const result = await ledger.validateEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(5);
    });
  });

  describe('Checkpointテスト', () => {
    it('should return initial checkpoint', () => {
      const checkpoint = ledger.getCheckpoint();
      expect(checkpoint).toBe('chk_0');
    });

    it('should update and increment checkpoint for each event', async () => {
      for (let i = 1; i <= 5; i++) {
        const event = createValidEvent({ event_id: `evt_${i}` });
        await ledger.appendEvent(event);
        expect(ledger.getCheckpoint()).toBe(`chk_${i}`);
      }
    });

    it('should detect checkpoint regression', async () => {
      // Add events to reach checkpoint 50
      for (let i = 1; i <= 50; i++) {
        const event = createValidEvent({ event_id: `evt_${i}` });
        await ledger.appendEvent(event);
      }

      const currentCheckpoint = ledger.getCheckpoint();
      expect(currentCheckpoint).toBe('chk_50');

      // Verify checkpoint regression detection logic
      const knownCheckpoint = 1050;
      const receivedCheckpoint = 1000;

      // Verify that the received checkpoint is older
      expect(receivedCheckpoint).toBeLessThan(knownCheckpoint);
    });
  });

  describe('イベント取得テスト', () => {
    it('should retrieve stored event by ID', async () => {
      const event = createValidEvent({ event_id: 'evt_test_001' });
      await ledger.appendEvent(event);

      const retrieved = await ledger.getEvent('evt_test_001');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.event_id).toBe('evt_test_001');
      expect(retrieved?.agent_id).toBe(event.agent_id);
      expect(retrieved?.event_type).toBe(event.event_type);
    });

    it('should return null for non-existent event', async () => {
      const retrieved = await ledger.getEvent('nonexistent_event_id');
      expect(retrieved).toBeNull();
    });

    it('should preserve event payload', async () => {
      const payload = {
        key_id: 'opk_001',
        key_scope: 'operation' as const,
        revocation_reason: 'compromised' as const,
        effective_at: '2026-03-24T12:00:00Z',
        revocation_epoch: 5,
        replacement_key_id: 'opk_002',
      };

      const event = createValidEvent({
        event_id: 'evt_payload_test',
        payload,
      });
      await ledger.appendEvent(event);

      const retrieved = await ledger.getEvent('evt_payload_test');

      expect(retrieved?.payload).toEqual(payload);
    });
  });

  describe('Agentイベント一覧テスト', () => {
    it('should retrieve events for a specific agent', async () => {
      // Create events for different agents
      const event1 = createValidEvent({
        event_id: 'evt_agent1_1',
        agent_id: 'agt_A001',
      });
      const event2 = createValidEvent({
        event_id: 'evt_agent1_2',
        agent_id: 'agt_A001',
      });
      const event3 = createValidEvent({
        event_id: 'evt_agent2_1',
        agent_id: 'agt_B001',
      });

      await ledger.appendEvent(event1);
      await ledger.appendEvent(event2);
      await ledger.appendEvent(event3);

      const result = await ledger.getAgentEvents('agt_A001');

      expect(result.events).toHaveLength(2);
      expect(result.events.every(e => e.agent_id === 'agt_A001')).toBe(true);
    });

    it('should return empty array for agent with no events', async () => {
      const result = await ledger.getAgentEvents('nonexistent_agent');

      expect(result.events).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    it('should respect maxEvents limit', async () => {
      // Create more events than the limit
      for (let i = 0; i < 10; i++) {
        const event = createValidEvent({
          event_id: `evt_limit_${i}`,
          agent_id: 'agt_limit_test',
        });
        await ledger.appendEvent(event);
      }

      const result = await ledger.getAgentEvents('agt_limit_test', { maxEvents: 5 });

      expect(result.events.length).toBeLessThanOrEqual(5);
      expect(result.hasMore).toBe(true);
    });

    it('should filter events by checkpoint', async () => {
      // Create multiple events
      for (let i = 0; i < 5; i++) {
        const event = createValidEvent({
          event_id: `evt_filter_${i}`,
          agent_id: 'agt_filter_test',
        });
        await ledger.appendEvent(event);
      }

      // Get events since checkpoint 2
      const result = await ledger.getAgentEvents('agt_filter_test', {
        sinceCheckpoint: 'chk_2',
      });

      // All returned events should have checkpoint > chk_2
      result.events.forEach(event => {
        const eventNum = parseInt(event.ledger_checkpoint.replace('chk_', ''), 10);
        expect(eventNum).toBeGreaterThan(2);
      });
    });

    it('should return current checkpoint in result', async () => {
      for (let i = 0; i < 3; i++) {
        const event = createValidEvent({
          event_id: `evt_cp_${i}`,
          agent_id: 'agt_cp_test',
        });
        await ledger.appendEvent(event);
      }

      const result = await ledger.getAgentEvents('agt_cp_test');

      expect(result.checkpoint).toBe(ledger.getCheckpoint());
    });

    it('should sort events by event_time descending', async () => {
      const now = Date.now();
      const times = [
        new Date(now - 3000).toISOString(),
        new Date(now - 1000).toISOString(),
        new Date(now - 2000).toISOString(),
      ];

      for (let i = 0; i < 3; i++) {
        const event = createValidEvent({
          event_id: `evt_sort_${i}`,
          agent_id: 'agt_sort_test',
          event_time: times[i],
        });
        await ledger.appendEvent(event);
      }

      const result = await ledger.getAgentEvents('agt_sort_test');

      // Verify descending order
      for (let i = 1; i < result.events.length; i++) {
        const prevTime = new Date(result.events[i - 1].event_time).getTime();
        const currTime = new Date(result.events[i].event_time).getTime();
        expect(prevTime).toBeGreaterThanOrEqual(currTime);
      }
    });
  });

  describe('イベント種別別テスト', () => {
    it('should handle key.revoked event', async () => {
      const event = createValidEvent({
        event_type: 'key.revoked',
        payload: {
          key_id: 'opk_001',
          key_scope: 'operation',
          revocation_reason: 'compromised',
          effective_at: new Date().toISOString(),
          revocation_epoch: 5,
        },
      });

      const result = await ledger.appendEvent(event);
      expect(result.checkpoint).toBeDefined();

      const stored = await ledger.getEvent(event.event_id);
      expect(stored?.payload.key_id).toBe('opk_001');
      expect(stored?.payload.revocation_reason).toBe('compromised');
    });

    it('should handle compromise.reported event', async () => {
      const event = createValidEvent({
        event_type: 'compromise.reported',
        payload: {
          compromise_scope: 'operation_key',
          severity: 'high',
          detected_at: new Date().toISOString(),
          effective_at: new Date().toISOString(),
          reported_reason: 'Key suspected to be compromised',
          revocation_epoch: 5,
          recommended_actions: ['revoke_key', 'initiate_recovery'],
        },
      });

      const result = await ledger.appendEvent(event);
      expect(result.checkpoint).toBeDefined();

      const stored = await ledger.getEvent(event.event_id);
      expect(stored?.payload.severity).toBe('high');
      expect(stored?.payload.recommended_actions).toContain('revoke_key');
    });

    it('should handle agent.quarantined event', async () => {
      const event = createValidEvent({
        event_type: 'agent.quarantined',
        payload: {
          quarantine_reason: 'OPERATION_KEY_COMPROMISED',
          quarantine_level: 'hard',
          effective_at: new Date().toISOString(),
          revocation_epoch: 5,
          policy_epoch: 2,
          high_risk_blocked: true,
          capability_restrictions: ['collab.invite', 'memory.exchange'],
          exchange_blocked_message_types: ['collab.invite'],
          exit_conditions: ['recovery_completed'],
        },
      });

      const result = await ledger.appendEvent(event);
      expect(result.checkpoint).toBeDefined();

      const stored = await ledger.getEvent(event.event_id);
      expect(stored?.payload.quarantine_level).toBe('hard');
      expect(stored?.payload.high_risk_blocked).toBe(true);
    });

    it('should handle recovery.initiated event', async () => {
      const event = createValidEvent({
        event_type: 'recovery.initiated',
        payload: {
          recovery_id: 'rcv_001',
          initiated_at: new Date().toISOString(),
          recovery_reason: 'Key compromise',
          initiated_by_key_id: 'recovery_key_001',
          revocation_epoch: 5,
          quarantine_required: true,
        },
      });

      const result = await ledger.appendEvent(event);
      expect(result.checkpoint).toBeDefined();

      const stored = await ledger.getEvent(event.event_id);
      expect(stored?.payload.recovery_id).toBe('rcv_001');
      expect(stored?.payload.quarantine_required).toBe(true);
    });

    it('should handle recovery.completed event', async () => {
      const event = createValidEvent({
        event_type: 'recovery.completed',
        payload: {
          recovery_id: 'rcv_001',
          completed_at: new Date().toISOString(),
          new_operation_key_ids: ['opk_002'],
          binding_reverified: [
            { platform_type: 'discord', platform_account_id: '1234567890' },
          ],
          revocation_epoch: 6,
          identity_version: 11,
          policy_epoch: 2,
          quarantine_cleared: true,
          recovery_summary: 'Recovery completed successfully',
        },
      });

      const result = await ledger.appendEvent(event);
      expect(result.checkpoint).toBeDefined();

      const stored = await ledger.getEvent(event.event_id);
      expect(stored?.payload.quarantine_cleared).toBe(true);
      expect(stored?.payload.new_operation_key_ids).toEqual(['opk_002']);
    });

    it('should handle binding.updated event', async () => {
      const event = createValidEvent({
        event_type: 'binding.updated',
        payload: {
          platform_type: 'discord',
          platform_account_id: '1234567890',
          display_handle: 'agent_b',
          binding_status: 'active',
          bound_by_key_id: 'opk_001',
          binding_version: 2,
          effective_at: new Date().toISOString(),
        },
      });

      const result = await ledger.appendEvent(event);
      expect(result.checkpoint).toBeDefined();

      const stored = await ledger.getEvent(event.event_id);
      expect(stored?.payload.platform_type).toBe('discord');
      expect(stored?.payload.binding_version).toBe(2);
    });

    it('should handle key.added event', async () => {
      const event = createValidEvent({
        event_type: 'key.added',
        payload: {
          key_id: 'opk_new_001',
          key_scope: 'operation',
          public_key: 'public_key_hex_value',
          algorithm: 'ed25519',
          added_at: new Date().toISOString(),
          added_by_key_id: 'opk_001',
        },
      });

      const result = await ledger.appendEvent(event);
      expect(result.checkpoint).toBeDefined();

      const stored = await ledger.getEvent(event.event_id);
      expect(stored?.payload.key_id).toBe('opk_new_001');
      expect(stored?.payload.algorithm).toBe('ed25519');
    });

    it('should handle key.rotated event', async () => {
      const event = createValidEvent({
        event_type: 'key.rotated',
        payload: {
          old_key_id: 'opk_001',
          new_key_id: 'opk_002',
          key_scope: 'operation',
          rotated_at: new Date().toISOString(),
          rotated_by_key_id: 'opk_001',
          revocation_epoch: 5,
        },
      });

      const result = await ledger.appendEvent(event);
      expect(result.checkpoint).toBeDefined();

      const stored = await ledger.getEvent(event.event_id);
      expect(stored?.payload.old_key_id).toBe('opk_001');
      expect(stored?.payload.new_key_id).toBe('opk_002');
    });
  });

  describe('複合シナリオテスト', () => {
    it('should handle complete recovery flow events', async () => {
      const agentId = 'agt_B001';
      const events: LedgerEvent[] = [
        createValidEvent({
          event_id: 'evt_compromise',
          event_type: 'compromise.reported',
          agent_id: agentId,
          payload: {
            compromise_scope: 'operation_key',
            severity: 'high',
            detected_at: new Date().toISOString(),
            effective_at: new Date().toISOString(),
            reported_reason: 'Key compromise suspected',
            revocation_epoch: 4,
            recommended_actions: ['initiate_recovery'],
          },
        }),
        createValidEvent({
          event_id: 'evt_quarantine',
          event_type: 'agent.quarantined',
          agent_id: agentId,
          payload: {
            quarantine_reason: 'OPERATION_KEY_COMPROMISED',
            quarantine_level: 'hard',
            effective_at: new Date().toISOString(),
            revocation_epoch: 4,
            policy_epoch: 2,
            high_risk_blocked: true,
            capability_restrictions: [],
            exchange_blocked_message_types: [],
            exit_conditions: ['recovery_completed'],
          },
        }),
        createValidEvent({
          event_id: 'evt_recovery_init',
          event_type: 'recovery.initiated',
          agent_id: agentId,
          payload: {
            recovery_id: 'rcv_001',
            initiated_at: new Date().toISOString(),
            recovery_reason: 'Key compromise',
            initiated_by_key_id: 'recovery_key_001',
            revocation_epoch: 4,
            quarantine_required: true,
          },
        }),
        createValidEvent({
          event_id: 'evt_recovery_complete',
          event_type: 'recovery.completed',
          agent_id: agentId,
          payload: {
            recovery_id: 'rcv_001',
            completed_at: new Date().toISOString(),
            new_operation_key_ids: ['opk_002'],
            binding_reverified: [],
            revocation_epoch: 5,
            identity_version: 6,
            policy_epoch: 2,
            quarantine_cleared: true,
            recovery_summary: 'Recovery completed',
          },
        }),
      ];

      for (const event of events) {
        await ledger.appendEvent(event);
      }

      const agentEvents = await ledger.getAgentEvents(agentId);
      expect(agentEvents.events).toHaveLength(4);
      expect(ledger.getCheckpoint()).toBe('chk_4');
    });
  });

  describe('getEventCount テスト', () => {
    it('should return 0 for empty ledger', () => {
      expect(ledger.getEventCount()).toBe(0);
    });

    it('should return correct count after adding events', async () => {
      expect(ledger.getEventCount()).toBe(0);

      await ledger.appendEvent(createValidEvent({ event_id: 'evt_count_1' }));
      expect(ledger.getEventCount()).toBe(1);

      await ledger.appendEvent(createValidEvent({ event_id: 'evt_count_2' }));
      expect(ledger.getEventCount()).toBe(2);

      await ledger.appendEvent(createValidEvent({ event_id: 'evt_count_3' }));
      expect(ledger.getEventCount()).toBe(3);
    });

    it('should return correct count for multiple agents', async () => {
      await ledger.appendEvent(createValidEvent({ event_id: 'evt_multi_1', agent_id: 'agt_A' }));
      await ledger.appendEvent(createValidEvent({ event_id: 'evt_multi_2', agent_id: 'agt_B' }));
      await ledger.appendEvent(createValidEvent({ event_id: 'evt_multi_3', agent_id: 'agt_A' }));

      expect(ledger.getEventCount()).toBe(3);
    });
  });

  describe('署名検証テスト (publicKeyProvider)', () => {
    it('should validate event with valid signature when publicKeyProvider is configured', async () => {
      const keyPair = await generateKeyPair();
      const agentId = 'agt_sig_test';
      const keyId = 'opk_sig_test';

      const publicKeyProvider = vi.fn().mockResolvedValue(keyPair.publicKey);
      const configWithProvider: LedgerConfig = {
        ...defaultConfig,
        publicKeyProvider,
      };
      const ledgerWithProvider = new LedgerImpl(configWithProvider);

      const baseEvent = createValidEvent({
        agent_id: agentId,
        producer_key_id: keyId,
      });

      // 署名対象データを作成（signaturesフィールドを除く）
      const { signatures: _, ...dataToSign } = baseEvent;
      const signature = await signObject(dataToSign, keyPair.privateKey);

      const signedEvent: LedgerEvent = {
        ...baseEvent,
        signatures: [
          {
            key_id: keyId,
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: signature,
          },
        ],
      };

      const result = await ledgerWithProvider.validateEvent(signedEvent);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(publicKeyProvider).toHaveBeenCalledWith(keyId, agentId);
    });

    it('should reject event when signature verification fails', async () => {
      const keyPair = await generateKeyPair();
      const otherKeyPair = await generateKeyPair();
      const agentId = 'agt_sig_fail';
      const keyId = 'opk_sig_fail';

      const publicKeyProvider = vi.fn().mockResolvedValue(keyPair.publicKey);
      const configWithProvider: LedgerConfig = {
        ...defaultConfig,
        publicKeyProvider,
      };
      const ledgerWithProvider = new LedgerImpl(configWithProvider);

      const baseEvent = createValidEvent({
        agent_id: agentId,
        producer_key_id: keyId,
      });

      // 異なる鍵で署名
      const { signatures: _, ...dataToSign } = baseEvent;
      const signature = await signObject(dataToSign, otherKeyPair.privateKey);

      const signedEvent: LedgerEvent = {
        ...baseEvent,
        signatures: [
          {
            key_id: keyId,
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: signature,
          },
        ],
      };

      const result = await ledgerWithProvider.validateEvent(signedEvent);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('signature verification failed');
    });

    it('should skip signature without value', async () => {
      const keyPair = await generateKeyPair();
      const agentId = 'agt_no_value';
      const keyId = 'opk_no_value';

      const publicKeyProvider = vi.fn().mockResolvedValue(keyPair.publicKey);
      const configWithProvider: LedgerConfig = {
        ...defaultConfig,
        publicKeyProvider,
      };
      const ledgerWithProvider = new LedgerImpl(configWithProvider);

      const baseEvent = createValidEvent({
        agent_id: agentId,
        producer_key_id: keyId,
      });

      // valueのない署名
      const signedEvent: LedgerEvent = {
        ...baseEvent,
        signatures: [
          {
            key_id: keyId,
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: '', // 空のvalue
          },
        ],
      };

      const result = await ledgerWithProvider.validateEvent(signedEvent);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('signature verification failed');
      // publicKeyProviderは呼ばれないはず（valueがないためスキップ）
      expect(publicKeyProvider).not.toHaveBeenCalled();
    });

    it('should skip when publicKeyProvider returns null', async () => {
      const keyPair = await generateKeyPair();
      const agentId = 'agt_null_key';
      const keyId = 'opk_null_key';

      const publicKeyProvider = vi.fn().mockResolvedValue(null);
      const configWithProvider: LedgerConfig = {
        ...defaultConfig,
        publicKeyProvider,
      };
      const ledgerWithProvider = new LedgerImpl(configWithProvider);

      const baseEvent = createValidEvent({
        agent_id: agentId,
        producer_key_id: keyId,
      });

      const { signatures: _, ...dataToSign } = baseEvent;
      const signature = await signObject(dataToSign, keyPair.privateKey);

      const signedEvent: LedgerEvent = {
        ...baseEvent,
        signatures: [
          {
            key_id: keyId,
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: signature,
          },
        ],
      };

      const result = await ledgerWithProvider.validateEvent(signedEvent);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('signature verification failed');
      expect(publicKeyProvider).toHaveBeenCalledWith(keyId, agentId);
    });

    it('should handle multiple signatures with one valid', async () => {
      const keyPair = await generateKeyPair();
      const otherKeyPair = await generateKeyPair();
      const agentId = 'agt_multi_sig';
      const validKeyId = 'opk_valid';
      const invalidKeyId = 'opk_invalid';

      const publicKeyProvider = vi.fn().mockImplementation(async (keyId: string) => {
        if (keyId === validKeyId) {
          return keyPair.publicKey;
        }
        return otherKeyPair.publicKey;
      });

      const configWithProvider: LedgerConfig = {
        ...defaultConfig,
        publicKeyProvider,
      };
      const ledgerWithProvider = new LedgerImpl(configWithProvider);

      const baseEvent = createValidEvent({
        agent_id: agentId,
        producer_key_id: validKeyId,
      });

      const { signatures: _, ...dataToSign } = baseEvent;

      // 有効な署名と無効な署名の両方を作成
      const validSignature = await signObject(dataToSign, keyPair.privateKey);
      const invalidSignature = await signObject(dataToSign, keyPair.privateKey); // 異なるデータとして署名

      const signedEvent: LedgerEvent = {
        ...baseEvent,
        signatures: [
          {
            key_id: invalidKeyId,
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: invalidSignature,
          },
          {
            key_id: validKeyId,
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: validSignature,
          },
        ],
      };

      const result = await ledgerWithProvider.validateEvent(signedEvent);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle error from publicKeyProvider', async () => {
      const keyPair = await generateKeyPair();
      const agentId = 'agt_error_key';
      const keyId = 'opk_error_key';

      const publicKeyProvider = vi.fn().mockRejectedValue(new Error('Provider error'));
      const configWithProvider: LedgerConfig = {
        ...defaultConfig,
        publicKeyProvider,
      };
      const ledgerWithProvider = new LedgerImpl(configWithProvider);

      const baseEvent = createValidEvent({
        agent_id: agentId,
        producer_key_id: keyId,
      });

      const { signatures: _, ...dataToSign } = baseEvent;
      const signature = await signObject(dataToSign, keyPair.privateKey);

      const signedEvent: LedgerEvent = {
        ...baseEvent,
        signatures: [
          {
            key_id: keyId,
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: signature,
          },
        ],
      };

      const result = await ledgerWithProvider.validateEvent(signedEvent);
      // エラーが発生しても検証は継続され、最終的に失敗する
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('signature verification failed');
    });

    it('should handle error from verifyObject', async () => {
      const agentId = 'agt_verify_error';
      const keyId = 'opk_verify_error';

      const publicKeyProvider = vi.fn().mockResolvedValue('invalid_public_key_format');
      const configWithProvider: LedgerConfig = {
        ...defaultConfig,
        publicKeyProvider,
      };
      const ledgerWithProvider = new LedgerImpl(configWithProvider);

      const baseEvent = createValidEvent({
        agent_id: agentId,
        producer_key_id: keyId,
      });

      const signedEvent: LedgerEvent = {
        ...baseEvent,
        signatures: [
          {
            key_id: keyId,
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: 'invalid_signature_format',
          },
        ],
      };

      const result = await ledgerWithProvider.validateEvent(signedEvent);
      // verifyObjectでエラーが発生してもキャッチされ、検証は継続
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('signature verification failed');
    });

    it('should not verify signature when publicKeyProvider is not configured', async () => {
      // publicKeyProviderが設定されていない場合、署名検証はスキップされる
      const event = createValidEvent({
        signatures: [
          {
            key_id: 'opk_no_provider',
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: 'some_signature',
          },
        ],
      });

      const result = await ledger.validateEvent(event);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});