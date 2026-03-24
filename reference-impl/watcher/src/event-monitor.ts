/**
 * Event Monitor - Ledgerイベント監視
 * @see ../../../specs/ledger/events.md
 */

import type {
  EventMonitorConfig,
  WatchedEvent,
  EventMonitorResult,
  AnomalyInfo,
  AgentCheckpointState,
  CheckpointInfo,
  EventHandler,
  AnomalyHandler,
  LedgerEventType,
  IdString,
} from './types.js';

/** デフォルト設定 */
const DEFAULT_CONFIG: EventMonitorConfig = {
  checkpointInterval: 5000, // 5秒
  retentionPeriod: 7 * 24 * 60 * 60 * 1000, // 7日
  maxHistorySize: 10000,
};

/**
 * イベント監視クラス
 * Ledgerからのイベントを購読し、異常を検知する
 */
export class EventMonitor {
  private config: EventMonitorConfig;
  private agentStates: Map<IdString, AgentCheckpointState>;
  private eventHistory: WatchedEvent[];
  private eventHandlers: EventHandler[];
  private anomalyHandlers: AnomalyHandler[];
  private intervalId: NodeJS.Timeout | null;
  private ledgerClient: LedgerClient | null;
  private isRunning: boolean;

  constructor(config: Partial<EventMonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.agentStates = new Map();
    this.eventHistory = [];
    this.eventHandlers = [];
    this.anomalyHandlers = [];
    this.intervalId = null;
    this.ledgerClient = null;
    this.isRunning = false;
  }

  /**
   * Ledgerクライアントを設定
   */
  setLedgerClient(client: LedgerClient): void {
    this.ledgerClient = client;
  }

  /**
   * 監視を開始
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // 定期的なチェックポイント確認
    this.intervalId = setInterval(() => {
      this.checkCheckpoints().catch((err) => {
        console.error('Checkpoint check error:', err);
      });
    }, this.config.checkpointInterval);

    // 初回チェック
    await this.checkCheckpoints();
  }

  /**
   * 監視を停止
   */
  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }

  /**
   * チェックポイント確認
   */
  private async checkCheckpoints(): Promise<void> {
    if (!this.ledgerClient) {
      return;
    }

    try {
      // 全Agentまたは指定Agentのチェックポイントを確認
      const targetAgents = this.config.targetAgentIds ||
        Array.from(this.agentStates.keys());

      for (const agentId of targetAgents) {
        await this.checkAgentCheckpoint(agentId);
      }
    } catch (error) {
      console.error('Error checking checkpoints:', error);
    }
  }

  /**
   * 特定Agentのチェックポイント確認
   */
  private async checkAgentCheckpoint(agentId: IdString): Promise<EventMonitorResult> {
    const state = this.agentStates.get(agentId);
    const sinceCheckpoint = state?.last_known_checkpoint;

    const result = await this.ledgerClient!.getAgentEvents(agentId, {
      sinceCheckpoint,
      maxEvents: 100,
    });

    const newEvents: WatchedEvent[] = [];
    const anomalies: AnomalyInfo[] = [];

    for (const event of result.events) {
      const watchedEvent = this.convertToWatchedEvent(event);

      // イベント処理
      const validation = this.validateEvent(watchedEvent, state);

      if (validation.anomaly) {
        anomalies.push(validation.anomaly);
        await this.notifyAnomaly(validation.anomaly);
      }

      newEvents.push(watchedEvent);
      this.addToHistory(watchedEvent);
      await this.notifyEvent(watchedEvent);
    }

    // Agent状態更新
    if (result.events.length > 0) {
      this.updateAgentState(agentId, result.checkpoint, result.events);
    }

    return {
      new_events: newEvents,
      current_checkpoint: result.checkpoint,
      anomalies,
    };
  }

  /**
   * イベントを変換
   */
  private convertToWatchedEvent(event: Record<string, unknown>): WatchedEvent {
    return {
      event_id: event.event_id as IdString,
      event_type: event.event_type as LedgerEventType,
      agent_id: event.agent_id as IdString,
      controller_id: event.controller_id as IdString,
      event_time: event.event_time as string,
      recorded_at: event.recorded_at as string,
      sequence: event.sequence as number,
      ledger_checkpoint: event.ledger_checkpoint as string,
      prev_event_hash: event.prev_event_hash as string | undefined,
      payload: event.payload as Record<string, unknown>,
    };
  }

  /**
   * イベント検証
   */
  private validateEvent(
    event: WatchedEvent,
    state: AgentCheckpointState | undefined
  ): { valid: boolean; anomaly?: AnomalyInfo } {
    const now = new Date().toISOString();

    // シーケンスギャップチェック
    if (state && event.sequence > 0) {
      const expectedSequence = state.last_known_sequence + 1;
      if (event.sequence > expectedSequence) {
        return {
          valid: true, // ギャップがあってもイベント自体は有効
          anomaly: {
            type: 'SEQUENCE_GAP',
            agent_id: event.agent_id,
            details: {
              expected_sequence: expectedSequence,
              actual_sequence: event.sequence,
              gap: event.sequence - expectedSequence,
            },
            detected_at: now,
          },
        };
      }
    }

    // チェックポイントロールバックチェック
    if (state && event.ledger_checkpoint) {
      if (this.isCheckpointOlder(event.ledger_checkpoint, state.last_known_checkpoint)) {
        return {
          valid: true,
          anomaly: {
            type: 'CHECKPOINT_ROLLBACK',
            agent_id: event.agent_id,
            details: {
              current_checkpoint: state.last_known_checkpoint,
              event_checkpoint: event.ledger_checkpoint,
            },
            detected_at: now,
          },
        };
      }
    }

    // 前イベントハッシュ不一致チェック
    if (state && event.prev_event_hash && state.lastEventHash) {
      if (event.prev_event_hash !== state.lastEventHash) {
        return {
          valid: true,
          anomaly: {
            type: 'PREV_HASH_MISMATCH',
            agent_id: event.agent_id,
            details: {
              expected_hash: state.lastEventHash,
              actual_hash: event.prev_event_hash,
            },
            detected_at: now,
          },
        };
      }
    }

    // イベント種別フィルタリング
    if (this.config.eventTypes && this.config.eventTypes.length > 0) {
      if (!this.config.eventTypes.includes(event.event_type)) {
        return { valid: true }; // フィルタ対象外
      }
    }

    return { valid: true };
  }

  /**
   * チェックポイントが古いかどうかを判定
   */
  private isCheckpointOlder(checkpoint: string, comparedTo: string): boolean {
    const numA = this.extractCheckpointNumber(checkpoint);
    const numB = this.extractCheckpointNumber(comparedTo);
    return numA < numB;
  }

  /**
   * チェックポイント番号を抽出
   */
  private extractCheckpointNumber(checkpoint: string): number {
    const match = checkpoint.match(/chk_(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Agent状態を更新
   */
  private updateAgentState(
    agentId: IdString,
    checkpoint: string,
    events: Record<string, unknown>[]
  ): void {
    const currentState = this.agentStates.get(agentId);
    const lastEvent = events[events.length - 1];
    const now = new Date().toISOString();

    const checkpointInfo: CheckpointInfo = {
      checkpoint,
      observed_at: now,
      event_count: events.length,
    };

    const lastSequence = typeof lastEvent.sequence === 'number' ? lastEvent.sequence : 0;
    const lastLedgerCheckpoint = typeof lastEvent.ledger_checkpoint === 'string' ? lastEvent.ledger_checkpoint : checkpoint;

    if (currentState) {
      currentState.last_known_checkpoint = checkpoint;
      currentState.last_known_sequence = lastSequence;
      currentState.last_observed_at = now;
      currentState.checkpoints_history.push(checkpointInfo);

      // 履歴サイズ制限
      if (currentState.checkpoints_history.length > 100) {
        currentState.checkpoints_history = currentState.checkpoints_history.slice(-100);
      }

      // 最終イベントハッシュを更新
      currentState.lastEventHash = this.calculateEventHash(this.convertToWatchedEvent(lastEvent));
    } else {
      this.agentStates.set(agentId, {
        agent_id: agentId,
        last_known_checkpoint: checkpoint,
        last_known_sequence: lastSequence,
        last_observed_at: now,
        checkpoints_history: [checkpointInfo],
        lastEventHash: this.calculateEventHash(this.convertToWatchedEvent(lastEvent)),
      });
    }
  }

  /**
   * イベントハッシュを計算
   */
  private calculateEventHash(event: WatchedEvent): string {
    const data = JSON.stringify({
      event_id: event.event_id,
      event_type: event.event_type,
      agent_id: event.agent_id,
      sequence: event.sequence,
      event_time: event.event_time,
    });
    // 簡易ハッシュ (実際の実装ではcrypto等を使用)
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `hash_${Math.abs(hash).toString(16)}`;
  }

  /**
   * 履歴に追加
   */
  private addToHistory(event: WatchedEvent): void {
    this.eventHistory.push(event);

    // 履歴サイズ制限
    if (this.eventHistory.length > this.config.maxHistorySize) {
      const cutoff = this.eventHistory.length - this.config.maxHistorySize;
      this.eventHistory = this.eventHistory.slice(cutoff);
    }

    // 古い履歴を削除
    const cutoffTime = Date.now() - this.config.retentionPeriod;
    this.eventHistory = this.eventHistory.filter(
      (e) => new Date(e.recorded_at).getTime() > cutoffTime
    );
  }

  /**
   * イベント通知
   */
  private async notifyEvent(event: WatchedEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error('Event handler error:', error);
      }
    }
  }

  /**
   * 異常通知
   */
  private async notifyAnomaly(anomaly: AnomalyInfo): Promise<void> {
    for (const handler of this.anomalyHandlers) {
      try {
        await handler(anomaly);
      } catch (error) {
        console.error('Anomaly handler error:', error);
      }
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * イベントハンドラを登録
   */
  addEventHandler(handler: EventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * 異常ハンドラを登録
   */
  addAnomalyHandler(handler: AnomalyHandler): void {
    this.anomalyHandlers.push(handler);
  }

  /**
   * Agent状態を取得
   */
  getAgentState(agentId: IdString): AgentCheckpointState | undefined {
    return this.agentStates.get(agentId);
  }

  /**
   * 現在のチェックポイントを取得
   */
  getCurrentCheckpoint(agentId?: IdString): string | undefined {
    if (agentId) {
      return this.agentStates.get(agentId)?.last_known_checkpoint;
    }
    return undefined;
  }

  /**
   * イベント履歴を取得
   */
  getEventHistory(options?: {
    agentId?: IdString;
    eventType?: LedgerEventType;
    since?: string;
    limit?: number;
  }): WatchedEvent[] {
    let events = [...this.eventHistory];

    if (options?.agentId) {
      events = events.filter((e) => e.agent_id === options.agentId);
    }

    if (options?.eventType) {
      events = events.filter((e) => e.event_type === options.eventType);
    }

    if (options?.since) {
      const sinceTime = new Date(options.since).getTime();
      events = events.filter((e) => new Date(e.recorded_at).getTime() >= sinceTime);
    }

    events.sort((a, b) =>
      new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
    );

    if (options?.limit) {
      events = events.slice(0, options.limit);
    }

    return events;
  }

  /**
   * 手動でイベントを投入
   */
  async ingestEvent(event: WatchedEvent): Promise<EventMonitorResult> {
    const state = this.agentStates.get(event.agent_id);
    const validation = this.validateEvent(event, state);

    const anomalies: AnomalyInfo[] = [];
    if (validation.anomaly) {
      anomalies.push(validation.anomaly);
      await this.notifyAnomaly(validation.anomaly);
    }

    this.addToHistory(event);
    await this.notifyEvent(event);

    // Agent状態更新
    if (!this.agentStates.has(event.agent_id)) {
      this.agentStates.set(event.agent_id, {
        agent_id: event.agent_id,
        last_known_checkpoint: event.ledger_checkpoint,
        last_known_sequence: event.sequence,
        last_observed_at: new Date().toISOString(),
        checkpoints_history: [{
          checkpoint: event.ledger_checkpoint,
          observed_at: new Date().toISOString(),
          event_count: 1,
        }],
        lastEventHash: this.calculateEventHash(event),
      });
    } else {
      const currentState = this.agentStates.get(event.agent_id)!;
      currentState.last_known_checkpoint = event.ledger_checkpoint;
      currentState.last_known_sequence = event.sequence;
      currentState.last_observed_at = new Date().toISOString();
      currentState.lastEventHash = this.calculateEventHash(event);
    }

    return {
      new_events: [event],
      current_checkpoint: event.ledger_checkpoint,
      anomalies,
    };
  }

  /**
   * 重複イベント競合をチェック
   */
  checkDuplicateConflict(event: WatchedEvent): AnomalyInfo | null {
    const existing = this.eventHistory.find(
      (e) =>
        e.event_id === event.event_id &&
        (e.sequence !== event.sequence ||
          JSON.stringify(e.payload) !== JSON.stringify(event.payload))
    );

    if (existing) {
      return {
        type: 'DUPLICATE_EVENT_CONFLICT',
        agent_id: event.agent_id,
        details: {
          event_id: event.event_id,
          existing_sequence: existing.sequence,
          new_sequence: event.sequence,
          existing_payload_hash: this.calculateEventHash(existing),
          new_payload_hash: this.calculateEventHash(event),
        },
        detected_at: new Date().toISOString(),
      };
    }

    return null;
  }

  /**
   * 監視状態をリセット
   */
  reset(): void {
    this.agentStates.clear();
    this.eventHistory = [];
  }
}

/**
 * Ledgerクライアントインターフェース
 */
export interface LedgerClient {
  getAgentEvents(
    agentId: IdString,
    options?: {
      sinceCheckpoint?: string;
      maxEvents?: number;
    }
  ): Promise<{
    events: Record<string, unknown>[];
    checkpoint: string;
    hasMore: boolean;
  }>;

  getCheckpoint(): Promise<string>;
}

/**
 * HTTP経由のLedgerクライアント実装
 */
export class HttpLedgerClient implements LedgerClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async getAgentEvents(
    agentId: IdString,
    options?: { sinceCheckpoint?: string; maxEvents?: number }
  ): Promise<{ events: Record<string, unknown>[]; checkpoint: string; hasMore: boolean }> {
    const params = new URLSearchParams();
    if (options?.sinceCheckpoint) {
      params.append('since', options.sinceCheckpoint);
    }
    if (options?.maxEvents) {
      params.append('limit', options.maxEvents.toString());
    }

    const url = `${this.baseUrl}/agents/${agentId}/events?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch events: ${response.statusText}`);
    }

    return response.json();
  }

  async getCheckpoint(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/checkpoint`);

    if (!response.ok) {
      throw new Error(`Failed to fetch checkpoint: ${response.statusText}`);
    }

    const data = await response.json();
    return data.checkpoint;
  }
}