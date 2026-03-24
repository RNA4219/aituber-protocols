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
    const message = rawMessage as ExchangeEnvelope;

    // Validate message structure
    this.validateMessage(message);

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

  private validateMessage(message: ExchangeEnvelope): void {
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
        // Manifestが見つからない場合は警告ログを出力してスキップ
        console.warn(`Manifest not found for agent ${message.agent_id}, skipping signature verification`);
        return;
      }

      // アクティブな公開鍵を探す（優先順位: operation > session > root）
      const activeKeys = manifest.keys.filter(k => k.status === 'active');
      if (activeKeys.length === 0) {
        console.warn(`No active keys found for agent ${message.agent_id}`);
        return;
      }

      // operation keyを優先
      const operationKey = activeKeys.find(k => k.scope === 'operation');
      const sessionKey = activeKeys.find(k => k.scope === 'session');
      const rootKey = activeKeys.find(k => k.scope === 'root');
      const publicKey = (operationKey || sessionKey || rootKey || activeKeys[0])?.public_key;

      if (!publicKey) {
        return;
      }

      // 署名対象データを作成（signature_or_macフィールドを除く）
      const { signature_or_mac: _, ...dataToVerify } = message;

      // 署名検証
      const isValid = await verifyObject(dataToVerify, message.signature_or_mac, publicKey);
      if (!isValid) {
        throw new Error('Signature verification failed');
      }
    } catch (error) {
      // 署名検証エラー
      if (error instanceof Error && error.message === 'Signature verification failed') {
        throw error;
      }
      // その他のエラー（Manifest取得エラーなど）は警告してスキップ
      console.warn(`Signature verification skipped due to error: ${error}`);
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
      const body = message.body as HelloBody;

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
      const body = message.body as ProfileRequestBody;
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
        body: { profile } as ProfileResponseBody,
      };

      return response;
    });

    // Profile response handler
    this.onMessage('profile.response', async (message, context) => {
      const body = message.body as ProfileResponseBody;

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
      const body = message.body as CapabilityRequestBody;

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
        } as CapabilityResponseBody,
      };

      return response;
    });

    // Capability response handler
    this.onMessage('capability.response', async (message, context) => {
      const body = message.body as CapabilityResponseBody;

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
      const body = message.body as CollabInviteBody;

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
      const body = message.body as CollabAcceptBody;

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
      const body = message.body as CollabRejectBody;

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
      const body = message.body as CollabDeferBody;

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
      const body = message.body as StatusNotifyBody;

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
      const body = message.body as SessionRenewBody;

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
      const body = message.body as SessionTerminateBody;

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
      const body = message.body as WarningCompromisedBody;

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
      const body = message.body as PolicyUpdateBody;

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