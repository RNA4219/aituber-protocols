/**
 * Exchange Server - メッセージングサーバー
 *
 * 認証済みAgent間のメッセージ交換を仲介するサーバー実装。
 * プロトコルバージョン0.2準拠のメッセージフォーマットを処理。
 *
 * ## サポートするメッセージタイプ
 * - `hello`: 初期接続時の挨拶
 * - `profile.*`: プロフィール要求/応答
 * - `capability.*`: 能力ネゴシエーション
 * - `collab.*`: コラボレーション招待/承諾/拒否/延期
 * - `status.notify`: ステータス通知
 * - `session.*`: セッション更新/終了
 * - `warning.compromised`: 侵害警告
 * - `policy.update`: ポリシー更新通知
 *
 * ## メッセージフロー
 * 1. メッセージ検証 (構造・プロトコルバージョン)
 * 2. セッション検証 (存在確認・所有権確認)
 * 3. シーケンス番号検証 (skew許容範囲内か)
 * 4. タイムスタンプ検証 (clock skew許容範囲内か)
 * 5. 署名検証
 * 6. ハンドラ実行
 *
 * @see ../../../specs/core/interfaces.md
 */

import type {
  IdString,
  Timestamp,
  NonNegativeInteger,
  CapabilitySummary,
  CapabilityName,
  RiskLevel,
  PlatformType,
} from './types.js';
import type { Session, SessionManager } from './session-manager.js';
import type { Verifier } from './verifier.js';
import type { IdentityHost } from './identity-host.js';
import {
  DEFAULT_MESSAGE_TIMEOUT_MS,
  DEFAULT_MAX_SEQUENCE_SKEW,
  DEFAULT_CLOCK_SKEW_TOLERANCE_SEC,
  generateMessageId,
  EventEmitter,
} from './utils.js';
import { verifyObject } from './crypto.js';

// ============================================================================
// Exchange Message Types
// ============================================================================

/** Exchange Message Type */
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

/** Exchange Message Envelope */
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
  body: unknown;
}

/** Hello Body */
export interface HelloBody {
  display_name?: string;
  capability_summary: CapabilitySummary;
  identity_version: NonNegativeInteger;
  revocation_epoch: NonNegativeInteger;
}

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

/** Capability Request Body */
export interface CapabilityRequestBody {
  requested_capabilities: CapabilityName[];
}

/** Capability Response Body */
export interface CapabilityResponseBody {
  granted_capabilities: CapabilityName[];
  denied_capabilities: CapabilityName[];
  effective_capability_digest: string;
}

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
  reason_code: 'POLICY_DECLINED' | 'CAPABILITY_MISMATCH' | 'BUSY' | 'NOT_INTERESTED';
}

/** Collab Defer Body */
export interface CollabDeferBody {
  invite_id: IdString;
  deferred_until: Timestamp;
  reason_code: 'MANUAL_REVIEW_REQUIRED' | 'PENDING_APPROVAL' | 'SCHEDULE_CONFLICT';
}

/** Status Notify Body */
export interface StatusNotifyBody {
  status_type: 'ACTIVE' | 'DEGRADED' | 'QUARANTINED' | 'RECOVERING' | 'TERMINATING';
  detail?: string;
  effective_capabilities?: CapabilityName[];
}

/** Session Renew Body */
export interface SessionRenewBody {
  current_session_id: IdString;
  next_session_id: IdString;
  reason_code: string;
  new_session_epoch: NonNegativeInteger;
  effective_at: Timestamp;
}

/** Session Terminate Body */
export interface SessionTerminateBody {
  session_id: IdString;
  reason_code: string;
  reason_detail?: string;
  terminated_at: Timestamp;
}

/** Warning Compromised Body */
export interface WarningCompromisedBody {
  warning_type: 'OPERATION_KEY_COMPROMISED' | 'SESSION_KEY_COMPROMISED' | 'BINDING_COMPROMISED' | 'POLICY_VIOLATION';
  reported_at: Timestamp;
  recommended_action: 'TERMINATE_AND_REVERIFY' | 'QUARANTINE' | 'REVOKE_KEY';
}

/** Policy Update Body */
export interface PolicyUpdateBody {
  policy_epoch: NonNegativeInteger;
  previous_policy_epoch: NonNegativeInteger;
  effective_at: Timestamp;
  reauth_required: boolean;
}

// ============================================================================
// Exchange Server Types
// ============================================================================

/** Message Handler */
export type MessageHandler = (message: ExchangeEnvelope, context: MessageContext) => Promise<ExchangeEnvelope | void>;

/** Message Context */
export interface MessageContext {
  session: Session;
  identityHost: IdentityHost;
  sessionManager: SessionManager;
  verifier: Verifier;
}

/** Exchange Server Config */
export interface ExchangeServerConfig {
  /** Protocol version */
  protocolVersion?: string;
  /** Message timeout (ms) */
  messageTimeout?: number;
  /** Max sequence skew */
  maxSequenceSkew?: number;
  /** Clock skew tolerance (ms) */
  clockSkewTolerance?: number;
}

/** Exchange Event */
export interface ExchangeEvent {
  type: 'message_received' | 'message_sent' | 'error' | 'session_event';
  timestamp: Timestamp;
  data: unknown;
}

/** Event Handler */
export type ExchangeEventHandler = (event: ExchangeEvent) => void;

// ============================================================================
// Body Type Guards
// ============================================================================

/** Type guard for HelloBody */
function isHelloBody(body: unknown): body is HelloBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.capability_summary === 'object' &&
         typeof b.identity_version === 'number' &&
         typeof b.revocation_epoch === 'number';
}

/** Type guard for ProfileRequestBody */
function isProfileRequestBody(body: unknown): body is ProfileRequestBody {
  if (!body || typeof body !== 'object') return true;
  const b = body as Record<string, unknown>;
  return b.requested_fields === undefined || Array.isArray(b.requested_fields);
}

/** Type guard for ProfileResponseBody */
function isProfileResponseBody(body: unknown): body is ProfileResponseBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.profile === 'object';
}

/** Type guard for CapabilityRequestBody */
function isCapabilityRequestBody(body: unknown): body is CapabilityRequestBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return Array.isArray(b.requested_capabilities);
}

/** Type guard for CapabilityResponseBody */
function isCapabilityResponseBody(body: unknown): body is CapabilityResponseBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return Array.isArray(b.granted_capabilities) &&
         Array.isArray(b.denied_capabilities) &&
         typeof b.effective_capability_digest === 'string';
}

/** Type guard for CollabInviteBody */
function isCollabInviteBody(body: unknown): body is CollabInviteBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.invite_id === 'string' &&
         typeof b.title === 'string' &&
         typeof b.risk_level === 'string';
}

/** Type guard for CollabAcceptBody */
function isCollabAcceptBody(body: unknown): body is CollabAcceptBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.invite_id === 'string' && typeof b.accepted_at === 'string';
}

/** Type guard for CollabRejectBody */
function isCollabRejectBody(body: unknown): body is CollabRejectBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.invite_id === 'string' &&
         typeof b.rejected_at === 'string' &&
         typeof b.reason_code === 'string';
}

/** Type guard for CollabDeferBody */
function isCollabDeferBody(body: unknown): body is CollabDeferBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.invite_id === 'string' &&
         typeof b.deferred_until === 'string' &&
         typeof b.reason_code === 'string';
}

/** Type guard for StatusNotifyBody */
function isStatusNotifyBody(body: unknown): body is StatusNotifyBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.status_type === 'string';
}

/** Type guard for SessionRenewBody */
function isSessionRenewBody(body: unknown): body is SessionRenewBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.current_session_id === 'string' &&
         typeof b.next_session_id === 'string' &&
         typeof b.reason_code === 'string';
}

/** Type guard for SessionTerminateBody */
function isSessionTerminateBody(body: unknown): body is SessionTerminateBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.session_id === 'string' &&
         typeof b.reason_code === 'string' &&
         typeof b.terminated_at === 'string';
}

/** Type guard for WarningCompromisedBody */
function isWarningCompromisedBody(body: unknown): body is WarningCompromisedBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.warning_type === 'string' &&
         typeof b.reported_at === 'string' &&
         typeof b.recommended_action === 'string';
}

/** Type guard for PolicyUpdateBody */
function isPolicyUpdateBody(body: unknown): body is PolicyUpdateBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.policy_epoch === 'number' &&
         typeof b.previous_policy_epoch === 'number' &&
         typeof b.effective_at === 'string' &&
         typeof b.reauth_required === 'boolean';
}

// ============================================================================
// Exchange Server Implementation
// ============================================================================

/**
 * Exchange Server
 *
 * Handles message exchange between agents:
 * - hello: Initial greeting
 * - profile: Profile request/response
 * - capability: Capability negotiation
 * - collab: Collaboration invites
 * - status: Status notifications
 */
export class ExchangeServer {
  private config: Required<ExchangeServerConfig>;
  private messageHandlers: Map<ExchangeMessageType, Set<MessageHandler>> = new Map();
  private eventEmitter: EventEmitter<ExchangeEvent> = new EventEmitter();
  private dependencies: {
    identityHost: IdentityHost;
    sessionManager: SessionManager;
    verifier: Verifier;
  };

  constructor(
    config: ExchangeServerConfig,
    dependencies: {
      identityHost: IdentityHost;
      sessionManager: SessionManager;
      verifier: Verifier;
    }
  ) {
    this.config = {
      protocolVersion: config.protocolVersion || '0.2',
      messageTimeout: config.messageTimeout || DEFAULT_MESSAGE_TIMEOUT_MS,
      maxSequenceSkew: config.maxSequenceSkew || DEFAULT_MAX_SEQUENCE_SKEW,
      clockSkewTolerance: config.clockSkewTolerance || DEFAULT_CLOCK_SKEW_TOLERANCE_SEC * 1000,
    };
    this.dependencies = dependencies;

    // Register default handlers
    this.registerDefaultHandlers();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Process incoming message
   */
  async handleMessage(rawMessage: unknown): Promise<ExchangeEnvelope | void> {
    // Validate message structure and type-safe cast
    const message = this.parseAndValidateMessage(rawMessage);

    // Get session
    const session = await this.dependencies.sessionManager.getSession(message.session_id);
    if (!session) {
      throw new Error(`Session not found: ${message.session_id}`);
    }

    // Validate session ownership
    if (session.agent_id !== message.agent_id || session.instance_id !== message.instance_id) {
      throw new Error('Session ownership mismatch');
    }

    // Validate sequence
    this.validateSequence(message, session);

    // Validate timestamp
    this.validateTimestamp(message);

    // Verify signature
    await this.verifySignature(message);

    // Build context
    const context: MessageContext = {
      session,
      identityHost: this.dependencies.identityHost,
      sessionManager: this.dependencies.sessionManager,
      verifier: this.dependencies.verifier,
    };

    // Emit event
    this.emitEvent({
      type: 'message_received',
      timestamp: new Date().toISOString(),
      data: message,
    });

    // Find handlers
    const handlers = this.messageHandlers.get(message.message_type);
    if (handlers && handlers.size > 0) {
      for (const handler of handlers) {
        try {
          const result = await handler(message, context);
          if (result) {
            this.emitEvent({
              type: 'message_sent',
              timestamp: new Date().toISOString(),
              data: result,
            });
            return result;
          }
        } catch (error) {
          this.emitEvent({
            type: 'error',
            timestamp: new Date().toISOString(),
            data: { error, message },
          });
          throw error;
        }
      }
    }

    // No handler returned a response
    return;
  }

  /**
   * Register message handler
   */
  onMessage(messageType: ExchangeMessageType, handler: MessageHandler): void {
    if (!this.messageHandlers.has(messageType)) {
      this.messageHandlers.set(messageType, new Set());
    }
    this.messageHandlers.get(messageType)!.add(handler);
  }

  /**
   * Remove message handler
   */
  offMessage(messageType: ExchangeMessageType, handler: MessageHandler): void {
    this.messageHandlers.get(messageType)?.delete(handler);
  }

  /**
   * Register event handler
   */
  addEventHandler(handler: ExchangeEventHandler): void {
    this.eventEmitter.add(handler);
  }

  /**
   * Remove event handler
   */
  removeEventHandler(handler: ExchangeEventHandler): void {
    this.eventEmitter.remove(handler);
  }

  // ==========================================================================
  // Validation
  // ==========================================================================

  /**
   * Parse and validate raw message with type-safe casting
   * @throws Error if message is invalid
   */
  private parseAndValidateMessage(rawMessage: unknown): ExchangeEnvelope {
    if (!rawMessage || typeof rawMessage !== 'object') {
      throw new Error('Invalid message: expected an object');
    }

    const msg = rawMessage as Record<string, unknown>;

    // Required string fields
    const stringFields = ['message_id', 'message_type', 'timestamp', 'agent_id', 'instance_id', 'session_id', 'protocol_version'] as const;
    for (const field of stringFields) {
      if (typeof msg[field] !== 'string') {
        throw new Error(`Missing or invalid ${field}: expected string`);
      }
    }

    // Validate sequence is a non-negative integer
    if (typeof msg.sequence !== 'number' || !Number.isInteger(msg.sequence) || msg.sequence < 0) {
      throw new Error('Missing or invalid sequence: expected non-negative integer');
    }

    // Validate message_type is valid
    const validTypes: ExchangeMessageType[] = [
      'hello', 'profile.request', 'profile.response',
      'capability.request', 'capability.response',
      'collab.invite', 'collab.accept', 'collab.reject', 'collab.defer',
      'status.notify', 'session.renew', 'session.terminate',
      'warning.compromised', 'policy.update',
    ];
    if (!validTypes.includes(msg.message_type as ExchangeMessageType)) {
      throw new Error(`Invalid message_type: ${msg.message_type}`);
    }

    // Validate protocol version
    if (msg.protocol_version !== this.config.protocolVersion) {
      throw new Error(`Unsupported protocol version: ${msg.protocol_version}`);
    }

    // Type-safe cast after validation
    return {
      protocol_version: msg.protocol_version as string,
      message_id: msg.message_id as IdString,
      message_type: msg.message_type as ExchangeMessageType,
      timestamp: msg.timestamp as Timestamp,
      agent_id: msg.agent_id as IdString,
      instance_id: msg.instance_id as IdString,
      session_id: msg.session_id as IdString,
      sequence: msg.sequence as NonNegativeInteger,
      signature_or_mac: typeof msg.signature_or_mac === 'string' ? msg.signature_or_mac : undefined,
      body: msg.body,
    };
  }

  private validateMessage(message: ExchangeEnvelope): void {
    // Already validated in parseAndValidateMessage, but keep for explicit checks
    if (!message.message_id) {
      throw new Error('Missing message_id');
    }
    if (!message.message_type) {
      throw new Error('Missing message_type');
    }
    if (!message.timestamp) {
      throw new Error('Missing timestamp');
    }
    if (!message.agent_id) {
      throw new Error('Missing agent_id');
    }
    if (!message.instance_id) {
      throw new Error('Missing instance_id');
    }
    if (!message.session_id) {
      throw new Error('Missing session_id');
    }
    if (message.protocol_version !== this.config.protocolVersion) {
      throw new Error(`Unsupported protocol version: ${message.protocol_version}`);
    }
  }

  private validateSequence(message: ExchangeEnvelope, session: Session): void {
    const expectedSequence = session.sequence;
    const actualSequence = message.sequence;

    if (Math.abs(actualSequence - expectedSequence) > this.config.maxSequenceSkew) {
      throw new Error(`Sequence skew too large: expected ${expectedSequence}, got ${actualSequence}`);
    }
  }

  private validateTimestamp(message: ExchangeEnvelope): void {
    const timestamp = new Date(message.timestamp);
    const now = new Date();
    const skew = Math.abs(now.getTime() - timestamp.getTime());

    if (skew > this.config.clockSkewTolerance) {
      throw new Error(`Timestamp skew too large: ${skew}ms`);
    }
  }

  private async verifySignature(message: ExchangeEnvelope): Promise<void> {
    // 署名がない場合はスキップ（オプションフィールド）
    if (!message.signature_or_mac) {
      return;
    }

    try {
      // Manifestから公開鍵を取得
      const manifest = await this.dependencies.identityHost.getManifest(message.agent_id);
      if (!manifest) {
        // Manifestが見つからない場合はエラー（セキュリティ上重要）
        throw new Error(`Cannot verify signature: manifest not found for agent ${message.agent_id}`);
      }

      // アクティブな公開鍵を探す（優先順位: operation > session > root）
      const activeKeys = manifest.keys.filter(k => k.status === 'active');
      if (activeKeys.length === 0) {
        throw new Error(`Cannot verify signature: no active keys found for agent ${message.agent_id}`);
      }

      // operation keyを優先
      const operationKey = activeKeys.find(k => k.scope === 'operation');
      const sessionKey = activeKeys.find(k => k.scope === 'session');
      const rootKey = activeKeys.find(k => k.scope === 'root');
      const publicKey = (operationKey || sessionKey || rootKey || activeKeys[0])?.public_key;

      if (!publicKey) {
        throw new Error(`Cannot verify signature: no public key available for agent ${message.agent_id}`);
      }

      // 署名対象データを作成（signature_or_macフィールドを除く）
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { signature_or_mac: _, ...dataToVerify } = message;

      // 署名検証
      const isValid = await verifyObject(dataToVerify, message.signature_or_mac, publicKey);
      if (!isValid) {
        throw new Error('Signature verification failed');
      }
    } catch (error) {
      // 署名検証エラーは再スロー
      if (error instanceof Error && error.message === 'Signature verification failed') {
        throw error;
      }
      // その他のエラーもラップして再スロー
      throw new Error(`Signature verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  private emitEvent(event: ExchangeEvent): void {
    this.eventEmitter.emit(event);
  }

  // ==========================================================================
  // Default Handlers
  // ==========================================================================

  private registerDefaultHandlers(): void {
    // Hello handler
    this.onMessage('hello', async (message, context) => {
      if (!isHelloBody(message.body)) {
        throw new Error('Invalid hello message body');
      }
      const body = message.body;

      // Store peer info in session
      this.emitEvent({
        type: 'session_event',
        timestamp: new Date().toISOString(),
        data: {
          event: 'hello_received',
          session_id: context.session.session_id,
          agent_id: message.agent_id,
          capabilities: body.capability_summary,
        },
      });

      // No response required for hello
      return;
    });

    // Profile request handler
    this.onMessage('profile.request', async (message, context) => {
      if (!isProfileRequestBody(message.body)) {
        throw new Error('Invalid profile.request message body');
      }
      // requested_fields is available via type guard validation
      const manifest = await context.identityHost.getManifest(message.agent_id);

      if (!manifest) {
        throw new Error('Agent manifest not found');
      }

      const profile: ProfileResponseBody['profile'] = {
        display_name: manifest.controller_id,
      };

      if (manifest.platform_bindings) {
        profile.platform_bindings = manifest.platform_bindings.map((binding) => ({
          platform_type: binding.platform_type,
          display_handle: binding.display_handle,
        }));
      }

      const response: ExchangeEnvelope = {
        protocol_version: this.config.protocolVersion,
        message_id: this.createMessageId(),
        message_type: 'profile.response',
        timestamp: new Date().toISOString(),
        agent_id: context.session.agent_id,
        instance_id: context.session.instance_id,
        session_id: context.session.session_id,
        sequence: context.session.sequence + 1,
        body: { profile },
      };

      return response;
    });

    // Profile response handler
    this.onMessage('profile.response', async (message, context) => {
      if (!isProfileResponseBody(message.body)) {
        throw new Error('Invalid profile.response message body');
      }
      const body = message.body;

      this.emitEvent({
        type: 'session_event',
        timestamp: new Date().toISOString(),
        data: {
          event: 'profile_received',
          session_id: context.session.session_id,
          profile: body.profile,
        },
      });

      return;
    });

    // Capability request handler
    this.onMessage('capability.request', async (message, context) => {
      if (!isCapabilityRequestBody(message.body)) {
        throw new Error('Invalid capability.request message body');
      }
      const body = message.body;

      // Check requested capabilities against session capabilities
      const sessionCapabilities = context.session.capabilities?.capabilities || [];
      const granted: CapabilityName[] = [];
      const denied: CapabilityName[] = [];

      for (const cap of body.requested_capabilities) {
        if (sessionCapabilities.includes(cap)) {
          granted.push(cap);
        } else {
          denied.push(cap);
        }
      }

      const response: ExchangeEnvelope = {
        protocol_version: this.config.protocolVersion,
        message_id: this.createMessageId(),
        message_type: 'capability.response',
        timestamp: new Date().toISOString(),
        agent_id: context.session.agent_id,
        instance_id: context.session.instance_id,
        session_id: context.session.session_id,
        sequence: context.session.sequence + 1,
        body: {
          granted_capabilities: granted,
          denied_capabilities: denied,
          effective_capability_digest: context.session.capabilities?.capability_digest || '',
        },
      };

      return response;
    });

    // Capability response handler
    this.onMessage('capability.response', async (message, context) => {
      if (!isCapabilityResponseBody(message.body)) {
        throw new Error('Invalid capability.response message body');
      }
      const body = message.body;

      this.emitEvent({
        type: 'session_event',
        timestamp: new Date().toISOString(),
        data: {
          event: 'capabilities_granted',
          session_id: context.session.session_id,
          granted: body.granted_capabilities,
          denied: body.denied_capabilities,
        },
      });

      return;
    });

    // Collab invite handler
    this.onMessage('collab.invite', async (message, context) => {
      if (!isCollabInviteBody(message.body)) {
        throw new Error('Invalid collab.invite message body');
      }
      const body = message.body;

      this.emitEvent({
        type: 'session_event',
        timestamp: new Date().toISOString(),
        data: {
          event: 'collab_invite_received',
          session_id: context.session.session_id,
          invite_id: body.invite_id,
          title: body.title,
          risk_level: body.risk_level,
        },
      });

      // No automatic response - the application should handle this
      return;
    });

    // Collab accept handler
    this.onMessage('collab.accept', async (message, context) => {
      if (!isCollabAcceptBody(message.body)) {
        throw new Error('Invalid collab.accept message body');
      }
      const body = message.body;

      this.emitEvent({
        type: 'session_event',
        timestamp: new Date().toISOString(),
        data: {
          event: 'collab_accepted',
          session_id: context.session.session_id,
          invite_id: body.invite_id,
          conditions: body.conditions,
        },
      });

      return;
    });

    // Collab reject handler
    this.onMessage('collab.reject', async (message, context) => {
      if (!isCollabRejectBody(message.body)) {
        throw new Error('Invalid collab.reject message body');
      }
      const body = message.body;

      this.emitEvent({
        type: 'session_event',
        timestamp: new Date().toISOString(),
        data: {
          event: 'collab_rejected',
          session_id: context.session.session_id,
          invite_id: body.invite_id,
          reason_code: body.reason_code,
        },
      });

      return;
    });

    // Collab defer handler
    this.onMessage('collab.defer', async (message, context) => {
      if (!isCollabDeferBody(message.body)) {
        throw new Error('Invalid collab.defer message body');
      }
      const body = message.body;

      this.emitEvent({
        type: 'session_event',
        timestamp: new Date().toISOString(),
        data: {
          event: 'collab_deferred',
          session_id: context.session.session_id,
          invite_id: body.invite_id,
          deferred_until: body.deferred_until,
          reason_code: body.reason_code,
        },
      });

      return;
    });

    // Status notify handler
    this.onMessage('status.notify', async (message, context) => {
      if (!isStatusNotifyBody(message.body)) {
        throw new Error('Invalid status.notify message body');
      }
      const body = message.body;

      this.emitEvent({
        type: 'session_event',
        timestamp: new Date().toISOString(),
        data: {
          event: 'status_update',
          session_id: context.session.session_id,
          status_type: body.status_type,
          detail: body.detail,
          effective_capabilities: body.effective_capabilities,
        },
      });

      return;
    });

    // Session renew handler
    this.onMessage('session.renew', async (message, context) => {
      if (!isSessionRenewBody(message.body)) {
        throw new Error('Invalid session.renew message body');
      }
      const body = message.body;

      const renewedSession = await context.sessionManager.renewSession(body.current_session_id);

      this.emitEvent({
        type: 'session_event',
        timestamp: new Date().toISOString(),
        data: {
          event: 'session_renewed',
          old_session_id: body.current_session_id,
          new_session_id: body.next_session_id,
          session_epoch: renewedSession.session_epoch,
        },
      });

      return;
    });

    // Session terminate handler
    this.onMessage('session.terminate', async (message, context) => {
      if (!isSessionTerminateBody(message.body)) {
        throw new Error('Invalid session.terminate message body');
      }
      const body = message.body;

      await context.sessionManager.terminateSession(body.session_id, 'manual_termination');

      this.emitEvent({
        type: 'session_event',
        timestamp: new Date().toISOString(),
        data: {
          event: 'session_terminated',
          session_id: body.session_id,
          reason_code: body.reason_code,
          reason_detail: body.reason_detail,
        },
      });

      return;
    });

    // Warning compromised handler
    this.onMessage('warning.compromised', async (message, context) => {
      if (!isWarningCompromisedBody(message.body)) {
        throw new Error('Invalid warning.compromised message body');
      }
      const body = message.body;

      this.emitEvent({
        type: 'session_event',
        timestamp: new Date().toISOString(),
        data: {
          event: 'warning_compromised',
          session_id: context.session.session_id,
          warning_type: body.warning_type,
          recommended_action: body.recommended_action,
        },
      });

      return;
    });

    // Policy update handler
    this.onMessage('policy.update', async (message, context) => {
      if (!isPolicyUpdateBody(message.body)) {
        throw new Error('Invalid policy.update message body');
      }
      const body = message.body;

      this.emitEvent({
        type: 'session_event',
        timestamp: new Date().toISOString(),
        data: {
          event: 'policy_updated',
          session_id: context.session.session_id,
          policy_epoch: body.policy_epoch,
          previous_policy_epoch: body.previous_policy_epoch,
          reauth_required: body.reauth_required,
        },
      });

      return;
    });
  }

  private createMessageId(): IdString {
    return generateMessageId();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create Exchange Server
 */
export function createExchangeServer(
  config: ExchangeServerConfig,
  dependencies: {
    identityHost: IdentityHost;
    sessionManager: SessionManager;
    verifier: Verifier;
  }
): ExchangeServer {
  return new ExchangeServer(config, dependencies);
}