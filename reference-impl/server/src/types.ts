/**
 * AITuber相互認証・交流プロトコル Server型定義
 * @see ../../schemas/core/common.schema.json
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

/** 隔離レベル */
export type QuarantineLevel =
  | 'none'
  | 'soft'
  | 'hard'
  | 'full';

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

/** リスクレベル */
export type RiskLevel = 'low' | 'high';

/** 信頼レベル */
export type TrustLevel =
  | 'first_seen'
  | 'known'
  | 'verified'
  | 'restricted';

/** 時刻健全性状態 */
export type TimeHealthStatus =
  | 'healthy'
  | 'skewed'
  | 'untrusted'
  | 'unknown';

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

/** Freshness状態 */
export type FreshnessStatus =
  | 'fresh'
  | 'stale'
  | 'unknown'
  | 'inconsistent';

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
export interface ServiceEndpoint {
  name: string;
  url: UriString;
  kind: string;
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

/** Version Vector (単調増加確認用) */
export interface VersionVector {
  identity_version: NonNegativeInteger;
  revocation_epoch: NonNegativeInteger;
  policy_epoch?: NonNegativeInteger;
  session_epoch?: NonNegativeInteger;
  ledger_checkpoint?: string;
}

/** Capability Digest */
export interface CapabilityDigest {
  capabilities: CapabilityName[];
  capability_digest: HashString;
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
// Error Codes
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
    risk_level: RiskLevel;
    details: Record<string, unknown>;
  };
}