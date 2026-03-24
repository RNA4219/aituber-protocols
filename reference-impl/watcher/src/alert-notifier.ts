/**
 * Alert Notifier - アラート通知
 * @see ../../../specs/core/interfaces.md (Section 13: Watcher Notification Interface)
 */

import type {
  AlertNotifierConfig,
  AlertEndpoint,
  WatcherAlert,
  AlertNotificationResult,
  AlertType,
  WatcherSeverity,
  IdString,
  Timestamp,
  AlertHandler,
} from './types.js';

/** デフォルト設定 */
const DEFAULT_CONFIG: AlertNotifierConfig = {
  deduplicationPeriod: 300000, // 5分
  retryCount: 3,
  timeout: 30000, // 30秒
};

/**
 * アラート通知クラス
 * 検知した異常を各種通知先に配信する
 */
export class AlertNotifier {
  private config: AlertNotifierConfig;
  private alertHistory: WatcherAlert[];
  private recentAlerts: Map<IdString, Timestamp>;
  private handlers: AlertHandler[];
  private endpoints: AlertEndpoint[];

  constructor(config: Partial<AlertNotifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.alertHistory = [];
    this.recentAlerts = new Map();
    this.handlers = [];
    this.endpoints = config.endpoints || [];
  }

  /**
   * エンドポイントを追加
   */
  addEndpoint(endpoint: AlertEndpoint): void {
    this.endpoints.push(endpoint);
  }

  /**
   * エンドポイントを削除
   */
  removeEndpoint(name: string): void {
    this.endpoints = this.endpoints.filter((e) => e.name !== name);
  }

  /**
   * アラートハンドラを追加
   */
  addHandler(handler: AlertHandler): void {
    this.handlers.push(handler);
  }

  /**
   * アラートハンドラを削除
   */
  removeHandler(handler: AlertHandler): void {
    const index = this.handlers.indexOf(handler);
    if (index > -1) {
      this.handlers.splice(index, 1);
    }
  }

  /**
   * アラートを通知
   */
  async notify(alert: WatcherAlert): Promise<AlertNotificationResult[]> {
    // 重複チェック
    if (this.isDuplicate(alert)) {
      return [{
        success: true,
        alert_id: alert.alert_id,
        endpoint_name: 'deduplicated',
        notified_at: new Date().toISOString(),
      }];
    }

    // 履歴に追加
    this.addToHistory(alert);

    // ローカルハンドラに通知
    await this.notifyHandlers(alert);

    // エンドポイントに通知
    const results = await this.notifyEndpoints(alert);

    return results;
  }

  /**
   * 重複チェック
   */
  private isDuplicate(alert: WatcherAlert): boolean {
    const key = this.generateDeduplicationKey(alert);
    const lastTime = this.recentAlerts.get(key);

    if (lastTime) {
      const lastTimestamp = new Date(lastTime).getTime();
      const now = Date.now();
      const period = this.config.deduplicationPeriod;

      if (now - lastTimestamp < period) {
        return true;
      }
    }

    // 重複排除期間を更新
    this.recentAlerts.set(key, alert.detected_at);
    this.cleanupRecentAlerts();

    return false;
  }

  /**
   * 重複排除キーを生成
   */
  private generateDeduplicationKey(alert: WatcherAlert): IdString {
    return `${alert.agent_id}_${alert.alert_type}` as IdString;
  }

  /**
   * 古い重複排除エントリをクリーンアップ
   */
  private cleanupRecentAlerts(): void {
    const now = Date.now();
    const period = this.config.deduplicationPeriod;

    for (const [key, timestamp] of this.recentAlerts) {
      const ts = new Date(timestamp).getTime();
      if (now - ts > period) {
        this.recentAlerts.delete(key);
      }
    }
  }

  /**
   * 履歴に追加
   */
  private addToHistory(alert: WatcherAlert): void {
    this.alertHistory.push(alert);

    // 履歴サイズ制限 (最新1000件)
    if (this.alertHistory.length > 1000) {
      this.alertHistory = this.alertHistory.slice(-1000);
    }
  }

  /**
   * ローカルハンドラに通知
   */
  private async notifyHandlers(alert: WatcherAlert): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(alert);
      } catch (error) {
        console.error('Alert handler error:', error);
      }
    }
  }

  /**
   * エンドポイントに通知
   */
  private async notifyEndpoints(alert: WatcherAlert): Promise<AlertNotificationResult[]> {
    const results: AlertNotificationResult[] = [];

    for (const endpoint of this.endpoints) {
      // エンドポイントのフィルタリング
      if (!this.shouldNotifyEndpoint(endpoint, alert)) {
        continue;
      }

      const result = await this.notifyEndpoint(endpoint, alert);
      results.push(result);
    }

    return results;
  }

  /**
   * エンドポイントに通知すべきか判定
   */
  private shouldNotifyEndpoint(endpoint: AlertEndpoint, alert: WatcherAlert): boolean {
    // アラート種別フィルタ
    if (endpoint.alertTypes && endpoint.alertTypes.length > 0) {
      if (!endpoint.alertTypes.includes(alert.alert_type)) {
        return false;
      }
    }

    // 重要度フィルタ
    if (endpoint.severities && endpoint.severities.length > 0) {
      if (!endpoint.severities.includes(alert.severity)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 単一エンドポイントに通知
   */
  private async notifyEndpoint(
    endpoint: AlertEndpoint,
    alert: WatcherAlert
  ): Promise<AlertNotificationResult> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt < this.config.retryCount; attempt++) {
      try {
        const response = await this.sendRequest(endpoint, alert);

        if (response.ok) {
          return {
            success: true,
            alert_id: alert.alert_id,
            endpoint_name: endpoint.name,
            notified_at: new Date().toISOString(),
          };
        }

        lastError = `HTTP ${response.status}: ${response.statusText}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
      }

      // リトライ前に少し待機
      if (attempt < this.config.retryCount - 1) {
        await this.sleep(1000 * (attempt + 1));
      }
    }

    return {
      success: false,
      alert_id: alert.alert_id,
      endpoint_name: endpoint.name,
      notified_at: new Date().toISOString(),
      error: lastError,
    };
  }

  /**
   * HTTPリクエストを送信
   */
  private async sendRequest(
    endpoint: AlertEndpoint,
    alert: WatcherAlert
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // 認証ヘッダーを追加
    if (endpoint.auth) {
      switch (endpoint.auth.type) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${endpoint.auth.credentials}`;
          break;
        case 'basic':
          headers['Authorization'] = `Basic ${endpoint.auth.credentials}`;
          break;
        case 'api-key':
          headers['X-API-Key'] = endpoint.auth.credentials;
          break;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      return await fetch(endpoint.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(alert),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * スリープ
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * アラートを作成
   */
  createAlert(params: {
    agent_id: IdString;
    alert_type: AlertType;
    severity: WatcherSeverity;
    evidence_refs: string[];
    recommended_action: string;
    details?: Record<string, unknown>;
  }): WatcherAlert {
    return {
      alert_id: this.generateAlertId(),
      agent_id: params.agent_id,
      alert_type: params.alert_type,
      detected_at: new Date().toISOString(),
      severity: params.severity,
      evidence_refs: params.evidence_refs,
      recommended_action: params.recommended_action as any,
      details: params.details,
    };
  }

  /**
   * アラートIDを生成
   */
  private generateAlertId(): IdString {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 11);
    return `alt_${timestamp}_${random}` as IdString;
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

    // 新しい順にソート
    alerts.sort((a, b) =>
      new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
    );

    if (options?.limit) {
      alerts = alerts.slice(0, options.limit);
    }

    return alerts;
  }

  /**
   * 特定Agentの最新アラートを取得
   */
  getLatestAlert(agentId: IdString): WatcherAlert | undefined {
    const alerts = this.alertHistory
      .filter((a) => a.agent_id === agentId)
      .sort((a, b) =>
        new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
      );

    return alerts[0];
  }

  /**
   * アラート統計を取得
   */
  getStatistics(): AlertStatistics {
    const stats: AlertStatistics = {
      total_alerts: this.alertHistory.length,
      by_type: {},
      by_severity: {},
      by_agent: {},
    };

    for (const alert of this.alertHistory) {
      // 種別集計
      stats.by_type[alert.alert_type] = (stats.by_type[alert.alert_type] || 0) + 1;

      // 重要度集計
      stats.by_severity[alert.severity] = (stats.by_severity[alert.severity] || 0) + 1;

      // Agent別集計
      stats.by_agent[alert.agent_id] = (stats.by_agent[alert.agent_id] || 0) + 1;
    }

    return stats;
  }

  /**
   * 状態をリセット
   */
  reset(): void {
    this.alertHistory = [];
    this.recentAlerts.clear();
  }
}

/**
 * アラート統計
 */
export interface AlertStatistics {
  total_alerts: number;
  by_type: Partial<Record<AlertType, number>>;
  by_severity: Partial<Record<WatcherSeverity, number>>;
  by_agent: Record<IdString, number>;
}

/**
 * アラートファクトリ - 一般的なアラートを生成するユーティリティ
 */
export class AlertFactory {
  /**
   * Split-view検知アラート
   */
  static createSplitViewAlert(
    agentId: IdString,
    checkpoints: string[],
    details?: Record<string, unknown>
  ): WatcherAlert {
    return {
      alert_id: `alt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` as IdString,
      agent_id: agentId,
      alert_type: 'SPLIT_VIEW_SUSPECTED',
      detected_at: new Date().toISOString(),
      severity: 'CRITICAL',
      evidence_refs: checkpoints,
      recommended_action: 'HOLD_HIGH_RISK_OPERATIONS',
      details: {
        ...details,
        description: 'Conflicting checkpoints detected for the same sequence',
      },
    };
  }

  /**
   * ロールバック検知アラート
   */
  static createRollbackAlert(
    agentId: IdString,
    currentCheckpoint: string,
    observedCheckpoint: string,
    details?: Record<string, unknown>
  ): WatcherAlert {
    return {
      alert_id: `alt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` as IdString,
      agent_id: agentId,
      alert_type: 'ROLLBACK_SUSPECTED',
      detected_at: new Date().toISOString(),
      severity: 'HIGH',
      evidence_refs: [currentCheckpoint, observedCheckpoint],
      recommended_action: 'TERMINATE_SESSIONS',
      details: {
        ...details,
        current_checkpoint: currentCheckpoint,
        observed_checkpoint: observedCheckpoint,
        description: 'Checkpoint sequence decreased unexpectedly',
      },
    };
  }

  /**
   * チェックポイント矛盾アラート
   */
  static createCheckpointConflictAlert(
    agentId: IdString,
    checkpoints: string[],
    details?: Record<string, unknown>
  ): WatcherAlert {
    return {
      alert_id: `alt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` as IdString,
      agent_id: agentId,
      alert_type: 'CHECKPOINT_CONFLICT',
      detected_at: new Date().toISOString(),
      severity: 'HIGH',
      evidence_refs: checkpoints,
      recommended_action: 'INVESTIGATE',
      details: {
        ...details,
        description: 'Checkpoint conflict detected',
      },
    };
  }

  /**
   * 予期しない鍵ローテーションアラート
   */
  static createUnexpectedKeyRotationAlert(
    agentId: IdString,
    keyId: IdString,
    details?: Record<string, unknown>
  ): WatcherAlert {
    return {
      alert_id: `alt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` as IdString,
      agent_id: agentId,
      alert_type: 'UNEXPECTED_KEY_ROTATION',
      detected_at: new Date().toISOString(),
      severity: 'HIGH',
      evidence_refs: [keyId],
      recommended_action: 'INVESTIGATE',
      details: {
        ...details,
        key_id: keyId,
        description: 'Key rotation detected without corresponding recovery event',
      },
    };
  }

  /**
   * リカバリシーケンス無効アラート
   */
  static createRecoverySequenceInvalidAlert(
    agentId: IdString,
    recoveryId: IdString,
    details?: Record<string, unknown>
  ): WatcherAlert {
    return {
      alert_id: `alt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` as IdString,
      agent_id: agentId,
      alert_type: 'RECOVERY_SEQUENCE_INVALID',
      detected_at: new Date().toISOString(),
      severity: 'CRITICAL',
      evidence_refs: [recoveryId],
      recommended_action: 'TRIGGER_RECOVERY',
      details: {
        ...details,
        recovery_id: recoveryId,
        description: 'Recovery sequence is incomplete or invalid',
      },
    };
  }

  /**
   * 失効情報古すぎアラート
   */
  static createStaleRevocationExcessiveAlert(
    agentId: IdString,
    staleDuration: number,
    details?: Record<string, unknown>
  ): WatcherAlert {
    return {
      alert_id: `alt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` as IdString,
      agent_id: agentId,
      alert_type: 'STALE_REVOCATION_EXCESSIVE',
      detected_at: new Date().toISOString(),
      severity: 'MEDIUM',
      evidence_refs: [],
      recommended_action: 'NOTIFY_OPERATOR',
      details: {
        ...details,
        stale_duration_ms: staleDuration,
        description: 'Revocation information has been stale for an extended period',
      },
    };
  }
}