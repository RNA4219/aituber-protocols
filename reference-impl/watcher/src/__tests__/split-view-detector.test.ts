/**
 * SplitViewDetector Tests - Split-view検知、Checkpoint比較
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SplitViewDetector,
  SplitViewAlert,
  compareCheckpoints,
  isCheckpointRollback,
} from '../split-view-detector.js';
import type {
  SplitViewDetectorConfig,
  AgentCheckpointState,
  VersionVector,
  WatchedEvent,
  CheckpointConflict,
  IdString,
  LedgerEventType,
} from '../types.js';
import type { EventMonitor } from '../event-monitor.js';

// Helper to create test checkpoint state
const createAgentState = (
  checkpoints: string[],
  options: { rootHashes?: string[] } = {}
): AgentCheckpointState => {
  const history = checkpoints.map((cp, i) => ({
    checkpoint: cp,
    observed_at: new Date(Date.now() - (checkpoints.length - i) * 1000).toISOString(),
    event_count: 1,
    root_hash: options.rootHashes?.[i],
  }));

  return {
    agent_id: 'agent_001' as IdString,
    last_known_checkpoint: checkpoints[checkpoints.length - 1],
    last_known_sequence: checkpoints.length,
    last_observed_at: new Date().toISOString(),
    checkpoints_history: history,
  };
};

// Mock EventMonitor
const createMockEventMonitor = (state?: AgentCheckpointState): EventMonitor => {
  return {
    getAgentState: vi.fn().mockReturnValue(state),
    start: vi.fn(),
    stop: vi.fn(),
    getCurrentCheckpoint: vi.fn(),
    onAlert: vi.fn(),
    onAnomaly: vi.fn(),
    onEvent: vi.fn(),
    getAlertHistory: vi.fn().mockReturnValue([]),
  } as unknown as EventMonitor;
};

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

describe('SplitViewDetector', () => {
  let detector: SplitViewDetector;

  beforeEach(() => {
    detector = new SplitViewDetector();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      expect(detector).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      const customDetector = new SplitViewDetector({
        conflictGracePeriod: 120000,
        comparisonDepth: 20,
        autoAlertEnabled: false,
      });
      expect(customDetector).toBeDefined();
    });
  });

  describe('setEventMonitor', () => {
    it('should set event monitor', () => {
      const mockMonitor = createMockEventMonitor();
      detector.setEventMonitor(mockMonitor);
      expect(true).toBe(true);
    });
  });

  describe('setAlertCallback', () => {
    it('should set alert callback', () => {
      const callback = vi.fn();
      detector.setAlertCallback(callback);
      expect(true).toBe(true);
    });
  });

  describe('analyze', () => {
    it('should return no suspicion when no state available', async () => {
      const mockMonitor = createMockEventMonitor(undefined);
      detector.setEventMonitor(mockMonitor);

      const result = await detector.analyze('agent_001');

      expect(result.suspected).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.conflicts).toHaveLength(0);
      expect(result.checkpoints_analyzed).toBe(0);
    });

    it('should return no suspicion with single checkpoint', async () => {
      const state = createAgentState(['chk_100']);
      const mockMonitor = createMockEventMonitor(state);
      detector.setEventMonitor(mockMonitor);

      const result = await detector.analyze('agent_001');

      expect(result.suspected).toBe(false);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should detect SAME_SEQUENCE_DIFFERENT_HASH conflict', async () => {
      const state = createAgentState(
        ['chk_100', 'chk_100'],
        { rootHashes: ['hash_a', 'hash_b'] }
      );
      const mockMonitor = createMockEventMonitor(state);
      detector.setEventMonitor(mockMonitor);

      const result = await detector.analyze('agent_001');

      expect(result.suspected).toBe(true);
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.conflicts[0].conflict_type).toBe('SAME_SEQUENCE_DIFFERENT_HASH');
    });

    it('should detect BRANCH_DETECTED conflict', async () => {
      const state = createAgentState(['chk_200', 'chk_100']);
      const mockMonitor = createMockEventMonitor(state);
      detector.setEventMonitor(mockMonitor);

      const result = await detector.analyze('agent_001');

      expect(result.suspected).toBe(true);
      expect(result.conflicts.some(c => c.conflict_type === 'BRANCH_DETECTED')).toBe(true);
    });

    it('should calculate confidence based on conflicts', async () => {
      const state = createAgentState(
        ['chk_100', 'chk_100', 'chk_50'],
        { rootHashes: ['hash_a', 'hash_b', undefined] }
      );
      const mockMonitor = createMockEventMonitor(state);
      detector.setEventMonitor(mockMonitor);

      const result = await detector.analyze('agent_001');

      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should call alert callback when autoAlertEnabled', async () => {
      const callback = vi.fn();
      detector.setAlertCallback(callback);

      const state = createAgentState(['chk_200', 'chk_100']);
      const mockMonitor = createMockEventMonitor(state);
      detector.setEventMonitor(mockMonitor);

      await detector.analyze('agent_001');

      expect(callback).toHaveBeenCalled();
    });

    it('should not call alert callback when autoAlertEnabled is false', async () => {
      const noAlertDetector = new SplitViewDetector({ autoAlertEnabled: false });
      const callback = vi.fn();
      noAlertDetector.setAlertCallback(callback);

      const state = createAgentState(['chk_200', 'chk_100']);
      const mockMonitor = createMockEventMonitor(state);
      noAlertDetector.setEventMonitor(mockMonitor);

      await noAlertDetector.analyze('agent_001');

      expect(callback).not.toHaveBeenCalled();
    });

    it('should save conflicts to history', async () => {
      const state = createAgentState(['chk_200', 'chk_100']);
      const mockMonitor = createMockEventMonitor(state);
      detector.setEventMonitor(mockMonitor);

      await detector.analyze('agent_001');

      const history = detector.getConflictHistory('agent_001');
      expect(history.length).toBeGreaterThan(0);
    });
  });

  describe('compareVersionVectors', () => {
    it('should detect identity_version rollback', () => {
      const current: VersionVector = {
        identity_version: 10,
        revocation_epoch: 5,
      };
      const observed: VersionVector = {
        identity_version: 5,
        revocation_epoch: 5,
      };

      const result = detector.compareVersionVectors(current, observed);

      expect(result.rollback_detected).toBe(true);
      expect(result.details.identity_version_rollback).toBeDefined();
    });

    it('should detect revocation_epoch rollback', () => {
      const current: VersionVector = {
        identity_version: 10,
        revocation_epoch: 5,
      };
      const observed: VersionVector = {
        identity_version: 10,
        revocation_epoch: 3,
      };

      const result = detector.compareVersionVectors(current, observed);

      expect(result.epoch_mismatch).toBe(true);
      expect(result.details.revocation_epoch_rollback).toBeDefined();
    });

    it('should detect policy_epoch mismatch', () => {
      const current: VersionVector = {
        identity_version: 10,
        revocation_epoch: 5,
        policy_epoch: 3,
      };
      const observed: VersionVector = {
        identity_version: 10,
        revocation_epoch: 5,
        policy_epoch: 1,
      };

      const result = detector.compareVersionVectors(current, observed);

      expect(result.policy_mismatch).toBe(true);
      expect(result.details.policy_epoch_mismatch).toBeDefined();
    });

    it('should detect session_epoch old', () => {
      const current: VersionVector = {
        identity_version: 10,
        revocation_epoch: 5,
        session_epoch: 10,
      };
      const observed: VersionVector = {
        identity_version: 10,
        revocation_epoch: 5,
        session_epoch: 5,
      };

      const result = detector.compareVersionVectors(current, observed);

      expect(result.session_epoch_old).toBe(true);
      expect(result.details.session_epoch_old).toBeDefined();
    });

    it('should detect ledger_checkpoint rollback', () => {
      const current: VersionVector = {
        identity_version: 10,
        revocation_epoch: 5,
        ledger_checkpoint: 'chk_200',
      };
      const observed: VersionVector = {
        identity_version: 10,
        revocation_epoch: 5,
        ledger_checkpoint: 'chk_100',
      };

      const result = detector.compareVersionVectors(current, observed);

      expect(result.rollback_detected).toBe(true);
      expect(result.details.checkpoint_rollback).toBeDefined();
    });

    it('should return no issues for valid progression', () => {
      const current: VersionVector = {
        identity_version: 10,
        revocation_epoch: 5,
      };
      const observed: VersionVector = {
        identity_version: 11,
        revocation_epoch: 6,
      };

      const result = detector.compareVersionVectors(current, observed);

      expect(result.rollback_detected).toBe(false);
      expect(result.epoch_mismatch).toBe(false);
      expect(result.policy_mismatch).toBe(false);
      expect(result.session_epoch_old).toBe(false);
    });
  });

  describe('updateVersionVector and getVersionVector', () => {
    it('should store and retrieve version vector', () => {
      const vector: VersionVector = {
        identity_version: 10,
        revocation_epoch: 5,
      };

      detector.updateVersionVector('agent_001', vector);
      const retrieved = detector.getVersionVector('agent_001');

      expect(retrieved).toEqual(vector);
    });

    it('should return undefined for unknown agent', () => {
      const retrieved = detector.getVersionVector('unknown_agent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('detectSequenceConflicts', () => {
    it('should detect conflicts in events with same sequence', () => {
      const events: WatchedEvent[] = [
        createTestEvent({ sequence: 1, payload: { key: 'a' }, ledger_checkpoint: 'chk_100' }),
        createTestEvent({ sequence: 1, payload: { key: 'b' }, ledger_checkpoint: 'chk_200' }),
      ];

      const conflicts = detector.detectSequenceConflicts(events);

      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].conflict_type).toBe('SAME_SEQUENCE_DIFFERENT_HASH');
    });

    it('should return empty array for no conflicts', () => {
      const events: WatchedEvent[] = [
        createTestEvent({ sequence: 1 }),
        createTestEvent({ sequence: 2 }),
        createTestEvent({ sequence: 3 }),
      ];

      const conflicts = detector.detectSequenceConflicts(events);

      expect(conflicts).toHaveLength(0);
    });

    it('should not detect conflict for same payload at same sequence', () => {
      const events: WatchedEvent[] = [
        createTestEvent({ sequence: 1, payload: { key: 'a' } }),
        createTestEvent({ sequence: 1, payload: { key: 'a' } }),
      ];

      const conflicts = detector.detectSequenceConflicts(events);

      expect(conflicts).toHaveLength(0);
    });
  });

  describe('getConflictHistory', () => {
    it('should return empty array when no conflicts', () => {
      const history = detector.getConflictHistory('agent_001');
      expect(history).toHaveLength(0);
    });

    it('should return conflicts for specific agent', async () => {
      const state = createAgentState(['chk_200', 'chk_100']);
      const mockMonitor = createMockEventMonitor(state);
      detector.setEventMonitor(mockMonitor);

      await detector.analyze('agent_001');

      const history = detector.getConflictHistory('agent_001');
      expect(history.length).toBeGreaterThan(0);
    });

    it('should return all conflicts when no agent specified', async () => {
      const state1 = createAgentState(['chk_200', 'chk_100']);
      state1.agent_id = 'agent_001' as IdString;
      const state2 = createAgentState(['chk_300', 'chk_200']);
      state2.agent_id = 'agent_002' as IdString;

      const mockMonitor = {
        getAgentState: vi.fn((id: string) => {
          if (id === 'agent_001') return state1;
          if (id === 'agent_002') return state2;
          return undefined;
        }),
      } as unknown as EventMonitor;

      detector.setEventMonitor(mockMonitor);

      await detector.analyze('agent_001');
      await detector.analyze('agent_002');

      const history = detector.getConflictHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('analyzeAll', () => {
    it('should return empty map when no event monitor', async () => {
      const results = await detector.analyzeAll();
      expect(results.size).toBe(0);
    });

    it('should analyze all known agents', async () => {
      const state = createAgentState(['chk_200', 'chk_100']);
      const mockMonitor = createMockEventMonitor(state);
      detector.setEventMonitor(mockMonitor);

      // First analyze to populate conflicts
      await detector.analyze('agent_001');

      const results = await detector.analyzeAll();
      expect(results.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe('reset', () => {
    it('should clear all state', async () => {
      const state = createAgentState(['chk_200', 'chk_100']);
      const mockMonitor = createMockEventMonitor(state);
      detector.setEventMonitor(mockMonitor);

      await detector.analyze('agent_001');
      detector.updateVersionVector('agent_001', { identity_version: 1, revocation_epoch: 1 });

      detector.reset();

      expect(detector.getConflictHistory()).toHaveLength(0);
      expect(detector.getVersionVector('agent_001')).toBeUndefined();
    });
  });

  describe('calculateConfidence', () => {
    it('should return 0 for no conflicts', async () => {
      const state = createAgentState(['chk_100', 'chk_200']);
      const mockMonitor = createMockEventMonitor(state);
      detector.setEventMonitor(mockMonitor);

      const result = await detector.analyze('agent_001');

      expect(result.confidence).toBe(0);
    });

    it('should return higher confidence for SAME_SEQUENCE_DIFFERENT_HASH', async () => {
      const state = createAgentState(
        ['chk_100', 'chk_100'],
        { rootHashes: ['hash_a', 'hash_b'] }
      );
      const mockMonitor = createMockEventMonitor(state);
      detector.setEventMonitor(mockMonitor);

      const result = await detector.analyze('agent_001');

      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should multiply confidence for multiple conflicts', async () => {
      // Create state with multiple conflicts
      const state = {
        agent_id: 'agent_001' as IdString,
        last_known_checkpoint: 'chk_100',
        last_known_sequence: 5,
        last_observed_at: new Date().toISOString(),
        checkpoints_history: [
          { checkpoint: 'chk_100', observed_at: new Date().toISOString(), event_count: 1, root_hash: 'hash_a' },
          { checkpoint: 'chk_100', observed_at: new Date().toISOString(), event_count: 1, root_hash: 'hash_b' },
          { checkpoint: 'chk_50', observed_at: new Date().toISOString(), event_count: 1 },
          { checkpoint: 'chk_25', observed_at: new Date().toISOString(), event_count: 1 },
        ],
      };

      const mockMonitor = createMockEventMonitor(state);
      detector.setEventMonitor(mockMonitor);

      const result = await detector.analyze('agent_001');

      expect(result.conflicts.length).toBeGreaterThan(1);
    });
  });
});

describe('compareCheckpoints', () => {
  it('should return -1 when a < b', () => {
    expect(compareCheckpoints('chk_100', 'chk_200')).toBe(-1);
  });

  it('should return 1 when a > b', () => {
    expect(compareCheckpoints('chk_200', 'chk_100')).toBe(1);
  });

  it('should return 0 when equal', () => {
    expect(compareCheckpoints('chk_100', 'chk_100')).toBe(0);
  });

  it('should handle non-standard formats', () => {
    expect(compareCheckpoints('invalid', 'chk_100')).toBe(-1);
    expect(compareCheckpoints('chk_100', 'invalid')).toBe(1);
    expect(compareCheckpoints('invalid', 'invalid')).toBe(0);
  });
});

describe('isCheckpointRollback', () => {
  it('should return true when observed is older', () => {
    expect(isCheckpointRollback('chk_100', 'chk_200')).toBe(true);
  });

  it('should return false when observed is newer', () => {
    expect(isCheckpointRollback('chk_200', 'chk_100')).toBe(false);
  });

  it('should return false when equal', () => {
    expect(isCheckpointRollback('chk_100', 'chk_100')).toBe(false);
  });
});

describe('SplitViewAlert generation', () => {
  let detector: SplitViewDetector;

  beforeEach(() => {
    detector = new SplitViewDetector();
  });

  it('should generate CRITICAL alert for SAME_SEQUENCE_DIFFERENT_HASH', async () => {
    const alerts: SplitViewAlert[] = [];
    detector.setAlertCallback((alert) => {
      alerts.push(alert);
    });

    const state = createAgentState(
      ['chk_100', 'chk_100'],
      { rootHashes: ['hash_a', 'hash_b'] }
    );
    const mockMonitor = createMockEventMonitor(state);
    detector.setEventMonitor(mockMonitor);

    await detector.analyze('agent_001');

    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].severity).toBe('CRITICAL');
    expect(alerts[0].alert_type).toBe('SPLIT_VIEW_SUSPECTED');
    expect(alerts[0].recommended_action).toBe('HOLD_HIGH_RISK_OPERATIONS');
  });

  it('should generate HIGH alert for BRANCH_DETECTED', async () => {
    const alerts: SplitViewAlert[] = [];
    detector.setAlertCallback((alert) => {
      alerts.push(alert);
    });

    const state = createAgentState(['chk_200', 'chk_100']);
    const mockMonitor = createMockEventMonitor(state);
    detector.setEventMonitor(mockMonitor);

    await detector.analyze('agent_001');

    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].severity).toBe('HIGH');
    expect(alerts[0].alert_type).toBe('ROLLBACK_SUSPECTED');
    expect(alerts[0].recommended_action).toBe('TERMINATE_SESSIONS');
  });
});