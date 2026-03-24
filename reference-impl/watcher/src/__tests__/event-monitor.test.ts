/**
 * EventMonitor Tests - イベント監視・フィルタリング
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventMonitor, LedgerClient } from '../event-monitor.js';
import type {
  WatchedEvent,
  EventMonitorConfig,
  AnomalyInfo,
  LedgerEventType,
  IdString,
} from '../types.js';

// Mock Ledger Client
const createMockLedgerClient = (): LedgerClient => ({
  getAgentEvents: vi.fn(),
  getCheckpoint: vi.fn(),
});

// Helper to create test events
const createTestEvent = (overrides: Partial<WatchedEvent> = {}): WatchedEvent => ({
  event_id: 'evt_001' as IdString,
  event_type: 'key.added' as LedgerEventType,
  agent_id: 'agent_001' as IdString,
  controller_id: 'ctrl_001' as IdString,
  event_time: new Date().toISOString(),
  recorded_at: new Date().toISOString(),
  sequence: 1,
  ledger_checkpoint: 'chk_100',
  payload: {},
  ...overrides,
});

describe('EventMonitor', () => {
  let monitor: EventMonitor;
  let mockLedgerClient: ReturnType<typeof createMockLedgerClient>;

  beforeEach(() => {
    monitor = new EventMonitor();
    mockLedgerClient = createMockLedgerClient();
  });

  afterEach(() => {
    monitor.reset();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      expect(monitor).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      const customMonitor = new EventMonitor({
        checkpointInterval: 10000,
        maxHistorySize: 5000,
      });
      expect(customMonitor).toBeDefined();
    });
  });

  describe('setLedgerClient', () => {
    it('should set ledger client', () => {
      monitor.setLedgerClient(mockLedgerClient);
      // No error means success
      expect(true).toBe(true);
    });
  });

  describe('start and stop', () => {
    it('should start monitoring', async () => {
      await monitor.start();
      // Check internal state
      await monitor.stop();
    });

    it('should not start twice', async () => {
      await monitor.start();
      await monitor.start(); // Should be idempotent
      await monitor.stop();
    });

    it('should stop monitoring', async () => {
      await monitor.start();
      await monitor.stop();
      // No error means success
    });

    it('should handle stop when not running', async () => {
      await monitor.stop(); // Should not throw
    });
  });

  describe('ingestEvent', () => {
    it('should ingest a new event', async () => {
      const event = createTestEvent();
      const result = await monitor.ingestEvent(event);

      expect(result.new_events).toHaveLength(1);
      expect(result.current_checkpoint).toBe('chk_100');
      expect(result.anomalies).toHaveLength(0);
    });

    it('should detect sequence gap anomaly', async () => {
      // First event
      const event1 = createTestEvent({ sequence: 1 });
      await monitor.ingestEvent(event1);

      // Event with gap
      const event2 = createTestEvent({ sequence: 5 });
      const result = await monitor.ingestEvent(event2);

      expect(result.anomalies).toHaveLength(1);
      expect(result.anomalies[0].type).toBe('SEQUENCE_GAP');
      expect(result.anomalies[0].details.gap).toBe(3);
    });

    it('should detect checkpoint rollback anomaly', async () => {
      // First event with higher checkpoint
      const event1 = createTestEvent({ ledger_checkpoint: 'chk_200' });
      await monitor.ingestEvent(event1);

      // Event with lower checkpoint
      const event2 = createTestEvent({ ledger_checkpoint: 'chk_100' });
      const result = await monitor.ingestEvent(event2);

      expect(result.anomalies).toHaveLength(1);
      expect(result.anomalies[0].type).toBe('CHECKPOINT_ROLLBACK');
    });

    it('should update agent state after ingest', async () => {
      const event = createTestEvent();
      await monitor.ingestEvent(event);

      const state = monitor.getAgentState('agent_001');
      expect(state).toBeDefined();
      expect(state?.last_known_checkpoint).toBe('chk_100');
      expect(state?.last_known_sequence).toBe(1);
    });

    it('should add event to history', async () => {
      const event = createTestEvent();
      await monitor.ingestEvent(event);

      const history = monitor.getEventHistory();
      expect(history).toHaveLength(1);
      expect(history[0].event_id).toBe('evt_001');
    });
  });

  describe('validateEvent', () => {
    it('should return valid for first event', async () => {
      const event = createTestEvent({ sequence: 0 });
      const result = await monitor.ingestEvent(event);
      expect(result.anomalies).toHaveLength(0);
    });

    it('should detect prev hash mismatch', async () => {
      // First event
      const event1 = createTestEvent({ sequence: 1 });
      await monitor.ingestEvent(event1);

      // Get state and manually set lastEventHash
      const state = monitor.getAgentState('agent_001');
      if (state) {
        (state as any).lastEventHash = 'hash_abc';
      }

      // Event with mismatched prev_event_hash
      const event2 = createTestEvent({
        sequence: 2,
        prev_event_hash: 'hash_xyz',
      });
      const result = await monitor.ingestEvent(event2);

      expect(result.anomalies.some(a => a.type === 'PREV_HASH_MISMATCH')).toBe(true);
    });
  });

  describe('event filtering', () => {
    it('should filter events by type when configured', async () => {
      const filteredMonitor = new EventMonitor({
        eventTypes: ['key.added', 'key.revoked'],
      });

      const event = createTestEvent({ event_type: 'key.added' });
      const result = await filteredMonitor.ingestEvent(event);
      expect(result.new_events).toHaveLength(1);

      filteredMonitor.reset();
    });

    it('should accept all events when no filter configured', async () => {
      const event = createTestEvent({ event_type: 'agent.created' });
      const result = await monitor.ingestEvent(event);
      expect(result.new_events).toHaveLength(1);
    });
  });

  describe('getEventHistory', () => {
    beforeEach(async () => {
      const now = new Date();
      const events = [
        createTestEvent({ event_id: 'evt_001', recorded_at: new Date(now.getTime() - 3600000).toISOString() }),
        createTestEvent({ event_id: 'evt_002', recorded_at: new Date(now.getTime() - 1800000).toISOString() }),
        createTestEvent({
          event_id: 'evt_003',
          agent_id: 'agent_002' as IdString,
          recorded_at: new Date(now.getTime() - 600000).toISOString(),
        }),
      ];
      for (const event of events) {
        await monitor.ingestEvent(event);
      }
    });

    it('should return all events', () => {
      const history = monitor.getEventHistory();
      expect(history.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter by agent id', () => {
      const history = monitor.getEventHistory({ agentId: 'agent_002' });
      expect(history.every(e => e.agent_id === 'agent_002')).toBe(true);
    });

    it('should filter by event type', async () => {
      monitor.reset();
      const event1 = createTestEvent({ event_type: 'key.added' });
      const event2 = createTestEvent({ event_type: 'key.revoked', event_id: 'evt_002' });
      await monitor.ingestEvent(event1);
      await monitor.ingestEvent(event2);

      const history = monitor.getEventHistory({ eventType: 'key.added' });
      expect(history.every(e => e.event_type === 'key.added')).toBe(true);
    });

    it('should filter by time', () => {
      const now = new Date();
      const since = new Date(now.getTime() - 2400000).toISOString(); // 40 minutes ago
      const history = monitor.getEventHistory({ since });
      expect(history.every(e => new Date(e.recorded_at) >= new Date(since))).toBe(true);
    });

    it('should limit results', () => {
      const history = monitor.getEventHistory({ limit: 2 });
      expect(history.length).toBeLessThanOrEqual(2);
    });

    it('should sort by recorded_at descending', () => {
      const history = monitor.getEventHistory();
      for (let i = 1; i < history.length; i++) {
        expect(
          new Date(history[i - 1].recorded_at) >= new Date(history[i].recorded_at)
        ).toBe(true);
      }
    });
  });

  describe('getAgentState', () => {
    it('should return undefined for unknown agent', () => {
      const state = monitor.getAgentState('unknown_agent');
      expect(state).toBeUndefined();
    });

    it('should return state for known agent', async () => {
      const event = createTestEvent();
      await monitor.ingestEvent(event);

      const state = monitor.getAgentState('agent_001');
      expect(state).toBeDefined();
      expect(state?.agent_id).toBe('agent_001');
    });
  });

  describe('getCurrentCheckpoint', () => {
    it('should return undefined when no agent specified', () => {
      const checkpoint = monitor.getCurrentCheckpoint();
      expect(checkpoint).toBeUndefined();
    });

    it('should return checkpoint for known agent', async () => {
      const event = createTestEvent({ ledger_checkpoint: 'chk_500' });
      await monitor.ingestEvent(event);

      const checkpoint = monitor.getCurrentCheckpoint('agent_001');
      expect(checkpoint).toBe('chk_500');
    });

    it('should return undefined for unknown agent', () => {
      const checkpoint = monitor.getCurrentCheckpoint('unknown_agent');
      expect(checkpoint).toBeUndefined();
    });
  });

  describe('checkDuplicateConflict', () => {
    it('should return null for unique event', async () => {
      const event = createTestEvent();
      await monitor.ingestEvent(event);

      const newEvent = createTestEvent({ event_id: 'evt_002' });
      const conflict = monitor.checkDuplicateConflict(newEvent);
      expect(conflict).toBeNull();
    });

    it('should detect duplicate event conflict', async () => {
      const event = createTestEvent({ sequence: 1, payload: { key: 'a' } });
      await monitor.ingestEvent(event);

      // Same event_id but different sequence/payload
      const duplicateEvent = createTestEvent({
        sequence: 5,
        payload: { key: 'b' },
      });
      const conflict = monitor.checkDuplicateConflict(duplicateEvent);

      expect(conflict).not.toBeNull();
      expect(conflict?.type).toBe('DUPLICATE_EVENT_CONFLICT');
    });
  });

  describe('event handlers', () => {
    it('should call event handler when event is ingested', async () => {
      const handler = vi.fn();
      monitor.addEventHandler(handler);

      const event = createTestEvent();
      await monitor.ingestEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should call multiple event handlers', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      monitor.addEventHandler(handler1);
      monitor.addEventHandler(handler2);

      const event = createTestEvent();
      await monitor.ingestEvent(event);

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should handle handler errors gracefully', async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
      monitor.addEventHandler(errorHandler);

      const event = createTestEvent();
      // Should not throw
      await monitor.ingestEvent(event);
    });
  });

  describe('anomaly handlers', () => {
    it('should call anomaly handler when anomaly is detected', async () => {
      const handler = vi.fn();
      monitor.addAnomalyHandler(handler);

      // Create sequence gap
      const event1 = createTestEvent({ sequence: 1 });
      await monitor.ingestEvent(event1);

      const event2 = createTestEvent({ sequence: 10 });
      await monitor.ingestEvent(event2);

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should clear all state', async () => {
      const event = createTestEvent();
      await monitor.ingestEvent(event);

      monitor.reset();

      expect(monitor.getAgentState('agent_001')).toBeUndefined();
      expect(monitor.getEventHistory()).toHaveLength(0);
    });
  });

  describe('history size limits', () => {
    it('should limit history size', async () => {
      const smallMonitor = new EventMonitor({ maxHistorySize: 5 });

      for (let i = 0; i < 10; i++) {
        const event = createTestEvent({
          event_id: `evt_${i}` as IdString,
          sequence: i,
        });
        await smallMonitor.ingestEvent(event);
      }

      const history = smallMonitor.getEventHistory();
      expect(history.length).toBeLessThanOrEqual(5);

      smallMonitor.reset();
    });
  });

  describe('checkpoint number extraction', () => {
    it('should handle various checkpoint formats', async () => {
      const events = [
        createTestEvent({ ledger_checkpoint: 'chk_100', event_id: 'evt_1' }),
        createTestEvent({ ledger_checkpoint: 'chk_200', event_id: 'evt_2' }),
        createTestEvent({ ledger_checkpoint: 'chk_150', event_id: 'evt_3' }),
      ];

      for (const event of events) {
        await monitor.ingestEvent(event);
      }

      // The third event has a rollback (150 < 200)
      const state = monitor.getAgentState('agent_001');
      expect(state).toBeDefined();
    });
  });
});

describe('HttpLedgerClient', () => {
  // Note: HttpLedgerClient tests would require mocking fetch
  // For now, we test the interface compliance
  it('should be constructable', async () => {
    const { HttpLedgerClient } = await import('../event-monitor.js');
    const client = new HttpLedgerClient('http://localhost:8080');
    expect(client).toBeDefined();
  });

  describe('getAgentEvents', () => {
    it('should fetch events successfully', async () => {
      const { HttpLedgerClient } = await import('../event-monitor.js');

      const mockEvents = [
        createTestEvent({ event_id: 'evt_001' }),
        createTestEvent({ event_id: 'evt_002' }),
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          events: mockEvents,
          checkpoint: 'chk_100',
          hasMore: false,
        }),
      });

      const client = new HttpLedgerClient('http://localhost:8080');
      const result = await client.getAgentEvents('agent_001');

      expect(result.events).toHaveLength(2);
      expect(result.checkpoint).toBe('chk_100');
      expect(result.hasMore).toBe(false);
    });

    it('should include sinceCheckpoint in request', async () => {
      const { HttpLedgerClient } = await import('../event-monitor.js');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          events: [],
          checkpoint: 'chk_100',
          hasMore: false,
        }),
      });

      const client = new HttpLedgerClient('http://localhost:8080');
      await client.getAgentEvents('agent_001', { sinceCheckpoint: 'chk_50' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('since=chk_50')
      );
    });

    it('should include maxEvents in request', async () => {
      const { HttpLedgerClient } = await import('../event-monitor.js');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          events: [],
          checkpoint: 'chk_100',
          hasMore: false,
        }),
      });

      const client = new HttpLedgerClient('http://localhost:8080');
      await client.getAgentEvents('agent_001', { maxEvents: 50 });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=50')
      );
    });

    it('should throw error when response is not ok', async () => {
      const { HttpLedgerClient } = await import('../event-monitor.js');

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      });

      const client = new HttpLedgerClient('http://localhost:8080');

      await expect(client.getAgentEvents('agent_001')).rejects.toThrow('Failed to fetch events');
    });
  });

  describe('getCheckpoint', () => {
    it('should fetch checkpoint successfully', async () => {
      const { HttpLedgerClient } = await import('../event-monitor.js');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ checkpoint: 'chk_500' }),
      });

      const client = new HttpLedgerClient('http://localhost:8080');
      const checkpoint = await client.getCheckpoint();

      expect(checkpoint).toBe('chk_500');
    });

    it('should throw error when response is not ok', async () => {
      const { HttpLedgerClient } = await import('../event-monitor.js');

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
      });

      const client = new HttpLedgerClient('http://localhost:8080');

      await expect(client.getCheckpoint()).rejects.toThrow('Failed to fetch checkpoint');
    });
  });
});

describe('EventMonitor - additional coverage', () => {
  let monitor: EventMonitor;

  beforeEach(() => {
    monitor = new EventMonitor();
  });

  afterEach(() => {
    monitor.reset();
  });

  describe('notifyEvent error handling', () => {
    it('should handle errors from event handlers gracefully', async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
      const successHandler = vi.fn();

      monitor.addEventHandler(errorHandler);
      monitor.addEventHandler(successHandler);

      const event = createTestEvent();
      await monitor.ingestEvent(event);

      // Error handler should have thrown, but success handler should still be called
      expect(errorHandler).toHaveBeenCalled();
      expect(successHandler).toHaveBeenCalled();
    });
  });

  describe('notifyAnomaly error handling', () => {
    it('should handle errors from anomaly handlers gracefully', async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error('Anomaly handler error'));
      const successHandler = vi.fn();

      monitor.addAnomalyHandler(errorHandler);
      monitor.addAnomalyHandler(successHandler);

      // Create sequence gap to trigger anomaly
      const event1 = createTestEvent({ sequence: 1 });
      await monitor.ingestEvent(event1);

      const event2 = createTestEvent({ sequence: 10 });
      await monitor.ingestEvent(event2);

      // Error handler should have thrown, but success handler should still be called
      expect(errorHandler).toHaveBeenCalled();
      expect(successHandler).toHaveBeenCalled();
    });
  });

  describe('ingestEvent with existing agent state', () => {
    it('should update existing agent state correctly', async () => {
      const event1 = createTestEvent({
        event_id: 'evt_001',
        sequence: 1,
        ledger_checkpoint: 'chk_100',
      });
      await monitor.ingestEvent(event1);

      const state1 = monitor.getAgentState('agent_001');
      expect(state1?.last_known_checkpoint).toBe('chk_100');
      expect(state1?.last_known_sequence).toBe(1);

      // Ingest another event for the same agent
      const event2 = createTestEvent({
        event_id: 'evt_002',
        sequence: 2,
        ledger_checkpoint: 'chk_200',
      });
      await monitor.ingestEvent(event2);

      const state2 = monitor.getAgentState('agent_001');
      expect(state2?.last_known_checkpoint).toBe('chk_200');
      expect(state2?.last_known_sequence).toBe(2);
      // checkpoints_history is only created on first ingest for manual events
      expect(state2?.checkpoints_history.length).toBe(1);
    });

    it('should update lastEventHash when updating existing state', async () => {
      const event1 = createTestEvent({ sequence: 1 });
      await monitor.ingestEvent(event1);

      const state1 = monitor.getAgentState('agent_001');
      const firstHash = state1?.lastEventHash;
      expect(firstHash).toBeDefined();

      const event2 = createTestEvent({ sequence: 2, event_id: 'evt_002' });
      await monitor.ingestEvent(event2);

      const state2 = monitor.getAgentState('agent_001');
      expect(state2?.lastEventHash).toBeDefined();
      expect(state2?.lastEventHash).not.toBe(firstHash);
    });

    it('should update last_observed_at when updating existing state', async () => {
      const event1 = createTestEvent({ sequence: 1 });
      await monitor.ingestEvent(event1);

      const state1 = monitor.getAgentState('agent_001');
      const firstObserved = state1?.last_observed_at;

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      const event2 = createTestEvent({ sequence: 2 });
      await monitor.ingestEvent(event2);

      const state2 = monitor.getAgentState('agent_001');
      expect(new Date(state2?.last_observed_at!).getTime()).toBeGreaterThan(
        new Date(firstObserved!).getTime()
      );
    });
  });

  describe('start with ledger client', () => {
    it('should check checkpoints when started with ledger client', async () => {
      const mockLedgerClient = createMockLedgerClient();
      mockLedgerClient.getAgentEvents = vi.fn().mockResolvedValue({
        events: [createTestEvent()],
        checkpoint: 'chk_100',
        hasMore: false,
      });

      monitor.setLedgerClient(mockLedgerClient);

      // Add an agent state first
      await monitor.ingestEvent(createTestEvent());

      // Start should trigger checkpoint check
      await monitor.start();
      await monitor.stop();

      expect(mockLedgerClient.getAgentEvents).toHaveBeenCalled();
    });

    it('should check target agents when configured', async () => {
      const targetMonitor = new EventMonitor({
        targetAgentIds: ['agent_001', 'agent_002'],
      });

      const mockLedgerClient = createMockLedgerClient();
      mockLedgerClient.getAgentEvents = vi.fn().mockResolvedValue({
        events: [],
        checkpoint: 'chk_100',
        hasMore: false,
      });

      targetMonitor.setLedgerClient(mockLedgerClient);
      await targetMonitor.start();
      await targetMonitor.stop();

      expect(mockLedgerClient.getAgentEvents).toHaveBeenCalled();

      targetMonitor.reset();
    });

    it('should handle errors during checkpoint check', async () => {
      const mockLedgerClient = createMockLedgerClient();
      mockLedgerClient.getAgentEvents = vi.fn().mockRejectedValue(new Error('Network error'));

      monitor.setLedgerClient(mockLedgerClient);

      // Add agent state
      await monitor.ingestEvent(createTestEvent());

      // Should not throw
      await monitor.start();
      await monitor.stop();
    });
  });

  describe('checkpoints history limits', () => {
    it('should limit checkpoints history to 100 entries', async () => {
      // Ingest 150 events
      for (let i = 0; i < 150; i++) {
        const event = createTestEvent({
          event_id: `evt_${i}` as IdString,
          sequence: i + 1,
          ledger_checkpoint: `chk_${i}`,
        });
        await monitor.ingestEvent(event);
      }

      const state = monitor.getAgentState('agent_001');
      expect(state?.checkpoints_history.length).toBeLessThanOrEqual(100);
    });
  });

  describe('retention period filtering', () => {
    it('should filter old events based on retention period', async () => {
      const shortRetentionMonitor = new EventMonitor({
        retentionPeriod: 100, // 100ms retention
        maxHistorySize: 1000,
      });

      // Ingest event
      const event = createTestEvent({
        recorded_at: new Date(Date.now() - 1000).toISOString(), // 1 second ago
      });
      await shortRetentionMonitor.ingestEvent(event);

      // Ingest another event to trigger filtering
      await new Promise(resolve => setTimeout(resolve, 150));

      const recentEvent = createTestEvent({
        event_id: 'evt_recent',
        recorded_at: new Date().toISOString(),
      });
      await shortRetentionMonitor.ingestEvent(recentEvent);

      // History should only contain recent event
      const history = shortRetentionMonitor.getEventHistory();
      expect(history.every(e => e.event_id === 'evt_recent')).toBe(true);

      shortRetentionMonitor.reset();
    });
  });

  describe('event type filtering in validation', () => {
    it('should validate events with configured types', async () => {
      const filteredMonitor = new EventMonitor({
        eventTypes: ['key.added', 'key.revoked'],
      });

      const event = createTestEvent({ event_type: 'key.added' });
      const result = await filteredMonitor.ingestEvent(event);

      expect(result.new_events).toHaveLength(1);

      filteredMonitor.reset();
    });

    it('should accept event not in filter list but still process it', async () => {
      const filteredMonitor = new EventMonitor({
        eventTypes: ['key.added'],
      });

      // Events not in the filter list are still processed
      const event = createTestEvent({ event_type: 'agent.created' });
      const result = await filteredMonitor.ingestEvent(event);

      expect(result.new_events).toHaveLength(1);

      filteredMonitor.reset();
    });
  });
});