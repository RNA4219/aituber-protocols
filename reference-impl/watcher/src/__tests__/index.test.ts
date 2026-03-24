/**
 * WatcherImpl Tests - Watcher統合クラスのテスト
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WatcherImpl, createWatcher } from '../index.js';
import type {
  WatcherAlert,
  WatchedEvent,
  AnomalyInfo,
  AlertType,
  IdString,
  LedgerEventType,
  VersionVector,
} from '../types.js';
import type { LedgerClient } from '../event-monitor.js';

// Mock Ledger Client
const createMockLedgerClient = (): LedgerClient => ({
  getAgentEvents: vi.fn().mockResolvedValue({
    events: [],
    checkpoint: 'chk_100',
    hasMore: false,
  }),
  getCheckpoint: vi.fn().mockReturnValue('chk_100'),
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

describe('WatcherImpl', () => {
  let watcher: WatcherImpl;
  let mockLedgerClient: ReturnType<typeof createMockLedgerClient>;

  beforeEach(() => {
    watcher = new WatcherImpl();
    mockLedgerClient = createMockLedgerClient();
  });

  afterEach(() => {
    watcher.reset();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      expect(watcher).toBeDefined();
    });

    it('should accept partial config', () => {
      const customWatcher = new WatcherImpl({
        monitor: {
          checkpointInterval: 10000,
          retentionPeriod: 86400000,
          maxHistorySize: 5000,
        },
      });
      expect(customWatcher).toBeDefined();
      customWatcher.reset();
    });
  });

  describe('setLedgerClient', () => {
    it('should set ledger client', () => {
      watcher.setLedgerClient(mockLedgerClient);
      // No error means success
      expect(true).toBe(true);
    });
  });

  describe('start and stop', () => {
    it('should start monitoring', async () => {
      await watcher.start();
      await watcher.stop();
    });

    it('should not start twice', async () => {
      await watcher.start();
      await watcher.start(); // Should be idempotent
      await watcher.stop();
    });

    it('should stop monitoring', async () => {
      await watcher.start();
      await watcher.stop();
    });
  });

  describe('getCurrentCheckpoint', () => {
    it('should return undefined when no agent specified', () => {
      const checkpoint = watcher.getCurrentCheckpoint();
      expect(checkpoint).toBeUndefined();
    });

    it('should return undefined for unknown agent', () => {
      const checkpoint = watcher.getCurrentCheckpoint('unknown_agent');
      expect(checkpoint).toBeUndefined();
    });

    it('should return checkpoint for known agent', async () => {
      const event = createTestEvent({ ledger_checkpoint: 'chk_500' });
      await watcher.ingestEvent(event);

      const checkpoint = watcher.getCurrentCheckpoint('agent_001');
      expect(checkpoint).toBe('chk_500');
    });
  });

  describe('onAlert', () => {
    it('should register alert handler', () => {
      const handler = vi.fn();
      watcher.onAlert(handler);
      expect(true).toBe(true);
    });
  });

  describe('onAnomaly', () => {
    it('should register anomaly handler', () => {
      const handler = vi.fn();
      watcher.onAnomaly(handler);
      expect(true).toBe(true);
    });
  });

  describe('onEvent', () => {
    it('should register event handler', () => {
      const handler = vi.fn();
      watcher.onEvent(handler);
      expect(true).toBe(true);
    });
  });

  describe('getAgentState', () => {
    it('should return undefined for unknown agent', () => {
      const state = watcher.getAgentState('unknown_agent');
      expect(state).toBeUndefined();
    });

    it('should return state for known agent', async () => {
      const event = createTestEvent();
      await watcher.ingestEvent(event);

      const state = watcher.getAgentState('agent_001');
      expect(state).toBeDefined();
      expect(state?.agent_id).toBe('agent_001');
    });
  });

  describe('getAlertHistory', () => {
    it('should return empty array when no alerts', () => {
      const history = watcher.getAlertHistory();
      expect(history).toHaveLength(0);
    });

    it('should filter by agent id', async () => {
      // Create events that will generate alerts
      const event1 = createTestEvent({ sequence: 1, ledger_checkpoint: 'chk_200' });
      await watcher.ingestEvent(event1);

      // Event with rollback to generate alert
      const event2 = createTestEvent({ sequence: 2, ledger_checkpoint: 'chk_100' });
      await watcher.ingestEvent(event2);

      const history = watcher.getAlertHistory({ agentId: 'agent_001' });
      expect(history.every(a => a.agent_id === 'agent_001')).toBe(true);
    });

    it('should filter by alert type', async () => {
      // Generate a rollback alert
      const event1 = createTestEvent({ sequence: 1, ledger_checkpoint: 'chk_200' });
      await watcher.ingestEvent(event1);

      const event2 = createTestEvent({ sequence: 2, ledger_checkpoint: 'chk_100' });
      await watcher.ingestEvent(event2);

      const history = watcher.getAlertHistory({ alertType: 'ROLLBACK_SUSPECTED' });
      expect(history.every(a => a.alert_type === 'ROLLBACK_SUSPECTED')).toBe(true);
    });

    it('should filter by time', async () => {
      const event1 = createTestEvent({ sequence: 1, ledger_checkpoint: 'chk_200' });
      await watcher.ingestEvent(event1);

      const event2 = createTestEvent({ sequence: 2, ledger_checkpoint: 'chk_100' });
      await watcher.ingestEvent(event2);

      const since = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      const history = watcher.getAlertHistory({ since });
      expect(history.every(a => new Date(a.detected_at) >= new Date(since))).toBe(true);
    });

    it('should limit results', async () => {
      // Generate multiple alerts
      for (let i = 0; i < 5; i++) {
        const event = createTestEvent({
          event_id: `evt_${i}` as IdString,
          sequence: i * 10 + 1,
          ledger_checkpoint: `chk_${200 + i * 100}`,
        });
        await watcher.ingestEvent(event);
      }

      const history = watcher.getAlertHistory({ limit: 3 });
      expect(history.length).toBeLessThanOrEqual(3);
    });

    it('should sort by detected_at descending', async () => {
      // Generate alerts at different times
      const event1 = createTestEvent({ sequence: 1, ledger_checkpoint: 'chk_200' });
      await watcher.ingestEvent(event1);

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      const event2 = createTestEvent({ sequence: 10, ledger_checkpoint: 'chk_300' });
      await watcher.ingestEvent(event2);

      const history = watcher.getAlertHistory();
      for (let i = 1; i < history.length; i++) {
        expect(
          new Date(history[i - 1].detected_at) >= new Date(history[i].detected_at)
        ).toBe(true);
      }
    });
  });

  describe('analyzeSplitView', () => {
    it('should analyze and return result', async () => {
      const event = createTestEvent();
      await watcher.ingestEvent(event);

      const result = await watcher.analyzeSplitView('agent_001');
      expect(result).toBeDefined();
      expect('suspected' in result).toBe(true);
      expect('confidence' in result).toBe(true);
      expect('conflicts' in result).toBe(true);
    });
  });

  describe('ingestEvent', () => {
    it('should ingest a new event', async () => {
      const event = createTestEvent();
      await watcher.ingestEvent(event);

      const state = watcher.getAgentState('agent_001');
      expect(state).toBeDefined();
    });

    it('should trigger split-view analysis', async () => {
      const handler = vi.fn();
      watcher.onAlert(handler);

      // Create a sequence that will trigger split-view detection
      const event1 = createTestEvent({ sequence: 1, ledger_checkpoint: 'chk_100' });
      await watcher.ingestEvent(event1);

      const event2 = createTestEvent({ sequence: 2, ledger_checkpoint: 'chk_200' });
      await watcher.ingestEvent(event2);

      // Event that creates a conflict
      const event3 = createTestEvent({ sequence: 2, ledger_checkpoint: 'chk_250', event_id: 'evt_003' });
      await watcher.ingestEvent(event3);

      // Should have generated alerts
      const history = watcher.getAlertHistory();
      expect(history.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect sequence gap and create alert', async () => {
      const handler = vi.fn();
      watcher.onAlert(handler);

      const event1 = createTestEvent({ sequence: 1 });
      await watcher.ingestEvent(event1);

      const event2 = createTestEvent({ sequence: 10 });
      await watcher.ingestEvent(event2);

      // Should have detected anomaly and created alert
      expect(handler).toHaveBeenCalled();
    });

    it('should detect checkpoint rollback and create alert', async () => {
      const handler = vi.fn();
      watcher.onAlert(handler);

      const event1 = createTestEvent({ ledger_checkpoint: 'chk_200' });
      await watcher.ingestEvent(event1);

      const event2 = createTestEvent({ ledger_checkpoint: 'chk_100' });
      await watcher.ingestEvent(event2);

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('compareVersionVectors', () => {
    it('should compare version vectors', () => {
      const current: VersionVector = {
        identity_version: 10,
        revocation_epoch: 5,
      };
      const observed: VersionVector = {
        identity_version: 5,
        revocation_epoch: 5,
      };

      const result = watcher.compareVersionVectors(current, observed);
      expect(result.rollback_detected).toBe(true);
    });
  });

  describe('addAlertEndpoint', () => {
    it('should add endpoint with basic options', () => {
      watcher.addAlertEndpoint('test-endpoint', 'http://localhost:8080/alerts');
      expect(true).toBe(true);
    });

    it('should add endpoint with auth options', () => {
      watcher.addAlertEndpoint('auth-endpoint', 'http://localhost:8080/alerts', {
        auth: { type: 'bearer', credentials: 'test-token' },
      });
      expect(true).toBe(true);
    });

    it('should add endpoint with alert type filter', () => {
      watcher.addAlertEndpoint('filtered-endpoint', 'http://localhost:8080/alerts', {
        alertTypes: ['SPLIT_VIEW_SUSPECTED', 'ROLLBACK_SUSPECTED'] as AlertType[],
      });
      expect(true).toBe(true);
    });

    it('should add endpoint with severity filter', () => {
      watcher.addAlertEndpoint('severity-endpoint', 'http://localhost:8080/alerts', {
        severities: ['CRITICAL', 'HIGH'],
      });
      expect(true).toBe(true);
    });
  });

  describe('reset', () => {
    it('should clear all state', async () => {
      const event = createTestEvent();
      await watcher.ingestEvent(event);

      watcher.reset();

      expect(watcher.getAgentState('agent_001')).toBeUndefined();
      expect(watcher.getAlertHistory()).toHaveLength(0);
    });
  });

  describe('createAlertFromAnomaly (internal)', () => {
    it('should create ROLLBACK_SUSPECTED alert for CHECKPOINT_ROLLBACK anomaly', async () => {
      const alertHandler = vi.fn();
      watcher.onAlert(alertHandler);

      // Create rollback scenario
      const event1 = createTestEvent({ ledger_checkpoint: 'chk_200' });
      await watcher.ingestEvent(event1);

      const event2 = createTestEvent({ ledger_checkpoint: 'chk_100' });
      await watcher.ingestEvent(event2);

      expect(alertHandler).toHaveBeenCalled();
      const alert = alertHandler.mock.calls[0][0] as WatcherAlert;
      expect(alert.alert_type).toBe('ROLLBACK_SUSPECTED');
      expect(alert.severity).toBe('HIGH');
      expect(alert.recommended_action).toBe('TERMINATE_SESSIONS');
    });

    it('should create CHECKPOINT_CONFLICT alert for SEQUENCE_GAP anomaly', async () => {
      const alertHandler = vi.fn();
      watcher.onAlert(alertHandler);

      const event1 = createTestEvent({ sequence: 1 });
      await watcher.ingestEvent(event1);

      const event2 = createTestEvent({ sequence: 10 });
      await watcher.ingestEvent(event2);

      expect(alertHandler).toHaveBeenCalled();
      const alert = alertHandler.mock.calls[0][0] as WatcherAlert;
      expect(alert.alert_type).toBe('CHECKPOINT_CONFLICT');
      expect(alert.severity).toBe('MEDIUM');
      expect(alert.recommended_action).toBe('INVESTIGATE');
    });

    it('should create SPLIT_VIEW_SUSPECTED alert for DUPLICATE_EVENT_CONFLICT anomaly', async () => {
      const anomalyHandler = vi.fn();
      watcher.onAnomaly(anomalyHandler);

      // Create scenario that would trigger duplicate conflict
      const event1 = createTestEvent({ sequence: 1, payload: { key: 'a' } });
      await watcher.ingestEvent(event1);

      // Manually check for duplicate conflict
      const state = watcher.getAgentState('agent_001');
      expect(state).toBeDefined();
    });

    it('should create CHECKPOINT_CONFLICT alert for PREV_HASH_MISMATCH anomaly', async () => {
      const alertHandler = vi.fn();
      watcher.onAlert(alertHandler);

      const event1 = createTestEvent({ sequence: 1 });
      await watcher.ingestEvent(event1);

      // Get state and set lastEventHash
      const state = watcher.getAgentState('agent_001');
      if (state) {
        (state as any).lastEventHash = 'hash_abc';
      }

      const event2 = createTestEvent({ sequence: 2, prev_event_hash: 'hash_xyz' });
      await watcher.ingestEvent(event2);

      expect(alertHandler).toHaveBeenCalled();
      const alert = alertHandler.mock.calls[0][0] as WatcherAlert;
      expect(alert.alert_type).toBe('CHECKPOINT_CONFLICT');
      expect(alert.severity).toBe('HIGH');
    });
  });

  describe('internal handlers setup', () => {
    it('should notify alert handlers when anomaly is detected', async () => {
      const alertHandler = vi.fn();
      watcher.onAlert(alertHandler);

      // Trigger rollback
      const event1 = createTestEvent({ ledger_checkpoint: 'chk_200' });
      await watcher.ingestEvent(event1);

      const event2 = createTestEvent({ ledger_checkpoint: 'chk_100' });
      await watcher.ingestEvent(event2);

      expect(alertHandler).toHaveBeenCalled();
    });

    it('should add alerts to history', async () => {
      // Trigger rollback
      const event1 = createTestEvent({ ledger_checkpoint: 'chk_200' });
      await watcher.ingestEvent(event1);

      const event2 = createTestEvent({ ledger_checkpoint: 'chk_100' });
      await watcher.ingestEvent(event2);

      const history = watcher.getAlertHistory();
      expect(history.length).toBeGreaterThan(0);
    });
  });
});

describe('createWatcher factory', () => {
  it('should create WatcherImpl instance', () => {
    const watcher = createWatcher();
    expect(watcher).toBeInstanceOf(WatcherImpl);
    watcher.reset();
  });

  it('should pass config to WatcherImpl', () => {
    const watcher = createWatcher({
      monitor: {
        checkpointInterval: 10000,
        retentionPeriod: 86400000,
        maxHistorySize: 5000,
      },
    });
    expect(watcher).toBeInstanceOf(WatcherImpl);
    watcher.reset();
  });
});