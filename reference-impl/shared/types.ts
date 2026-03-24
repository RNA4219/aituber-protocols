/**
 * AITuber相互認証・交流プロトコル 共通型定義
 * Client/Server/Watcher共通で使用される型
 * @see ../specs/core/interfaces.md
 */

// ============================================================================
// Basic Types
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

/** URI文字列 */
export type UriString = string;

// ============================================================================
// Enums
// ============================================================================

/** プラットフォーム種別 */
export type PlatformType =
  | 'x'
  | 'youtube'
  | 'discord'
  | 'misskey'
  | 'twitch'
  | 'web'
  | 'other';

/** Binding状態 */
export type BindingStatus =
  | 'active'
  | 'pending'
  | 'removed'
  | 'revoked'
  | 'quarantined';

/** Agent状態 */
export type AgentStatus =
  | 'active'
  | 'quarantined'
  | 'recovered'
  | 'revoked'
  | 'suspended';

/** Session状態 */
export type SessionStatus =
  | 'active'
  | 'renewing'
  | 'expired'
  | 'terminated';

/** Session終了理由 */
export type SessionTerminationReason =
  | 'expired'
  | 'manual_termination'
  | 'revocation_epoch_increased'
  | 'policy_epoch_increased'
  | 'high_risk_reauth_required'
  | 'quarantine'
  | 'rollback_suspected';

/** セッション終了理由コード */
export type SessionReasonCode =
  | 'EXPIRED'
  | 'MANUAL_TERMINATION'
  | 'REVOCATION_EPOCH_INCREASED'
  | 'POLICY_EPOCH_INCREASED'
  | 'HIGH_RISK_REAUTH_REQUIRED'
  | 'QUARANTINE'
  | 'ROLLBACK_SUSPECTED';

/** リスクレベル */
export type RiskLevel = 'low' | 'high';

/** 信頼レベル */
export type TrustLevel =
  | 'first_seen'
  | 'known'
  | 'verified'
  | 'restricted';

/** Freshness状態 */
export type FreshnessStatus =
  | 'fresh'
  | 'stale'
  | 'unknown'
  | 'inconsistent';

/** 隔離レベル */
export type QuarantineLevel = 'none' | 'soft' | 'hard' | 'full';

/** 鍵スコープ */
export type KeyScope =
  | 'root'
  | 'operation'
  | 'session'
  | 'recovery'
  | 'watcher'
  | 'other';

/** 鍵状態 */
export type KeyStatus =
  | 'active'
  | 'rotating'
  | 'revoked'
  | 'expired'
  | 'suspected';

/** 解決ステータス */
export type ResolutionStatus =
  | 'RESOLVED'
  | 'NOT_FOUND'
  | 'BINDING_MISMATCH'
  | 'UNTRUSTED_REDIRECT'
  | 'INVALID_MANIFEST_SIGNATURE'
  | 'ROLLBACK_SUSPECTED';

/** 検証ステータス */
export type VerificationStatus =
  | 'VERIFIED'
  | 'REJECTED'
  | 'DEFERRED';

/** Capability状態 */
export type CapabilityStatus =
  | 'MATCHED'
  | 'MISMATCHED'
  | 'DOWNGRADED';

/** ステータスタイプ */
export type StatusType =
  | 'ACTIVE'
  | 'DEGRADED'
  | 'QUARANTINED'
  | 'RECOVERING'
  | 'TERMINATING';

/** 警告タイプ */
export type WarningType =
  | 'OPERATION_KEY_COMPROMISED'
  | 'SESSION_KEY_COMPROMISED'
  | 'BINDING_COMPROMISED'
  | 'POLICY_VIOLATION';

/** コラボ拒否理由コード */
export type CollabRejectReasonCode =
  | 'POLICY_DECLINED'
  | 'CAPABILITY_MISMATCH'
  | 'BUSY'
  | 'NOT_INTERESTED';

/** コラボ延期理由コード */
export type CollabDeferReasonCode =
  | 'MANUAL_REVIEW_REQUIRED'
  | 'PENDING_APPROVAL'
  | 'SCHEDULE_CONFLICT';

/** Recovery状態 */
export type RecoveryState =
  | 'none'
  | 'initiated'
  | 'in_progress'
  | 'completed';

/** Compromise状態 */
export type CompromiseState =
  | 'none'
  | 'suspected'
  | 'confirmed'
  | 'historical';

/** 時刻健全性状態 */
export type TimeHealthStatus =
  | 'healthy'
  | 'skewed'
  | 'untrusted'
  | 'unknown';

// ============================================================================
// Composite Types
// ============================================================================

/** 署名 */
export interface Signature {
  key_id: IdString;
  algorithm: string;
  canonicalization: string;
  value: string;
}

/** 鍵参照 */
export interface KeyRef {
  key_id: IdString;
  scope: KeyScope;
  algorithm: string;
  public_key: string;
  status: KeyStatus;
  valid_from: Timestamp;
  valid_until?: Timestamp;
}

/** プラットフォームバインディング */
export interface PlatformBinding {
  platform_type: PlatformType;
  platform_account_id: string;
  display_handle: string;
  binding_status: BindingStatus;
  verified_at: Timestamp;
  bound_by_key_id: IdString;
  binding_version: NonNegativeInteger;
}

/** サービスエンドポイント */
export interface ServiceEndpoints {
  auth_endpoint?: UriString;
  exchange_endpoint?: UriString;
  revocation_endpoint?: UriString;
  ledger_endpoint?: UriString;
}

/** Capability名 */
export type CapabilityName = string;

/** Capability要約 */
export interface CapabilitySummary {
  capabilities: CapabilityName[];
  capability_digest: HashString;
}

/** Epoch束 */
export interface EpochBundle {
  identity_version: NonNegativeInteger;
  revocation_epoch: NonNegativeInteger;
  policy_epoch: NonNegativeInteger;
  session_epoch: NonNegativeInteger;
  ledger_checkpoint: string;
}

/** Version Vector */
export interface VersionVector {
  identity_version: NonNegativeInteger;
  revocation_epoch: NonNegativeInteger;
  policy_epoch?: NonNegativeInteger;
  session_epoch?: NonNegativeInteger;
  ledger_checkpoint?: string;
}

/** High-Risk用Epoch束 */
export interface HighRiskEpochBundle {
  identity_version: NonNegativeInteger;
  revocation_epoch: NonNegativeInteger;
  policy_epoch: NonNegativeInteger;
  session_epoch: NonNegativeInteger;
  ledger_checkpoint: string;
}

// ============================================================================
// Core Entities
// ============================================================================

/** Agent識別子参照 */
export interface AgentIdentityRef {
  controller_id?: IdString;
  agent_id: IdString;
  persona_id?: IdString;
  instance_id: IdString;
}

// ============================================================================
// Event Types
// ============================================================================

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

/** 鍵失効理由 */
export type KeyRevocationReason =
  | 'compromised'
  | 'rotated'
  | 'expired'
  | 'superseded'
  | 'policy_change'
  | 'operator_request'
  | 'unknown';

// ============================================================================
// Error Types
// ============================================================================

/** 認証エラーコード */
export type AuthErrorCode =
  | 'INVALID_SIGNATURE'
  | 'NONCE_EXPIRED'
  | 'NONCE_REPLAYED'
  | 'TIMESTAMP_INVALID'
  | 'KEY_REVOKED'
  | 'AGENT_QUARANTINED'
  | 'BINDING_MISMATCH'
  | 'POLICY_MISMATCH'
  | 'STALE_REVOCATION_CACHE'
  | 'IDENTITY_ROLLBACK_DETECTED'
  | 'SESSION_EPOCH_OLD';

/** エラーレスポンス */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    risk_level?: RiskLevel;
    details?: Record<string, unknown>;
  };
}