/**
 * Watcher - エントリーポイント
 * @see ../../../specs/core/interfaces.md (Watcher Notification Interface)
 * @see ../../../specs/ledger/events.md
 */

// Types
export type {
  AlertType,
  WatcherSeverity,
  RecommendedAction,
  WatcherAlert,
  CheckpointInfo,
  AgentCheckpointState,
  EventMonitorConfig,
  LedgerEventType,
  WatchedEvent,
  EventMonitorResult,
  AnomalyInfo,
  SplitViewDetectorConfig,
  CheckpointConflict,
  SplitViewDetectionResult,
  AlertNotifierConfig,
  AlertEndpoint,
  AlertNotificationResult,
  EventHandler,
  AlertHandler,
  AnomalyHandler,
  Watcher,
  WatcherConfig,
  VersionVector,
  VersionCheckResult,
} from './types.js';

// Event Monitor
export { EventMonitor, HttpLedgerClient } from './event-monitor.js';
export type { LedgerClient } from './event-monitor.js';

// Split-view Detector
export {
  SplitViewDetector,
  compareCheckpoints,
  isCheckpointRollback,
} from './split-view-detector.js';
export type { SplitViewAlert } from './split-view-detector.js';

// Alert Notifier
export { AlertNotifier, AlertFactory } from './alert-notifier.js';
export type { AlertStatistics } from './alert-notifier.js';

import type {
  WatcherConfig,
  WatcherAlert,
  WatchedEvent,
  AnomalyInfo,
  AgentCheckpointState,
  AlertType,
  IdString,
  Timestamp,
  VersionVector,
  VersionCheckResult,
} from './types.js';
import { EventMonitor, type LedgerClient } from './event-monitor.js';
import { SplitViewDetector } from './split-view-detector.js';
import { AlertNotifier, AlertFactory } from './alert-notifier.js';

/**
 * Watcher実装
 * イベント監視、Split-view検知、アラート通知を統合
 */
export class WatcherImpl {
  private eventMonitor: EventMonitor;
  private splitViewDetector: SplitViewDetector;
  private alertNotifier: AlertNotifier;
  private ledgerClient: LedgerClient | null;
  private isRunning: boolean;
  private alertHistory: WatcherAlert[];

  constructor(config?: Partial<WatcherConfig>) {
    this.eventMonitor = new EventMonitor(config?.monitor);
    this.splitViewDetector = new SplitViewDetector(config?.detector);
    this.alertNotifier = new AlertNotifier(config?.notifier);
    this.ledgerClient = null;
    this.isRunning = false;
    this.alertHistory = [];

    // コンポーネント間の連携を設定
    this.splitViewDetector.setEventMonitor(this.eventMonitor);
    this.setupInternalHandlers();
  }

  /**
   * 内部ハンドラを設定
   */
  private setupInternalHandlers(): void {
    // 異常検知 -> アラート生成
    this.eventMonitor.addAnomalyHandler(async (anomaly: AnomalyInfo) => {
      const alert = this.createAlertFromAnomaly(anomaly);
      await this.alertNotifier.notify(alert);
      this.alertHistory.push(alert);
    });

    // Split-view検知のアラートコールバック
    this.splitViewDetector.setAlertCallback(async (alert) => {
      const watcherAlert: WatcherAlert = {
        alert_id: alert.alert_id,
        agent_id: alert.agent_id,
        alert_type: alert.alert_type,
        detected_at: alert.detected_at,
        severity: alert.severity,
        evidence_refs: alert.evidence_refs,
        recommended_action: alert.recommended_action as WatcherAlert['recommended_action'],
        details: alert.details,
      };
      await this.alertNotifier.notify(watcherAlert);
      this.alertHistory.push(watcherAlert);
    });
  }

  /**
   * 異常からアラートを生成
   */
  private createAlertFromAnomaly(anomaly: AnomalyInfo): WatcherAlert {
    let alertType: AlertType;
    let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    let recommendedAction: string;

    switch (anomaly.type) {
      case 'CHECKPOINT_ROLLBACK':
        alertType = 'ROLLBACK_SUSPECTED';
        severity = 'HIGH';
        recommendedAction = 'TERMINATE_SESSIONS';
        break;
      case 'SEQUENCE_GAP':
        alertType = 'CHECKPOINT_CONFLICT';
        severity = 'MEDIUM';
        recommendedAction = 'INVESTIGATE';
        break;
      case 'DUPLICATE_EVENT_CONFLICT':
        alertType = 'SPLIT_VIEW_SUSPECTED';
        severity = 'CRITICAL';
        recommendedAction = 'HOLD_HIGH_RISK_OPERATIONS';
        break;
      case 'PREV_HASH_MISMATCH':
        alertType = 'CHECKPOINT_CONFLICT';
        severity = 'HIGH';
        recommendedAction = 'INVESTIGATE';
        break;
      default:
        alertType = 'CHECKPOINT_CONFLICT';
        severity = 'MEDIUM';
        recommendedAction = 'INVESTIGATE';
    }

    return {
      alert_id: `alt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      agent_id: anomaly.agent_id,
      alert_type: alertType,
      detected_at: anomaly.detected_at,
      severity,
      evidence_refs: [],
      recommended_action: recommendedAction as WatcherAlert['recommended_action'],
      details: {
        anomaly_type: anomaly.type,
        ...anomaly.details,
      },
    };
  }

  /**
   * Ledgerクライアントを設定
   */
  setLedgerClient(client: LedgerClient): void {
    this.ledgerClient = client;
    this.eventMonitor.setLedgerClient(client);
  }

  /**
   * 監視を開始
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    await this.eventMonitor.start();
  }

  /**
   * 監視を停止
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    await this.eventMonitor.stop();
  }

  /**
   * 現在のチェックポイントを取得
   */
  getCurrentCheckpoint(agentId?: IdString): string | undefined {
    return this.eventMonitor.getCurrentCheckpoint(agentId);
  }

  /**
   * アラートハンドラを登録
   */
  onAlert(handler: (alert: WatcherAlert) => void | Promise<void>): void {
    this.alertNotifier.addHandler(handler);
  }

  /**
   * 異常ハンドラを登録
   */
  onAnomaly(handler: (anomaly: AnomalyInfo) => void | Promise<void>): void {
    this.eventMonitor.addAnomalyHandler(handler);
  }

  /**
   * イベントハンドラを登録
   */
  onEvent(handler: (event: WatchedEvent) => void | Promise<void>): void {
    this.eventMonitor.addEventHandler(handler);
  }

  /**
   * Agentの状態を取得
   */
  getAgentState(agentId: IdString): AgentCheckpointState | undefined {
    return this.eventMonitor.getAgentState(agentId);
  }

  /**
   * アラート履歴を取得
   */
  getAlertHistory(options?: {
    agentId?: IdString;
    alertType?: AlertType;
    since?: Timestamp;
    limit?: number;
  }): WatcherAlert[] {
    let alerts = [...this.alertHistory];

    if (options?.agentId) {
      alerts = alerts.filter((a) => a.agent_id === options.agentId);
    }

    if (options?.alertType) {
      alerts = alerts.filter((a) => a.alert_type === options.alertType);
    }

    if (options?.since) {
      const sinceTime = new Date(options.since).getTime();
      alerts = alerts.filter((a) => new Date(a.detected_at).getTime() >= sinceTime);
    }

    alerts.sort((a, b) =>
      new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
    );

    if (options?.limit) {
      alerts = alerts.slice(0, options.limit);
    }

    return alerts;
  }

  /**
   * 手動でSplit-view分析を実行
   */
  async analyzeSplitView(agentId: IdString): Promise<ReturnType<SplitViewDetector['analyze']>> {
    return this.splitViewDetector.analyze(agentId);
  }

  /**
   * 手動でイベントを投入
   */
  async ingestEvent(event: WatchedEvent): Promise<void> {
    await this.eventMonitor.ingestEvent(event);

    // Split-view検知を実行
    const result = await this.splitViewDetector.analyze(event.agent_id);

    // 矛盾が検出された場合の処理
    if (result.suspected) {
      for (const conflict of result.conflicts) {
        const alert = AlertFactory.createCheckpointConflictAlert(
          event.agent_id,
          [conflict.checkpoint_a, conflict.checkpoint_b],
          {
            conflict_type: conflict.conflict_type,
            confidence: result.confidence,
          }
        );
        await this.alertNotifier.notify(alert);
        this.alertHistory.push(alert);
      }
    }
  }

  /**
   * バージョンベクトルを比較
   */
  compareVersionVectors(
    current: VersionVector,
    observed: VersionVector
  ): VersionCheckResult {
    return this.splitViewDetector.compareVersionVectors(current, observed);
  }

  /**
   * 通知エンドポイントを追加
   */
  addAlertEndpoint(
    name: string,
    url: string,
    options?: {
      auth?: { type: 'bearer' | 'basic' | 'api-key'; credentials: string };
      alertTypes?: AlertType[];
      severities?: ('LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL')[];
    }
  ): void {
    this.alertNotifier.addEndpoint({
      name,
      url,
      auth: options?.auth,
      alertTypes: options?.alertTypes,
      severities: options?.severities,
    });
  }

  /**
   * 状態をリセット
   */
  reset(): void {
    this.eventMonitor.reset();
    this.splitViewDetector.reset();
    this.alertNotifier.reset();
    this.alertHistory = [];
  }
}

/**
 * デフォルトエクスポート
 */
export default WatcherImpl;

/**
 * Watcherを作成するファクトリ関数
 */
export function createWatcher(config?: Partial<WatcherConfig>): WatcherImpl {
  return new WatcherImpl(config);
}