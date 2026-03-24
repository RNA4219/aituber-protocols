/**
 * Watcher Types - 監視者関連の型定義
 * @see ../../../specs/core/interfaces.md (Watcher Notification Interface)
 * @see ../../../specs/ledger/events.md
 */

// ============================================================================
// Basic Types (re-exported for self-containment)
// ============================================================================

/** ID文字列 (3-128文字、英数字と._:-) */
export type IdString = string;

/** タイムスタンプ (ISO 8601) */
export type Timestamp = string;

/** 非負整数 */
export type NonNegativeInteger = number;

/** 正整数 */
export type PositiveInteger = number;

/** ハッシュ文字列 */
export type HashString = string;

// ============================================================================
// Alert Types
// ============================================================================

/** アラート種別 */
export type AlertType =
  | 'SPLIT_VIEW_SUSPECTED'
  | 'ROLLBACK_SUSPECTED'
  | 'STALE_REVOCATION_EXCESSIVE'
  | 'CHECKPOINT_CONFLICT'
  | 'UNEXPECTED_KEY_ROTATION'
  | 'RECOVERY_SEQUENCE_INVALID';

/** アラート重要度 */
export type WatcherSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** 推奨アクション */
export type RecommendedAction =
  | 'HOLD_HIGH_RISK_OPERATIONS'
  | 'INVESTIGATE'
  | 'TERMINATE_SESSIONS'
  | 'FORCE_REAUTH'
  | 'NOTIFY_OPERATOR'
  | 'TRIGGER_RECOVERY'
  | 'AUDIT_REQUIRED';

/** Watcherアラート */
export interface WatcherAlert {
  /** アラートID */
  alert_id: IdString;
  /** 対象Agent ID */
  agent_id: IdString;
  /** アラート種別 */
  alert_type: AlertType;
  /** 検知日時 */
  detected_at: Timestamp;
  /** 重要度 */
  severity: WatcherSeverity;
  /** エビデンス参照 (checkpoint IDs, event IDs等) */
  evidence_refs: string[];
  /** 推奨アクション */
  recommended_action: RecommendedAction;
  /** 詳細情報 */
  details?: Record<string, unknown>;
}

// ============================================================================
// Checkpoint Types
// ============================================================================

/** チェックポイント情報 */
export interface CheckpointInfo {
  /** チェックポイントID */
  checkpoint: string;
  /** 観測日時 */
  observed_at: Timestamp;
  /** イベント数 */
  event_count: NonNegativeInteger;
  /** ルートハッシュ (Merkle Tree等) */
  root_hash?: string;
  /** 署名済みツリーヘッド */
  signed_tree_head?: {
    signature: string;
    key_id: IdString;
  };
}

/** Agent別チェックポイント状態 */
export interface AgentCheckpointState {
  agent_id: IdString;
  last_known_checkpoint: string;
  last_known_sequence: NonNegativeInteger;
  last_observed_at: Timestamp;
  checkpoints_history: CheckpointInfo[];
  /** 最後のイベントハッシュ (prev_event_hash検証用) */
  lastEventHash?: string;
}

// ============================================================================
// Event Monitor Types
// ============================================================================

/** イベント監視設定 */
export interface EventMonitorConfig {
  /** 監視対象Agent IDs (未指定時は全Agent) */
  targetAgentIds?: IdString[];
  /** 監視するイベント種別 (未指定時は全種別) */
  eventTypes?: LedgerEventType[];
  /** チェックポイント確認間隔 (ミリ秒) */
  checkpointInterval: number;
  /** 履歴保持期間 (ミリ秒) */
  retentionPeriod: number;
  /** 最大履歴サイズ */
  maxHistorySize: number;
}

/** Ledgerイベント種別 */
export type LedgerEventType =
  | 'agent.created'
  | 'key.added'
  | 'key.revoked'
  | 'key.rotated'
  | 'binding.added'
  | 'binding.updated'
  | 'binding.removed'
  | 'compromise.reported'
  | 'agent.quarantined'
  | 'recovery.initiated'
  | 'recovery.completed'
  | 'policy.updated';

/** 監視イベント */
export interface WatchedEvent {
  event_id: IdString;
  event_type: LedgerEventType;
  agent_id: IdString;
  controller_id: IdString;
  event_time: Timestamp;
  recorded_at: Timestamp;
  sequence: NonNegativeInteger;
  ledger_checkpoint: string;
  prev_event_hash?: string;
  payload: Record<string, unknown>;
}

/** イベント監視結果 */
export interface EventMonitorResult {
  /** 新規イベント */
  new_events: WatchedEvent[];
  /** 現在のチェックポイント */
  current_checkpoint: string;
  /** 検出された異常 */
  anomalies: AnomalyInfo[];
}

/** 異常情報 */
export interface AnomalyInfo {
  /** 異常種別 */
  type: 'SEQUENCE_GAP' | 'CHECKPOINT_ROLLBACK' | 'DUPLICATE_EVENT_CONFLICT' | 'PREV_HASH_MISMATCH';
  /** 関連Agent ID */
  agent_id: IdString;
  /** 詳細 */
  details: Record<string, unknown>;
  /** 検出日時 */
  detected_at: Timestamp;
}

// ============================================================================
// Split-view Detector Types
// ============================================================================

/** Split-view検知設定 */
export interface SplitViewDetectorConfig {
  /** 矛盾検出の猶予時間 (ミリ秒) */
  conflictGracePeriod: number;
  /** 比較対象とするチェックポイント数 */
  comparisonDepth: number;
  /** 自動アラート生成を有効にするか */
  autoAlertEnabled: boolean;
}

/** チェックポイント矛盾 */
export interface CheckpointConflict {
  /** 矛盾ID */
  conflict_id: IdString;
  /** Agent ID */
  agent_id: IdString;
  /** 矛盾チェックポイント1 */
  checkpoint_a: string;
  /** 矛盾チェックポイント2 */
  checkpoint_b: string;
  /** 矛盾の種類 */
  conflict_type: 'SAME_SEQUENCE_DIFFERENT_HASH' | 'BRANCH_DETECTED' | 'TIMESTAMP_INCONSISTENT';
  /** 検出日時 */
  detected_at: Timestamp;
  /** 関連イベント */
  related_events: WatchedEvent[];
}

/** Split-view検知結果 */
export interface SplitViewDetectionResult {
  /** Split-viewの疑いがあるか */
  suspected: boolean;
  /** 信頼度 (0.0-1.0) */
  confidence: number;
  /** 検出された矛盾 */
  conflicts: CheckpointConflict[];
  /** 分析されたチェックポイント数 */
  checkpoints_analyzed: number;
}

// ============================================================================
// Alert Notifier Types
// ============================================================================

/** アラート通知設定 */
export interface AlertNotifierConfig {
  /** 通知先エンドポイント */
  endpoints?: AlertEndpoint[];
  /** アラートの重複排除期間 (ミリ秒) */
  deduplicationPeriod: number;
  /** 通知リトライ回数 */
  retryCount: number;
  /** 通知タイムアウト (ミリ秒) */
  timeout: number;
}

/** アラート通知エンドポイント */
export interface AlertEndpoint {
  /** エンドポイント名 */
  name: string;
  /** エンドポイントURL */
  url: string;
  /** 認証情報 */
  auth?: {
    type: 'bearer' | 'basic' | 'api-key';
    credentials: string;
  };
  /** 対象アラート種別 (未指定時は全種別) */
  alertTypes?: AlertType[];
  /** 対象重要度 (未指定時は全重要度) */
  severities?: WatcherSeverity[];
}

/** アラート通知結果 */
export interface AlertNotificationResult {
  /** 通知成功 */
  success: boolean;
  /** アラートID */
  alert_id: IdString;
  /** 通知先エンドポイント名 */
  endpoint_name: string;
  /** 通知日時 */
  notified_at: Timestamp;
  /** エラー情報 (失敗時) */
  error?: string;
}

// ============================================================================
// Event Subscription Types
// ============================================================================

/** イベント購読ハンドラ */
export type EventHandler = (event: WatchedEvent) => void | Promise<void>;

/** アラートハンドラ */
export type AlertHandler = (alert: WatcherAlert) => void | Promise<void>;

/** 異常ハンドラ */
export type AnomalyHandler = (anomaly: AnomalyInfo) => void | Promise<void>;

// ============================================================================
// Watcher Interface
// ============================================================================

/** Watcher インターフェース */
export interface Watcher {
  /** 監視を開始 */
  start(): Promise<void>;

  /** 監視を停止 */
  stop(): Promise<void>;

  /** 現在のチェックポイントを取得 */
  getCurrentCheckpoint(agentId?: IdString): string | undefined;

  /** アラートハンドラを登録 */
  onAlert(handler: AlertHandler): void;

  /** 異常ハンドラを登録 */
  onAnomaly(handler: AnomalyHandler): void;

  /** イベントハンドラを登録 */
  onEvent(handler: EventHandler): void;

  /** Agentの状態を取得 */
  getAgentState(agentId: IdString): AgentCheckpointState | undefined;

  /** アラート履歴を取得 */
  getAlertHistory(options?: {
    agentId?: IdString;
    alertType?: AlertType;
    since?: Timestamp;
    limit?: number;
  }): WatcherAlert[];
}

/** Watcher設定 */
export interface WatcherConfig {
  /** イベント監視設定 */
  monitor: EventMonitorConfig;
  /** Split-view検知設定 */
  detector: SplitViewDetectorConfig;
  /** アラート通知設定 */
  notifier: AlertNotifierConfig;
}

// ============================================================================
// Version Vector Types
// ============================================================================

/** バージョンベクトル (ロールバック検知用) */
export interface VersionVector {
  identity_version: NonNegativeInteger;
  revocation_epoch: NonNegativeInteger;
  policy_epoch?: NonNegativeInteger;
  session_epoch?: NonNegativeInteger;
  ledger_checkpoint?: string;
}

/** バージョン検査結果 */
export interface VersionCheckResult {
  /** ロールバック検知 */
  rollback_detected: boolean;
  /** エポック不一致 */
  epoch_mismatch: boolean;
  /** セッションエポック古い */
  session_epoch_old: boolean;
  /** ポリシー不一致 */
  policy_mismatch: boolean;
  /** 詳細情報 */
  details: Record<string, unknown>;
}