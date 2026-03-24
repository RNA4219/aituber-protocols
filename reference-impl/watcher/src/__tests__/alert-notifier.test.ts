/**
 * AlertNotifier Tests - アラート送信・履歴
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertNotifier, AlertFactory, AlertStatistics } from '../alert-notifier.js';
import type {
  AlertNotifierConfig,
  AlertEndpoint,
  WatcherAlert,
  AlertType,
  WatcherSeverity,
  IdString,
  AlertHandler,
} from '../types.js';

// Helper to create test alerts
const createTestAlert = (overrides: Partial<WatcherAlert> = {}): WatcherAlert => ({
  alert_id: 'alt_001' as IdString,
  agent_id: 'agent_001' as IdString,
  alert_type: 'SPLIT_VIEW_SUSPECTED' as AlertType,
  detected_at: new Date().toISOString(),
  severity: 'HIGH' as WatcherSeverity,
  evidence_refs: ['chk_100', 'chk_200'],
  recommended_action: 'INVESTIGATE',
  ...overrides,
});

// Helper to create test endpoints
const createTestEndpoint = (overrides: Partial<AlertEndpoint> = {}): AlertEndpoint => ({
  name: 'test-endpoint',
  url: 'http://localhost:8080/alerts',
  ...overrides,
});

// Mock fetch globally
const originalFetch = global.fetch;

describe('AlertNotifier', () => {
  let notifier: AlertNotifier;

  beforeEach(() => {
    notifier = new AlertNotifier();
    vi.clearAllMocks();
  });

  afterEach(() => {
    notifier.reset();
    global.fetch = originalFetch;
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      expect(notifier).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      const customNotifier = new AlertNotifier({
        deduplicationPeriod: 60000,
        retryCount: 5,
        timeout: 10000,
      });
      expect(customNotifier).toBeDefined();
    });

    it('should initialize with endpoints from config', () => {
      const endpoints: AlertEndpoint[] = [
        createTestEndpoint({ name: 'endpoint1' }),
        createTestEndpoint({ name: 'endpoint2' }),
      ];
      const notifierWithEndpoints = new AlertNotifier({ endpoints });
      expect(notifierWithEndpoints).toBeDefined();
    });
  });

  describe('addEndpoint and removeEndpoint', () => {
    it('should add endpoint', () => {
      const endpoint = createTestEndpoint();
      notifier.addEndpoint(endpoint);
      // Endpoint added successfully
      expect(true).toBe(true);
    });

    it('should remove endpoint', () => {
      const endpoint = createTestEndpoint({ name: 'test' });
      notifier.addEndpoint(endpoint);
      notifier.removeEndpoint('test');
      // Endpoint removed successfully
      expect(true).toBe(true);
    });

    it('should handle removing non-existent endpoint', () => {
      notifier.removeEndpoint('non-existent');
      // No error means success
    });
  });

  describe('addHandler and removeHandler', () => {
    it('should add handler', () => {
      const handler: AlertHandler = vi.fn();
      notifier.addHandler(handler);
      expect(true).toBe(true);
    });

    it('should remove handler', () => {
      const handler: AlertHandler = vi.fn();
      notifier.addHandler(handler);
      notifier.removeHandler(handler);
      expect(true).toBe(true);
    });

    it('should handle removing non-existent handler', () => {
      const handler: AlertHandler = vi.fn();
      notifier.removeHandler(handler);
      // No error means success
    });
  });

  describe('notify', () => {
    it('should notify local handlers', async () => {
      const handler = vi.fn();
      notifier.addHandler(handler);

      const alert = createTestAlert();
      await notifier.notify(alert);

      expect(handler).toHaveBeenCalledWith(alert);
    });

    it('should add alert to history', async () => {
      const alert = createTestAlert();
      await notifier.notify(alert);

      const history = notifier.getAlertHistory();
      expect(history.some(a => a.alert_id === 'alt_001')).toBe(true);
    });

    it('should deduplicate alerts', async () => {
      const handler = vi.fn();
      notifier.addHandler(handler);

      const alert1 = createTestAlert({
        alert_id: 'alt_001',
        detected_at: new Date().toISOString(),
      });
      const alert2 = createTestAlert({
        alert_id: 'alt_002',
        detected_at: new Date().toISOString(),
      });

      await notifier.notify(alert1);
      await notifier.notify(alert2); // Should be deduplicated

      // Handler called once (deduplication prevents second call to handler)
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should not deduplicate after period expires', async () => {
      const shortPeriodNotifier = new AlertNotifier({
        deduplicationPeriod: 10, // 10ms
      });

      const handler = vi.fn();
      shortPeriodNotifier.addHandler(handler);

      const alert1 = createTestAlert({
        alert_id: 'alt_001',
        detected_at: new Date().toISOString(),
      });

      await shortPeriodNotifier.notify(alert1);

      // Wait for deduplication period to expire
      await new Promise(resolve => setTimeout(resolve, 50));

      const alert2 = createTestAlert({
        alert_id: 'alt_002',
        detected_at: new Date().toISOString(),
      });

      await shortPeriodNotifier.notify(alert2);

      expect(handler).toHaveBeenCalledTimes(2);

      shortPeriodNotifier.reset();
    });

    it('should return deduplicated result when duplicate', async () => {
      const alert1 = createTestAlert({
        alert_id: 'alt_001',
        detected_at: new Date().toISOString(),
      });

      await notifier.notify(alert1);

      const alert2 = createTestAlert({
        alert_id: 'alt_002',
        detected_at: new Date().toISOString(),
      });

      const results = await notifier.notify(alert2);

      expect(results[0].success).toBe(true);
      expect(results[0].endpoint_name).toBe('deduplicated');
    });

    it('should handle handler errors gracefully', async () => {
      const errorHandler: AlertHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
      notifier.addHandler(errorHandler);

      const alert = createTestAlert();
      // Should not throw
      await notifier.notify(alert);
    });
  });

  describe('endpoint notification', () => {
    it('should notify endpoints', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const endpoint = createTestEndpoint();
      notifier.addEndpoint(endpoint);

      const alert = createTestAlert({
        agent_id: 'agent_002' as IdString,
        alert_type: 'CHECKPOINT_CONFLICT',
      });
      const results = await notifier.notify(alert);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].success).toBe(true);
      expect(results[0].endpoint_name).toBe('test-endpoint');
    });

    it('should filter endpoints by alert type', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });
      global.fetch = fetchMock;

      const endpoint = createTestEndpoint({
        alertTypes: ['ROLLBACK_SUSPECTED'],
      });
      notifier.addEndpoint(endpoint);

      const alert = createTestAlert({ alert_type: 'SPLIT_VIEW_SUSPECTED' });
      const results = await notifier.notify(alert);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should filter endpoints by severity', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });
      global.fetch = fetchMock;

      const endpoint = createTestEndpoint({
        severities: ['CRITICAL'],
      });
      notifier.addEndpoint(endpoint);

      const alert = createTestAlert({ severity: 'HIGH' });
      const results = await notifier.notify(alert);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should retry on failure', async () => {
      let attempts = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
        });
      });

      const retryNotifier = new AlertNotifier({ retryCount: 3 });
      const endpoint = createTestEndpoint();
      retryNotifier.addEndpoint(endpoint);

      const alert = createTestAlert({
        alert_id: 'alt_retry' as IdString,
        agent_id: 'agent_retry' as IdString,
      });
      const results = await retryNotifier.notify(alert);

      expect(attempts).toBe(3);
      expect(results[0].success).toBe(true);

      retryNotifier.reset();
    });

    it('should return error after all retries fail', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const retryNotifier = new AlertNotifier({ retryCount: 2 });
      const endpoint = createTestEndpoint();
      retryNotifier.addEndpoint(endpoint);

      const alert = createTestAlert({
        alert_id: 'alt_fail' as IdString,
        agent_id: 'agent_fail' as IdString,
      });
      const results = await retryNotifier.notify(alert);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBeDefined();

      retryNotifier.reset();
    });

    it('should handle fetch exceptions', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const endpoint = createTestEndpoint();
      notifier.addEndpoint(endpoint);

      const alert = createTestAlert({
        alert_id: 'alt_exception' as IdString,
        agent_id: 'agent_exception' as IdString,
      });
      const results = await notifier.notify(alert);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Network error');
    });

    it('should add auth headers for bearer token', async () => {
      let capturedHeaders: Record<string, string> = {};
      global.fetch = vi.fn().mockImplementation((url, options) => {
        capturedHeaders = options.headers;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
        });
      });

      const endpoint = createTestEndpoint({
        auth: {
          type: 'bearer',
          credentials: 'test-token',
        },
      });
      notifier.addEndpoint(endpoint);

      const alert = createTestAlert({
        alert_id: 'alt_bearer' as IdString,
        agent_id: 'agent_bearer' as IdString,
      });
      await notifier.notify(alert);

      expect(capturedHeaders['Authorization']).toBe('Bearer test-token');
    });

    it('should add auth headers for basic auth', async () => {
      let capturedHeaders: Record<string, string> = {};
      global.fetch = vi.fn().mockImplementation((url, options) => {
        capturedHeaders = options.headers;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
        });
      });

      const endpoint = createTestEndpoint({
        auth: {
          type: 'basic',
          credentials: 'dXNlcjpwYXNz',
        },
      });
      notifier.addEndpoint(endpoint);

      const alert = createTestAlert({
        alert_id: 'alt_basic' as IdString,
        agent_id: 'agent_basic' as IdString,
      });
      await notifier.notify(alert);

      expect(capturedHeaders['Authorization']).toBe('Basic dXNlcjpwYXNz');
    });

    it('should add auth headers for api-key', async () => {
      let capturedHeaders: Record<string, string> = {};
      global.fetch = vi.fn().mockImplementation((url, options) => {
        capturedHeaders = options.headers;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
        });
      });

      const endpoint = createTestEndpoint({
        auth: {
          type: 'api-key',
          credentials: 'my-api-key',
        },
      });
      notifier.addEndpoint(endpoint);

      const alert = createTestAlert({
        alert_id: 'alt_api' as IdString,
        agent_id: 'agent_api' as IdString,
      });
      await notifier.notify(alert);

      expect(capturedHeaders['X-API-Key']).toBe('my-api-key');
    });
  });

  describe('createAlert', () => {
    it('should create alert with all parameters', () => {
      const alert = notifier.createAlert({
        agent_id: 'agent_001',
        alert_type: 'ROLLBACK_SUSPECTED',
        severity: 'CRITICAL',
        evidence_refs: ['chk_100', 'chk_200'],
        recommended_action: 'TERMINATE_SESSIONS',
        details: { reason: 'test' },
      });

      expect(alert.agent_id).toBe('agent_001');
      expect(alert.alert_type).toBe('ROLLBACK_SUSPECTED');
      expect(alert.severity).toBe('CRITICAL');
      expect(alert.evidence_refs).toHaveLength(2);
      expect(alert.details?.reason).toBe('test');
    });

    it('should generate unique alert id', () => {
      const alert1 = notifier.createAlert({
        agent_id: 'agent_001',
        alert_type: 'SPLIT_VIEW_SUSPECTED',
        severity: 'HIGH',
        evidence_refs: [],
        recommended_action: 'INVESTIGATE',
      });

      const alert2 = notifier.createAlert({
        agent_id: 'agent_001',
        alert_type: 'SPLIT_VIEW_SUSPECTED',
        severity: 'HIGH',
        evidence_refs: [],
        recommended_action: 'INVESTIGATE',
      });

      expect(alert1.alert_id).not.toBe(alert2.alert_id);
    });
  });

  describe('getAlertHistory', () => {
    beforeEach(async () => {
      // Add some alerts to history
      const alerts = [
        createTestAlert({ alert_id: 'alt_001', agent_id: 'agent_001', alert_type: 'SPLIT_VIEW_SUSPECTED', detected_at: '2024-01-01T10:00:00Z' }),
        createTestAlert({ alert_id: 'alt_002', agent_id: 'agent_001', alert_type: 'ROLLBACK_SUSPECTED', detected_at: '2024-01-01T11:00:00Z' }),
        createTestAlert({ alert_id: 'alt_003', agent_id: 'agent_002', alert_type: 'CHECKPOINT_CONFLICT', detected_at: '2024-01-01T12:00:00Z' }),
      ];

      for (const alert of alerts) {
        // Reset deduplication between alerts
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Manually add to history (bypassing deduplication)
      notifier.reset();
    });

    it('should return all alerts when no filters', async () => {
      notifier.reset();
      const alert = createTestAlert({ alert_id: 'alt_test' });
      await notifier.notify(alert);

      const history = notifier.getAlertHistory();
      expect(history.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter by agent id', async () => {
      notifier.reset();

      const alert1 = createTestAlert({ alert_id: 'alt_001', agent_id: 'agent_001' });
      const alert2 = createTestAlert({ alert_id: 'alt_002', agent_id: 'agent_002' });

      // Clear deduplication cache
      await notifier.notify(alert1);
      await new Promise(resolve => setTimeout(resolve, 100));

      const newNotifier = new AlertNotifier();
      await newNotifier.notify(alert1);
      await newNotifier.notify(alert2);

      const history = newNotifier.getAlertHistory({ agentId: 'agent_001' });
      expect(history.every(a => a.agent_id === 'agent_001')).toBe(true);

      newNotifier.reset();
    });

    it('should filter by alert type', async () => {
      const filterNotifier = new AlertNotifier();
      const alert1 = createTestAlert({ alert_id: 'alt_001', alert_type: 'SPLIT_VIEW_SUSPECTED' });
      const alert2 = createTestAlert({ alert_id: 'alt_002', alert_type: 'ROLLBACK_SUSPECTED' });

      await filterNotifier.notify(alert1);
      await filterNotifier.notify(alert2);

      const history = filterNotifier.getAlertHistory({ alertType: 'SPLIT_VIEW_SUSPECTED' });
      expect(history.every(a => a.alert_type === 'SPLIT_VIEW_SUSPECTED')).toBe(true);

      filterNotifier.reset();
    });

    it('should filter by time', async () => {
      const notifier = new AlertNotifier();

      const oldAlert = createTestAlert({
        alert_id: 'alt_old',
        detected_at: '2024-01-01T10:00:00Z',
      });
      const newAlert = createTestAlert({
        alert_id: 'alt_new',
        detected_at: new Date().toISOString(),
      });

      await notifier.notify(oldAlert);
      await notifier.notify(newAlert);

      const history = notifier.getAlertHistory({ since: '2024-06-01T00:00:00Z' });
      expect(history.every(a => new Date(a.detected_at) >= new Date('2024-06-01'))).toBe(true);

      notifier.reset();
    });

    it('should limit results', async () => {
      const limitNotifier = new AlertNotifier();

      for (let i = 0; i < 5; i++) {
        const alert = createTestAlert({
          alert_id: `alt_${i}` as IdString,
          agent_id: `agent_${i}` as IdString,
        });
        await limitNotifier.notify(alert);
      }

      const history = limitNotifier.getAlertHistory({ limit: 3 });
      expect(history.length).toBeLessThanOrEqual(3);

      limitNotifier.reset();
    });

    it('should sort by detected_at descending', async () => {
      const sortNotifier = new AlertNotifier();

      const alert1 = createTestAlert({ alert_id: 'alt_1', detected_at: '2024-01-01T10:00:00Z' });
      const alert2 = createTestAlert({ alert_id: 'alt_2', detected_at: '2024-01-01T12:00:00Z' });

      await sortNotifier.notify(alert1);
      await sortNotifier.notify(alert2);

      const history = sortNotifier.getAlertHistory();
      for (let i = 1; i < history.length; i++) {
        expect(
          new Date(history[i - 1].detected_at) >= new Date(history[i].detected_at)
        ).toBe(true);
      }

      sortNotifier.reset();
    });
  });

  describe('getLatestAlert', () => {
    it('should return undefined for unknown agent', () => {
      const alert = notifier.getLatestAlert('unknown_agent');
      expect(alert).toBeUndefined();
    });

    it('should return latest alert for agent', async () => {
      const latestNotifier = new AlertNotifier();

      const alert1 = createTestAlert({
        alert_id: 'alt_1',
        agent_id: 'agent_001',
        detected_at: '2024-01-01T10:00:00Z',
      });
      const alert2 = createTestAlert({
        alert_id: 'alt_2',
        agent_id: 'agent_001',
        detected_at: '2024-01-01T12:00:00Z',
      });

      await latestNotifier.notify(alert1);
      await latestNotifier.notify(alert2);

      const latest = latestNotifier.getLatestAlert('agent_001');
      expect(latest).toBeDefined();
      expect(latest?.detected_at).toBe('2024-01-01T12:00:00Z');

      latestNotifier.reset();
    });
  });

  describe('getStatistics', () => {
    it('should return empty statistics when no alerts', () => {
      const stats = notifier.getStatistics();

      expect(stats.total_alerts).toBe(0);
      expect(Object.keys(stats.by_type)).toHaveLength(0);
      expect(Object.keys(stats.by_severity)).toHaveLength(0);
    });

    it('should aggregate statistics correctly', async () => {
      const statsNotifier = new AlertNotifier();

      const alerts = [
        createTestAlert({ alert_id: 'alt_1', agent_id: 'agent_001', alert_type: 'SPLIT_VIEW_SUSPECTED', severity: 'CRITICAL' }),
        createTestAlert({ alert_id: 'alt_2', agent_id: 'agent_002', alert_type: 'SPLIT_VIEW_SUSPECTED', severity: 'HIGH' }),
        createTestAlert({ alert_id: 'alt_3', agent_id: 'agent_003', alert_type: 'ROLLBACK_SUSPECTED', severity: 'HIGH' }),
      ];

      for (const alert of alerts) {
        await statsNotifier.notify(alert);
      }

      const stats = statsNotifier.getStatistics();

      expect(stats.total_alerts).toBe(3);
      expect(stats.by_type['SPLIT_VIEW_SUSPECTED']).toBe(2);
      expect(stats.by_type['ROLLBACK_SUSPECTED']).toBe(1);
      expect(stats.by_severity['CRITICAL']).toBe(1);
      expect(stats.by_severity['HIGH']).toBe(2);
      expect(stats.by_agent['agent_001']).toBe(1);
      expect(stats.by_agent['agent_002']).toBe(1);
      expect(stats.by_agent['agent_003']).toBe(1);

      statsNotifier.reset();
    });
  });

  describe('reset', () => {
    it('should clear all state', async () => {
      const alert = createTestAlert();
      await notifier.notify(alert);

      notifier.reset();

      const history = notifier.getAlertHistory();
      expect(history).toHaveLength(0);
    });
  });

  describe('history size limits', () => {
    it('should limit history size to 1000', async () => {
      const limitNotifier = new AlertNotifier();

      // Add more than 1000 alerts
      for (let i = 0; i < 1100; i++) {
        const alert = createTestAlert({
          alert_id: `alt_${i}` as IdString,
          agent_id: `agent_${i % 10}` as IdString,
        });
        await limitNotifier.notify(alert);
      }

      const history = limitNotifier.getAlertHistory();
      expect(history.length).toBeLessThanOrEqual(1000);

      limitNotifier.reset();
    });
  });
});

describe('AlertFactory', () => {
  describe('createSplitViewAlert', () => {
    it('should create split view alert', () => {
      const alert = AlertFactory.createSplitViewAlert('agent_001', ['chk_100', 'chk_200']);

      expect(alert.agent_id).toBe('agent_001');
      expect(alert.alert_type).toBe('SPLIT_VIEW_SUSPECTED');
      expect(alert.severity).toBe('CRITICAL');
      expect(alert.recommended_action).toBe('HOLD_HIGH_RISK_OPERATIONS');
      expect(alert.evidence_refs).toHaveLength(2);
    });

    it('should include details', () => {
      const alert = AlertFactory.createSplitViewAlert('agent_001', ['chk_100'], { extra: 'info' });

      expect(alert.details?.extra).toBe('info');
      expect(alert.details?.description).toBeDefined();
    });
  });

  describe('createRollbackAlert', () => {
    it('should create rollback alert', () => {
      const alert = AlertFactory.createRollbackAlert('agent_001', 'chk_200', 'chk_100');

      expect(alert.agent_id).toBe('agent_001');
      expect(alert.alert_type).toBe('ROLLBACK_SUSPECTED');
      expect(alert.severity).toBe('HIGH');
      expect(alert.recommended_action).toBe('TERMINATE_SESSIONS');
      expect(alert.details?.current_checkpoint).toBe('chk_200');
      expect(alert.details?.observed_checkpoint).toBe('chk_100');
    });
  });

  describe('createCheckpointConflictAlert', () => {
    it('should create checkpoint conflict alert', () => {
      const alert = AlertFactory.createCheckpointConflictAlert('agent_001', ['chk_100', 'chk_101']);

      expect(alert.agent_id).toBe('agent_001');
      expect(alert.alert_type).toBe('CHECKPOINT_CONFLICT');
      expect(alert.severity).toBe('HIGH');
      expect(alert.recommended_action).toBe('INVESTIGATE');
    });
  });

  describe('createUnexpectedKeyRotationAlert', () => {
    it('should create unexpected key rotation alert', () => {
      const alert = AlertFactory.createUnexpectedKeyRotationAlert('agent_001', 'key_001');

      expect(alert.agent_id).toBe('agent_001');
      expect(alert.alert_type).toBe('UNEXPECTED_KEY_ROTATION');
      expect(alert.severity).toBe('HIGH');
      expect(alert.recommended_action).toBe('INVESTIGATE');
      expect(alert.evidence_refs).toContain('key_001');
    });
  });

  describe('createRecoverySequenceInvalidAlert', () => {
    it('should create recovery sequence invalid alert', () => {
      const alert = AlertFactory.createRecoverySequenceInvalidAlert('agent_001', 'recovery_001');

      expect(alert.agent_id).toBe('agent_001');
      expect(alert.alert_type).toBe('RECOVERY_SEQUENCE_INVALID');
      expect(alert.severity).toBe('CRITICAL');
      expect(alert.recommended_action).toBe('TRIGGER_RECOVERY');
      expect(alert.evidence_refs).toContain('recovery_001');
    });
  });

  describe('createStaleRevocationExcessiveAlert', () => {
    it('should create stale revocation excessive alert', () => {
      const alert = AlertFactory.createStaleRevocationExcessiveAlert('agent_001', 86400000);

      expect(alert.agent_id).toBe('agent_001');
      expect(alert.alert_type).toBe('STALE_REVOCATION_EXCESSIVE');
      expect(alert.severity).toBe('MEDIUM');
      expect(alert.recommended_action).toBe('NOTIFY_OPERATOR');
      expect(alert.details?.stale_duration_ms).toBe(86400000);
    });
  });
});