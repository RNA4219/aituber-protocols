/**
 * AITuber相互認証・交流プロトコル Client型定義
 * @see ../../specs/core/interfaces.md
 */

// ============================================================================
// Basic Types (re-exported for convenience)
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

/** Bootstrapステータス */
export type BootstrapStatus =
  | 'KNOWN_PEER'
  | 'FIRST_SEEN_LOW_RISK_ONLY'
  | 'FIRST_SEEN_RESTRICTED'
  | 'BOOTSTRAP_REJECTED';

/** 時刻健全性状態 */
export type TimeHealthStatus =
  | 'healthy'
  | 'skewed'
  | 'untrusted'
  | 'unknown';

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

/** 隔離レベル */
export type QuarantineLevel = 'none' | 'soft' | 'hard' | 'full';

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
  scope: 'root' | 'operation' | 'session' | 'recovery' | 'watcher' | 'other';
  algorithm: string;
  public_key: string;
  status: 'active' | 'rotating' | 'revoked' | 'expired' | 'suspected';
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

/** Identity Manifest */
export interface IdentityManifest {
  schema_version: string;
  agent_id: IdString;
  controller_id?: IdString;
  persona_id?: IdString;
  persona_profile_hash?: HashString;
  identity_version: NonNegativeInteger;
  operation_keys: KeyRef[];
  platform_bindings?: PlatformBinding[];
  service_endpoints?: ServiceEndpoints;
  revocation_ref?: UriString;
  ledger_ref?: UriString;
  revocation_epoch: NonNegativeInteger;
  policy_epoch?: NonNegativeInteger;
  last_updated_at: Timestamp;
  manifest_signature?: Signature;
}

// ============================================================================
// Challenge Types
// ============================================================================

/** Challenge受信データ */
export interface Challenge {
  challenge_id: IdString;
  target_agent_id: IdString;
  target_instance_id: IdString;
  nonce: string;
  issued_at: Timestamp;
  expires_at: Timestamp;
  verifier_session_pubkey?: string;
  intent: string;
  risk_level: RiskLevel;
  required_capabilities?: CapabilityName[];
  version_vector: EpochBundle;
  challenge_signature?: Signature;
}

/** Challenge発行リクエスト */
export interface IssueChallengeRequest {
  verifier_id: IdString;
  target_agent_id: IdString;
  target_instance_id: IdString;
  intent: string;
  required_capabilities?: CapabilityName[];
  risk_level: RiskLevel;
  session_pubkey?: string;
  nonce_ttl_seconds?: number;
}

/** Challenge発行レスポンス */
export interface IssueChallengeResponse {
  challenge_id: IdString;
  target_agent_id: IdString;
  target_instance_id: IdString;
  nonce: string;
  issued_at: Timestamp;
  expires_at: Timestamp;
  verifier_session_pubkey?: string;
  intent: string;
  risk_level: RiskLevel;
  required_capabilities?: CapabilityName[];
  version_vector: EpochBundle;
  challenge_signature?: Signature;
}

// ============================================================================
// Proof Types
// ============================================================================

/** Proof */
export interface Proof {
  spec_version: string;
  proof_id: IdString;
  challenge_id: IdString;
  agent_id: IdString;
  instance_id: IdString;
  nonce: string;
  timestamp: Timestamp;
  expires_at: Timestamp;
  intent: string;
  capability_digest: HashString;
  identity_version: NonNegativeInteger;
  revocation_epoch: NonNegativeInteger;
  policy_epoch: NonNegativeInteger;
  session_epoch: NonNegativeInteger;
  session_pubkey: {
    key_id: IdString;
    algorithm: string;
    public_key: string;
    valid_until?: Timestamp;
  };
  signature: Signature;
}

/** Proof検証リクエスト */
export interface VerifyProofRequest {
  challenge_id: IdString;
  proof: Proof;
}

/** Proof検証レスポンス */
export interface VerifyProofResponse {
  verification_status: VerificationStatus;
  verified_agent_id: IdString;
  verified_instance_id: IdString;
  risk_level: RiskLevel;
  freshness_status: FreshnessStatus;
  capability_status: CapabilityStatus;
  version_check: {
    rollback_detected: boolean;
    epoch_mismatch: boolean;
    session_epoch_old: boolean;
    policy_mismatch: boolean;
  };
  warnings: string[];
  errors: string[];
}

// ============================================================================
// Session Types
// ============================================================================

/** Session */
export interface Session {
  session_id: IdString;
  agent_id: IdString;
  instance_id: IdString;
  peer_agent_id: IdString;
  peer_instance_id: IdString;
  issued_at: Timestamp;
  expires_at: Timestamp;
  session_epoch: NonNegativeInteger;
  revocation_epoch: NonNegativeInteger;
  policy_epoch: NonNegativeInteger;
  sequence: NonNegativeInteger;
  effective_capabilities: CapabilityName[];
  session_status: SessionStatus;
}

/** Session作成リクエスト */
export interface CreateSessionRequest {
  verified_agent_id: IdString;
  verified_instance_id: IdString;
  peer_session_pubkey?: string;
  risk_level: RiskLevel;
  capability_summary: CapabilitySummary;
  version_vector: EpochBundle;
}

/** Session作成レスポンス */
export interface CreateSessionResponse {
  session_id: IdString;
  agent_id: IdString;
  instance_id: IdString;
  issued_at: Timestamp;
  expires_at: Timestamp;
  session_epoch: NonNegativeInteger;
  revocation_epoch: NonNegativeInteger;
  policy_epoch: NonNegativeInteger;
  sequence: NonNegativeInteger;
  effective_capabilities: CapabilityName[];
  session_status: 'ACTIVE' | 'DEGRADED' | 'REAUTH_REQUIRED' | 'TERMINATING' | 'TERMINATED';
}

/** Session更新リクエスト */
export interface RenewSessionRequest {
  session_id: IdString;
  agent_id: IdString;
  instance_id: IdString;
  current_sequence: NonNegativeInteger;
  reason: 'EXPIRY_APPROACHING' | 'HIGH_RISK_REAUTH' | 'CAPABILITY_CHANGE';
}

/** Session終了リクエスト */
export interface TerminateSessionRequest {
  session_id: IdString;
  reason_code: SessionReasonCode;
  reason_detail?: string;
}

// ============================================================================
// Identity Resolution Types
// ============================================================================

/** Discovery Source */
export interface DiscoverySource {
  platform_type: PlatformType;
  platform_account_id: string;
  display_handle: string;
}

/** Identity解決リクエスト */
export interface ResolveIdentityRequest {
  discovery_source: DiscoverySource;
  canonical_hint?: UriString;
  required_freshness: 'LOW' | 'HIGH';
}

/** Identity解決レスポンス */
export interface ResolveIdentityResponse {
  resolution_status: ResolutionStatus;
  identity_manifest_url?: UriString;
  identity_manifest?: IdentityManifest;
  binding_match?: boolean;
  warnings: string[];
}

// ============================================================================
// Freshness Types
// ============================================================================

/** Freshness確認リクエスト */
export interface CheckFreshnessRequest {
  agent_id: IdString;
  required_risk_level: RiskLevel;
  known_revocation_epoch: NonNegativeInteger;
  known_identity_version: NonNegativeInteger;
  known_ledger_checkpoint?: string;
}

/** Freshness確認レスポンス */
export interface CheckFreshnessResponse {
  freshness_status: FreshnessStatus;
  agent_status: AgentStatus;
  quarantine_status: 'NONE' | 'SOFT' | 'HARD';
  current_revocation_epoch: NonNegativeInteger;
  current_identity_version: NonNegativeInteger;
  current_policy_epoch?: NonNegativeInteger;
  ledger_checkpoint?: string;
  fresh_until?: Timestamp;
  warnings: string[];
}

// ============================================================================
// Exchange Message Types
// ============================================================================

/** Exchange Message共通envelope */
export interface ExchangeEnvelope {
  protocol_version: string;
  message_id: IdString;
  message_type: ExchangeMessageType;
  timestamp: Timestamp;
  agent_id: IdString;
  instance_id: IdString;
  session_id: IdString;
  sequence: NonNegativeInteger;
  signature_or_mac?: string;
  body: Record<string, unknown>;
}

/** Exchange Message Type一覧 */
export type ExchangeMessageType =
  | 'hello'
  | 'profile.request'
  | 'profile.response'
  | 'capability.request'
  | 'capability.response'
  | 'collab.invite'
  | 'collab.accept'
  | 'collab.reject'
  | 'collab.defer'
  | 'status.notify'
  | 'session.renew'
  | 'session.terminate'
  | 'warning.compromised'
  | 'policy.update';

// --- Hello ---

/** Hello Message Body */
export interface HelloBody {
  display_name?: string;
  capability_summary: CapabilitySummary;
  identity_version: NonNegativeInteger;
  revocation_epoch: NonNegativeInteger;
}

// --- Profile ---

/** Profile Request Body */
export interface ProfileRequestBody {
  requested_fields?: string[];
}

/** Profile Response Body */
export interface ProfileResponseBody {
  profile: {
    display_name?: string;
    summary?: string;
    platform_bindings?: Array<{
      platform_type: PlatformType;
      display_handle: string;
    }>;
  };
}

// --- Capability ---

/** Capability Request Body */
export interface CapabilityRequestBody {
  requested_capabilities: CapabilityName[];
}

/** Capability Response Body */
export interface CapabilityResponseBody {
  granted_capabilities: CapabilityName[];
  denied_capabilities: CapabilityName[];
  effective_capability_digest: HashString;
}

// --- Collab ---

/** Collab Invite Body */
export interface CollabInviteBody {
  invite_id: IdString;
  title: string;
  summary?: string;
  requested_actions?: string[];
  risk_level: RiskLevel;
  requires_fresh_reverification?: boolean;
}

/** Collab Accept Body */
export interface CollabAcceptBody {
  invite_id: IdString;
  accepted_at: Timestamp;
  conditions?: string[];
}

/** Collab Reject Body */
export interface CollabRejectBody {
  invite_id: IdString;
  rejected_at: Timestamp;
  reason_code: CollabRejectReasonCode;
}

/** Collab Defer Body */
export interface CollabDeferBody {
  invite_id: IdString;
  deferred_until: Timestamp;
  reason_code: CollabDeferReasonCode;
}

// --- Status ---

/** Status Notify Body */
export interface StatusNotifyBody {
  status_type: StatusType;
  detail?: string;
  effective_capabilities?: CapabilityName[];
}

// --- Session ---

/** Session Renew Body */
export interface SessionRenewBody {
  current_session_id: IdString;
  next_session_id: IdString;
  reason_code: SessionReasonCode;
  new_session_epoch: NonNegativeInteger;
  effective_at: Timestamp;
}

/** Session Terminate Body */
export interface SessionTerminateBody {
  session_id: IdString;
  reason_code: SessionReasonCode;
  reason_detail?: string;
  terminated_at: Timestamp;
}

// --- Warning ---

/** Warning Compromised Body */
export interface WarningCompromisedBody {
  warning_type: WarningType;
  reported_at: Timestamp;
  recommended_action: 'TERMINATE_AND_REVERIFY' | 'QUARANTINE' | 'REVOKE_KEY';
}

// --- Policy ---

/** Policy Update Body */
export interface PolicyUpdateBody {
  policy_epoch: NonNegativeInteger;
  previous_policy_epoch: NonNegativeInteger;
  effective_at: Timestamp;
  reauth_required: boolean;
}

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
    risk_level: RiskLevel;
    details: Record<string, unknown>;
  };
}

// ============================================================================
// Client Configuration Types
// ============================================================================

/** Agent Client設定 */
export interface AgentClientConfig {
  /** 自Agent ID */
  agentId: IdString;
  /** 自Instance ID */
  instanceId: IdString;
  /** 操作鍵ID */
  keyId: IdString;
  /** アルゴリズム */
  algorithm: string;
  /** 秘密鍵 (Base64) */
  privateKey?: string;
  /** デフォルトエンドポイント */
  defaultEndpoint?: UriString;
  /** タイムアウト (ms) */
  timeout?: number;
}

/** Exchange Client設定 */
export interface ExchangeClientConfig {
  /** 自Agent ID */
  agentId: IdString;
  /** 自Instance ID */
  instanceId: IdString;
  /** セッションID */
  sessionId: IdString;
  /** 交換エンドポイント */
  exchangeEndpoint: UriString;
  /** タイムアウト (ms) */
  timeout?: number;
  /** 自動シーケンス管理 */
  autoSequence?: boolean;
}

// ============================================================================
// Event Types
// ============================================================================

/** Client Event Type */
export type ClientEventType =
  | 'session_created'
  | 'session_renewed'
  | 'session_terminated'
  | 'message_received'
  | 'error_occurred'
  | 'freshness_changed';

/** Client Event */
export interface ClientEvent {
  type: ClientEventType;
  timestamp: Timestamp;
  data: unknown;
}

/** Client Event Handler */
export type ClientEventHandler = (event: ClientEvent) => void;