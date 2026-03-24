/**
 * Split-view Detector - Split-view検知
 * @see ../../../specs/ledger/events.md (Section 6: Checkpoint)
 * @see ../../../specs/core/interfaces.md (Section 13: Watcher Notification Interface)
 */

import type {
  SplitViewDetectorConfig,
  SplitViewDetectionResult,
  CheckpointConflict,
  WatchedEvent,
  AgentCheckpointState,
  VersionVector,
  VersionCheckResult,
  IdString,
  AlertType,
} from './types.js';
import type { EventMonitor } from './event-monitor.js';

/** デフォルト設定 */
const DEFAULT_CONFIG: SplitViewDetectorConfig = {
  conflictGracePeriod: 60000, // 1分
  comparisonDepth: 10,
  autoAlertEnabled: true,
};

/**
 * Split-view検知クラス
 * チェックポイントの矛盾を検知し、split-viewの疑いを判定する
 */
export class SplitViewDetector {
  private config: SplitViewDetectorConfig;
  private conflicts: Map<IdString, CheckpointConflict[]>;
  private versionVectors: Map<IdString, VersionVector>;
  private eventMonitor: EventMonitor | null;
  private alertCallback: ((alert: SplitViewAlert) => void | Promise<void>) | null;

  constructor(config: Partial<SplitViewDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.conflicts = new Map();
    this.versionVectors = new Map();
    this.eventMonitor = null;
    this.alertCallback = null;
  }

  /**
   * EventMonitorを設定
   */
  setEventMonitor(monitor: EventMonitor): void {
    this.eventMonitor = monitor;
  }

  /**
   * アラートコールバックを設定
   */
  setAlertCallback(callback: (alert: SplitViewAlert) => void | Promise<void>): void {
    this.alertCallback = callback;
  }

  /**
   * Agentのチェックポイントを分析し、split-viewを検知
   */
  async analyze(agentId: IdString): Promise<SplitViewDetectionResult> {
    const state = this.eventMonitor?.getAgentState(agentId);

    if (!state) {
      return {
        suspected: false,
        confidence: 0,
        conflicts: [],
        checkpoints_analyzed: 0,
      };
    }

    const conflicts = this.detectConflicts(state);
    const suspected = conflicts.length > 0;
    const confidence = this.calculateConfidence(conflicts);

    // 矛盾が検出された場合、保存
    if (conflicts.length > 0) {
      this.saveConflicts(agentId, conflicts);

      // アラート生成
      if (this.config.autoAlertEnabled && this.alertCallback) {
        for (const conflict of conflicts) {
          const alert = this.createAlertFromConflict(conflict);
          await this.alertCallback(alert);
        }
      }
    }

    return {
      suspected,
      confidence,
      conflicts,
      checkpoints_analyzed: state.checkpoints_history.length,
    };
  }

  /**
   * チェックポイント矛盾を検知
   */
  private detectConflicts(state: AgentCheckpointState): CheckpointConflict[] {
    const conflicts: CheckpointConflict[] = [];
    const history = state.checkpoints_history;

    if (history.length < 2) {
      return conflicts;
    }

    // チェックポイント履歴を分析
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];

      // 同じチェックポイント番号で異なるハッシュ
      const prevNum = this.extractCheckpointNumber(prev.checkpoint);
      const currNum = this.extractCheckpointNumber(curr.checkpoint);

      if (prevNum === currNum && prev.root_hash && curr.root_hash) {
        if (prev.root_hash !== curr.root_hash) {
          conflicts.push({
            conflict_id: `conflict_${Date.now()}_${i}`,
            agent_id: state.agent_id,
            checkpoint_a: prev.checkpoint,
            checkpoint_b: curr.checkpoint,
            conflict_type: 'SAME_SEQUENCE_DIFFERENT_HASH',
            detected_at: new Date().toISOString(),
            related_events: [],
          });
        }
      }

      // ブランチ検出 (チェックポイント番号が減少)
      if (currNum < prevNum) {
        conflicts.push({
          conflict_id: `conflict_${Date.now()}_${i}`,
          agent_id: state.agent_id,
          checkpoint_a: prev.checkpoint,
          checkpoint_b: curr.checkpoint,
          conflict_type: 'BRANCH_DETECTED',
          detected_at: new Date().toISOString(),
          related_events: [],
        });
      }
    }

    return conflicts;
  }

  /**
   * 信頼度を計算
   */
  private calculateConfidence(conflicts: CheckpointConflict[]): number {
    if (conflicts.length === 0) {
      return 0;
    }

    // 矛盾の種類と数に基づいて信頼度を計算
    let score = 0;

    for (const conflict of conflicts) {
      switch (conflict.conflict_type) {
        case 'SAME_SEQUENCE_DIFFERENT_HASH':
          score += 0.9; // 高信頼度
          break;
        case 'BRANCH_DETECTED':
          score += 0.7;
          break;
        case 'TIMESTAMP_INCONSISTENT':
          score += 0.5;
          break;
      }
    }

    // 複数の矛盾がある場合は信頼度を上げる
    const multiplier = Math.min(1 + (conflicts.length - 1) * 0.1, 1.5);

    return Math.min(score * multiplier / conflicts.length, 1.0);
  }

  /**
   * チェックポイント番号を抽出
   */
  private extractCheckpointNumber(checkpoint: string): number {
    const match = checkpoint.match(/chk_(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * 矛盾を保存
   */
  private saveConflicts(agentId: IdString, conflicts: CheckpointConflict[]): void {
    if (!this.conflicts.has(agentId)) {
      this.conflicts.set(agentId, []);
    }
    this.conflicts.get(agentId)!.push(...conflicts);
  }

  /**
   * アラートを生成
   */
  private createAlertFromConflict(conflict: CheckpointConflict): SplitViewAlert {
    let alertType: AlertType;
    let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

    switch (conflict.conflict_type) {
      case 'SAME_SEQUENCE_DIFFERENT_HASH':
        alertType = 'SPLIT_VIEW_SUSPECTED';
        severity = 'CRITICAL';
        break;
      case 'BRANCH_DETECTED':
        alertType = 'ROLLBACK_SUSPECTED';
        severity = 'HIGH';
        break;
      case 'TIMESTAMP_INCONSISTENT':
        alertType = 'CHECKPOINT_CONFLICT';
        severity = 'MEDIUM';
        break;
      default:
        alertType = 'CHECKPOINT_CONFLICT';
        severity = 'MEDIUM';
    }

    return {
      alert_id: `alt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      agent_id: conflict.agent_id,
      alert_type: alertType,
      detected_at: conflict.detected_at,
      severity,
      evidence_refs: [conflict.checkpoint_a, conflict.checkpoint_b],
      recommended_action: this.determineRecommendedAction(severity),
      details: {
        conflict_type: conflict.conflict_type,
        conflict_id: conflict.conflict_id,
      },
    };
  }

  /**
   * 推奨アクションを決定
   */
  private determineRecommendedAction(
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  ): 'HOLD_HIGH_RISK_OPERATIONS' | 'INVESTIGATE' | 'TERMINATE_SESSIONS' | 'NOTIFY_OPERATOR' {
    switch (severity) {
      case 'CRITICAL':
        return 'HOLD_HIGH_RISK_OPERATIONS';
      case 'HIGH':
        return 'TERMINATE_SESSIONS';
      case 'MEDIUM':
        return 'INVESTIGATE';
      default:
        return 'NOTIFY_OPERATOR';
    }
  }

  /**
   * バージョンベクトルを比較してロールバックを検知
   */
  compareVersionVectors(
    current: VersionVector,
    observed: VersionVector
  ): VersionCheckResult {
    const result: VersionCheckResult = {
      rollback_detected: false,
      epoch_mismatch: false,
      session_epoch_old: false,
      policy_mismatch: false,
      details: {},
    };

    // identity_version の減少チェック
    if (observed.identity_version < current.identity_version) {
      result.rollback_detected = true;
      result.details.identity_version_rollback = {
        current: current.identity_version,
        observed: observed.identity_version,
      };
    }

    // revocation_epoch の減少チェック
    if (observed.revocation_epoch < current.revocation_epoch) {
      result.epoch_mismatch = true;
      result.details.revocation_epoch_rollback = {
        current: current.revocation_epoch,
        observed: observed.revocation_epoch,
      };
    }

    // policy_epoch の不一致
    if (current.policy_epoch !== undefined && observed.policy_epoch !== undefined) {
      if (observed.policy_epoch < current.policy_epoch) {
        result.policy_mismatch = true;
        result.details.policy_epoch_mismatch = {
          current: current.policy_epoch,
          observed: observed.policy_epoch,
        };
      }
    }

    // session_epoch の古さ
    if (current.session_epoch !== undefined && observed.session_epoch !== undefined) {
      if (observed.session_epoch < current.session_epoch) {
        result.session_epoch_old = true;
        result.details.session_epoch_old = {
          current: current.session_epoch,
          observed: observed.session_epoch,
        };
      }
    }

    // ledger_checkpoint の比較
    if (current.ledger_checkpoint && observed.ledger_checkpoint) {
      const currentNum = this.extractCheckpointNumber(current.ledger_checkpoint);
      const observedNum = this.extractCheckpointNumber(observed.ledger_checkpoint);

      if (observedNum < currentNum) {
        result.rollback_detected = true;
        result.details.checkpoint_rollback = {
          current: current.ledger_checkpoint,
          observed: observed.ledger_checkpoint,
        };
      }
    }

    return result;
  }

  /**
   * Agentのバージョンベクトルを更新
   */
  updateVersionVector(agentId: IdString, vector: VersionVector): void {
    this.versionVectors.set(agentId, vector);
  }

  /**
   * Agentのバージョンベクトルを取得
   */
  getVersionVector(agentId: IdString): VersionVector | undefined {
    return this.versionVectors.get(agentId);
  }

  /**
   * イベントシーケンスの矛盾を検知
   */
  detectSequenceConflicts(events: WatchedEvent[]): CheckpointConflict[] {
    const conflicts: CheckpointConflict[] = [];
    const sequenceMap = new Map<number, WatchedEvent[]>();

    // シーケンス番号でグループ化
    for (const event of events) {
      const seq = event.sequence;
      if (!sequenceMap.has(seq)) {
        sequenceMap.set(seq, []);
      }
      sequenceMap.get(seq)!.push(event);
    }

    // 同じシーケンスで異なるイベントを検出
    for (const [sequence, eventsAtSeq] of sequenceMap) {
      if (eventsAtSeq.length > 1) {
        // 異なるイベント内容をチェック
        const uniquePayloads = new Set(
          eventsAtSeq.map((e) => JSON.stringify(e.payload))
        );

        if (uniquePayloads.size > 1) {
          conflicts.push({
            conflict_id: `seq_conflict_${Date.now()}_${sequence}`,
            agent_id: eventsAtSeq[0].agent_id,
            checkpoint_a: eventsAtSeq[0].ledger_checkpoint,
            checkpoint_b: eventsAtSeq[1].ledger_checkpoint,
            conflict_type: 'SAME_SEQUENCE_DIFFERENT_HASH',
            detected_at: new Date().toISOString(),
            related_events: eventsAtSeq,
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * 矛合履歴を取得
   */
  getConflictHistory(agentId?: IdString): CheckpointConflict[] {
    if (agentId) {
      return this.conflicts.get(agentId) || [];
    }

    const allConflicts: CheckpointConflict[] = [];
    for (const conflicts of this.conflicts.values()) {
      allConflicts.push(...conflicts);
    }
    return allConflicts.sort((a, b) =>
      new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
    );
  }

  /**
   * 全Agentを分析
   */
  async analyzeAll(): Promise<Map<IdString, SplitViewDetectionResult>> {
    const results = new Map<IdString, SplitViewDetectionResult>();

    if (!this.eventMonitor) {
      return results;
    }

    // EventMonitorから全Agent IDを取得
    // (EventMonitorにgetAgentIdsメソッドを追加するか、別の方法で取得)
    // ここでは簡易的に、既知のAgentに対して分析を行う

    for (const agentId of this.conflicts.keys()) {
      const result = await this.analyze(agentId);
      results.set(agentId, result);
    }

    return results;
  }

  /**
   * 検知状態をリセット
   */
  reset(): void {
    this.conflicts.clear();
    this.versionVectors.clear();
  }
}

/**
 * Split-viewアラート
 */
export interface SplitViewAlert {
  alert_id: IdString;
  agent_id: IdString;
  alert_type: AlertType;
  detected_at: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  evidence_refs: string[];
  recommended_action: string;
  details: Record<string, unknown>;
}

/**
 * ユーティリティ: チェックポイントを比較
 */
export function compareCheckpoints(a: string, b: string): -1 | 0 | 1 {
  const numA = parseInt(a.replace('chk_', ''), 10) || 0;
  const numB = parseInt(b.replace('chk_', ''), 10) || 0;

  if (numA < numB) return -1;
  if (numA > numB) return 1;
  return 0;
}

/**
 * ユーティリティ: チェックポイントがロールバックかどうか
 */
export function isCheckpointRollback(
  observedCheckpoint: string,
  knownCheckpoint: string
): boolean {
  return compareCheckpoints(observedCheckpoint, knownCheckpoint) < 0;
}