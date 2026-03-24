/**
 * Exchange Client - メッセージ交換クライアント
 *
 * 認証済みセッション上でのAgent間メッセージ交換を行うクライアント実装。
 * プロトコルバージョン0.2準拠のメッセージ送受信を担当。
 *
 * ## サポートするメッセージタイプ
 * | タイプ | 説明 | レスポンス |
 * |--------|------|-----------|
 * | hello | 挨拶 | なし |
 * | profile.request | プロフィール要求 | profile.response |
 * | capability.request | 能力要求 | capability.response |
 * | collab.invite | コラボ招待 | なし |
 * | collab.accept/reject/defer | コラボ応答 | なし |
 * | status.notify | ステータス通知 | なし |
 * | session.renew/terminate | セッション管理 | なし |
 * | warning.compromised | 侵害警告 | なし |
 * | policy.update | ポリシー更新 | なし |
 *
 * ## 使用例
 * ```typescript
 * const client = new ExchangeClient({
 *   agentId: 'my-agent',
 *   instanceId: 'instance-001',
 *   sessionId: 'session-001',
 *   exchangeEndpoint: 'https://example.com/exchange'
 * });
 *
 * // プロフィール要求
 * const profile = await client.requestProfile(['display_name']);
 *
 * // イベントハンドラ登録
 * client.addEventHandler(event => {
 *   if (event.type === 'message_received') {
 *     console.log('Received:', event.data);
 *   }
 * });
 * ```
 *
 * @see ../../../specs/core/interfaces.md
 */

import type {
  IdString,
  Timestamp,
  NonNegativeInteger,
  UriString,
  CapabilitySummary,
  CapabilityName,
  PlatformType,
  RiskLevel,
  ExchangeMessageType,
  ExchangeEnvelope,
  HelloBody,
  ProfileRequestBody,
  ProfileResponseBody,
  CapabilityRequestBody,
  CapabilityResponseBody,
  CollabInviteBody,
  CollabAcceptBody,
  CollabRejectBody,
  CollabDeferBody,
  StatusNotifyBody,
  SessionRenewBody,
  SessionTerminateBody,
  WarningCompromisedBody,
  PolicyUpdateBody,
  ExchangeClientConfig,
  ClientEvent,
  ClientEventHandler,
  SessionReasonCode,
  StatusType,
  CollabRejectReasonCode,
  CollabDeferReasonCode,
  WarningType,
} from './types.js';
import { DEFAULT_TIMEOUT_MS, generateMessageId, EventEmitter } from './utils.js';

/**
 * Exchange Message
 */
export interface ExchangeMessage {
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

/**
 * Message Handler
 */
export type MessageHandler = (message: ExchangeMessage) => Promise<void | ExchangeMessage>;

/**
 * Exchange Client 実装
 *
 * 責務:
 * - hello メッセージ送受信
 * - profile request/response
 * - capability request/response
 * - collab invite/accept/reject/defer
 * - status notify
 * - session renew/terminate
 * - warning.compromised
 * - policy.update
 */
export class ExchangeClient {
  private config: ExchangeClientConfig;
  private sequence: NonNegativeInteger = 0;
  private eventEmitter: EventEmitter<ClientEvent> = new EventEmitter();
  private messageHandlers: Map<ExchangeMessageType, Set<MessageHandler>> = new Map();
  private pendingRequests: Map<IdString, {
    resolve: (message: ExchangeMessage) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();

  // Default timeouts per message type (ms)
  private static readonly DEFAULT_TIMEOUTS: Record<string, number> = {
    'profile.request': 5000,
    'capability.request': 5000,
    'collab.invite': 10000,
    'session.renew': 30000,
  };

  constructor(config: ExchangeClientConfig) {
    this.config = {
      timeout: DEFAULT_TIMEOUT_MS,
      autoSequence: true,
      ...config,
    };
  }

  // ==========================================================================
  // Message Sending
  // ==========================================================================

  /**
   * 汎用メッセージ送信
   */
  async sendMessage<TBody = unknown, TResponse = unknown>(
    messageType: ExchangeMessageType,
    body: TBody,
    options?: {
      expectResponse?: boolean;
      timeout?: number;
    }
  ): Promise<TResponse | void> {
    const message = this.createMessage(messageType, body);
    const signedMessage = await this.signMessage(message);

    if (options?.expectResponse) {
      return this.sendWithResponse<TResponse>(signedMessage, options.timeout);
    }

    await this.sendRaw(signedMessage);
  }

  /**
   * Hello送信
   */
  async sendHello(body: HelloBody): Promise<void> {
    return this.sendMessage('hello', body);
  }

  // --- Profile ---

  /**
   * Profile要求送信
   */
  async requestProfile(requestedFields?: string[]): Promise<ProfileResponseBody> {
    const body: ProfileRequestBody = {
      requested_fields: requestedFields,
    };

    return this.sendMessage<ProfileRequestBody, ProfileResponseBody>(
      'profile.request',
      body,
      { expectResponse: true }
    ) as Promise<ProfileResponseBody>;
  }

  /**
   * Profile応答送信
   */
  async sendProfileResponse(
    messageId: IdString,
    profile: ProfileResponseBody['profile']
  ): Promise<void> {
    const body: ProfileResponseBody = { profile };
    const responseMessage = this.createResponseMessage(messageId, 'profile.response', body);
    return this.sendMessage('profile.response', responseMessage);
  }

  // --- Capability ---

  /**
   * Capability要求送信
   */
  async requestCapabilities(capabilities: CapabilityName[]): Promise<CapabilityResponseBody> {
    const body: CapabilityRequestBody = {
      requested_capabilities: capabilities,
    };

    return this.sendMessage<CapabilityRequestBody, CapabilityResponseBody>(
      'capability.request',
      body,
      { expectResponse: true }
    ) as Promise<CapabilityResponseBody>;
  }

  /**
   * Capability応答送信
   */
  async sendCapabilityResponse(
    messageId: IdString,
    granted: CapabilityName[],
    denied: CapabilityName[],
    capabilityDigest: string
  ): Promise<void> {
    const body: CapabilityResponseBody = {
      granted_capabilities: granted,
      denied_capabilities: denied,
      effective_capability_digest: capabilityDigest,
    };
    return this.sendMessage('capability.response', body);
  }

  // --- Collab ---

  /**
   * Collab招待送信
   */
  async sendCollabInvite(
    inviteId: IdString,
    title: string,
    options?: {
      summary?: string;
      riskLevel?: RiskLevel;
      requiresFreshReverification?: boolean;
    }
  ): Promise<void> {
    const body: CollabInviteBody = {
      invite_id: inviteId,
      title,
      summary: options?.summary,
      risk_level: options?.riskLevel || 'low',
      requires_fresh_reverification: options?.requiresFreshReverification,
    };

    return this.sendMessage('collab.invite', body, {
      expectResponse: true,
      timeout: ExchangeClient.DEFAULT_TIMEOUTS['collab.invite'],
    });
  }

  /**
   * Collab承諾送信
   */
  async acceptCollab(
    inviteId: IdString,
    conditions?: string[]
  ): Promise<void> {
    const body: CollabAcceptBody = {
      invite_id: inviteId,
      accepted_at: new Date().toISOString(),
      conditions,
    };

    return this.sendMessage('collab.accept', body);
  }

  /**
   * Collab拒否送信
   */
  async rejectCollab(
    inviteId: IdString,
    reasonCode: CollabRejectReasonCode
  ): Promise<void> {
    const body: CollabRejectBody = {
      invite_id: inviteId,
      rejected_at: new Date().toISOString(),
      reason_code: reasonCode,
    };

    return this.sendMessage('collab.reject', body);
  }

  /**
   * Collab延期送信
   */
  async deferCollab(
    inviteId: IdString,
    deferredUntil: Timestamp,
    reasonCode: CollabDeferReasonCode
  ): Promise<void> {
    const body: CollabDeferBody = {
      invite_id: inviteId,
      deferred_until: deferredUntil,
      reason_code: reasonCode,
    };

    return this.sendMessage('collab.defer', body);
  }

  // --- Status ---

  /**
   * Status通知送信
   */
  async notifyStatus(
    statusType: StatusType,
    options?: {
      detail?: string;
      effectiveCapabilities?: CapabilityName[];
    }
  ): Promise<void> {
    const body: StatusNotifyBody = {
      status_type: statusType,
      detail: options?.detail,
      effective_capabilities: options?.effectiveCapabilities,
    };

    return this.sendMessage('status.notify', body);
  }

  // --- Session ---

  /**
   * Session更新送信
   */
  async sendSessionRenew(
    currentSessionId: IdString,
    nextSessionId: IdString,
    reasonCode: SessionReasonCode,
    newSessionEpoch: NonNegativeInteger,
    effectiveAt: Timestamp
  ): Promise<void> {
    const body: SessionRenewBody = {
      current_session_id: currentSessionId,
      next_session_id: nextSessionId,
      reason_code: reasonCode,
      new_session_epoch: newSessionEpoch,
      effective_at: effectiveAt,
    };

    return this.sendMessage('session.renew', body, {
      timeout: ExchangeClient.DEFAULT_TIMEOUTS['session.renew'],
    });
  }

  /**
   * Session終了送信
   */
  async sendSessionTerminate(
    sessionId: IdString,
    reasonCode: SessionReasonCode,
    reasonDetail?: string
  ): Promise<void> {
    const body: SessionTerminateBody = {
      session_id: sessionId,
      reason_code: reasonCode,
      reason_detail: reasonDetail,
      terminated_at: new Date().toISOString(),
    };

    return this.sendMessage('session.terminate', body);
  }

  // --- Warning ---

  /**
   * Compromised警告送信
   */
  async sendWarningCompromised(
    warningType: WarningType,
    recommendedAction: 'TERMINATE_AND_REVERIFY' | 'QUARANTINE' | 'REVOKE_KEY'
  ): Promise<void> {
    const body: WarningCompromisedBody = {
      warning_type: warningType,
      reported_at: new Date().toISOString(),
      recommended_action: recommendedAction,
    };

    return this.sendMessage('warning.compromised', body);
  }

  // --- Policy ---

  /**
   * Policy更新送信
   */
  async sendPolicyUpdate(
    policyEpoch: NonNegativeInteger,
    previousPolicyEpoch: NonNegativeInteger,
    effectiveAt: Timestamp,
    reauthRequired: boolean
  ): Promise<void> {
    const body: PolicyUpdateBody = {
      policy_epoch: policyEpoch,
      previous_policy_epoch: previousPolicyEpoch,
      effective_at: effectiveAt,
      reauth_required: reauthRequired,
    };

    return this.sendMessage('policy.update', body);
  }

  // ==========================================================================
  // Message Receiving
  // ==========================================================================

  /**
   * メッセージハンドラ登録
   */
  onMessage(messageType: ExchangeMessageType, handler: MessageHandler): void {
    if (!this.messageHandlers.has(messageType)) {
      this.messageHandlers.set(messageType, new Set());
    }
    this.messageHandlers.get(messageType)!.add(handler);
  }

  /**
   * メッセージハンドラ削除
   */
  offMessage(messageType: ExchangeMessageType, handler: MessageHandler): void {
    this.messageHandlers.get(messageType)?.delete(handler);
  }

  /**
   * 受信メッセージ処理
   */
  async handleIncomingMessage(rawMessage: unknown): Promise<void | ExchangeMessage> {
    const message = rawMessage as ExchangeMessage;

    // メッセージ検証
    this.validateMessage(message);

    // 署名検証
    await this.verifyMessageSignature(message);

    // 応答待ちリクエストの解決
    const pending = this.pendingRequests.get(message.message_id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.message_id);
      pending.resolve(message);
      return;
    }

    // ハンドラ実行
    const handlers = this.messageHandlers.get(message.message_type);
    if (handlers && handlers.size > 0) {
      for (const handler of handlers) {
        try {
          const result = await handler(message);
          if (result) {
            return result;
          }
        } catch (error) {
          console.error('Message handler error:', error);
          this.emitEvent({
            type: 'error_occurred',
            timestamp: new Date().toISOString(),
            data: { error, message },
          });
        }
      }
    }

    // イベント発火
    this.emitEvent({
      type: 'message_received',
      timestamp: new Date().toISOString(),
      data: message,
    });
  }

  private validateMessage(message: ExchangeMessage): void {
    if (!message.message_id) {
      throw new Error('Message missing message_id');
    }

    if (!message.message_type) {
      throw new Error('Message missing message_type');
    }

    if (!message.timestamp) {
      throw new Error('Message missing timestamp');
    }

    // タイムスタンプ検証
    const timestamp = new Date(message.timestamp);
    const now = new Date();
    const skew = Math.abs(now.getTime() - timestamp.getTime());
    if (skew > 120000) { // 120秒許容
      throw new Error('Message timestamp outside acceptable range');
    }
  }

  private async verifyMessageSignature(message: ExchangeMessage): Promise<void> {
    // TODO: 実際の署名検証
    if (message.signature_or_mac) {
      // 署名検証ロジック
    }
  }

  // ==========================================================================
  // Message Creation
  // ==========================================================================

  private createMessage<T>(messageType: ExchangeMessageType, body: T): ExchangeMessage {
    const messageId = this.generateMessageId();

    if (this.config.autoSequence) {
      this.sequence++;
    }

    return {
      protocol_version: '0.2',
      message_id: messageId,
      message_type: messageType,
      timestamp: new Date().toISOString(),
      agent_id: this.config.agentId,
      instance_id: this.config.instanceId,
      session_id: this.config.sessionId,
      sequence: this.sequence,
      body: body as unknown,
    };
  }

  private createResponseMessage<T>(
    originalMessageId: IdString,
    responseType: ExchangeMessageType,
    body: T
  ): ExchangeMessage {
    const messageId = this.generateMessageId();

    if (this.config.autoSequence) {
      this.sequence++;
    }

    return {
      protocol_version: '0.2',
      message_id: messageId,
      message_type: responseType,
      timestamp: new Date().toISOString(),
      agent_id: this.config.agentId,
      instance_id: this.config.instanceId,
      session_id: this.config.sessionId,
      sequence: this.sequence,
      body: body as unknown,
    };
  }

  private generateMessageId(): IdString {
    return generateMessageId();
  }

  private async signMessage(message: ExchangeMessage): Promise<ExchangeMessage> {
    // TODO: 実際の署名
    // 現状は署名なし
    return {
      ...message,
      signature_or_mac: '',
    };
  }

  // ==========================================================================
  // Transport
  // ==========================================================================

  private async sendRaw(message: ExchangeMessage): Promise<void> {
    const response = await fetch(this.config.exchangeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }
  }

  private async sendWithResponse<T>(
    message: ExchangeMessage,
    timeout?: number
  ): Promise<T> {
    const timeoutMs = timeout || this.config.timeout || 30000;

    return new Promise<T>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(message.message_id);
        reject(new Error(`Request timeout for message ${message.message_id}`));
      }, timeoutMs);

      this.pendingRequests.set(message.message_id, {
        resolve: (response) => {
          resolve(response.body as T);
        },
        reject,
        timeout: timeoutHandle,
      });

      this.sendRaw(message).catch(error => {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(message.message_id);
        reject(error);
      });
    });
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * イベントハンドラ登録
   */
  addEventHandler(handler: ClientEventHandler): void {
    this.eventEmitter.add(handler);
  }

  /**
   * イベントハンドラ削除
   */
  removeEventHandler(handler: ClientEventHandler): void {
    this.eventEmitter.remove(handler);
  }

  private emitEvent(event: ClientEvent): void {
    this.eventEmitter.emit(event);
  }

  // ==========================================================================
  // State Management
  // ==========================================================================

  /**
   * 現在のシーケンス番号取得
   */
  getSequence(): NonNegativeInteger {
    return this.sequence;
  }

  /**
   * シーケンス番号設定
   */
  setSequence(sequence: NonNegativeInteger): void {
    this.sequence = sequence;
  }

  /**
   * セッションID更新
   */
  updateSessionId(sessionId: IdString): void {
    this.config.sessionId = sessionId;
  }

  /**
   * 設定取得
   */
  getConfig(): ExchangeClientConfig {
    return { ...this.config };
  }

  /**
   * テスト用: ペンディングリクエスト数取得
   */
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * クリーンアップ
   */
  async dispose(): Promise<void> {
    // ペンディングリクエストのタイムアウト
    for (const [messageId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Client disposed'));
    }

    this.pendingRequests.clear();
    this.messageHandlers.clear();
    this.eventEmitter.clear();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Exchange Client作成
 */
export function createExchangeClient(config: ExchangeClientConfig): ExchangeClient {
  return new ExchangeClient(config);
}

/**
 * Exchange Client作成 (セッション情報から)
 */
export function createExchangeClientFromSession(
  session: {
    session_id: IdString;
    agent_id: IdString;
    instance_id: IdString;
  },
  exchangeEndpoint: UriString,
  options?: Partial<ExchangeClientConfig>
): ExchangeClient {
  return new ExchangeClient({
    agentId: session.agent_id,
    instanceId: session.instance_id,
    sessionId: session.session_id,
    exchangeEndpoint,
    ...options,
  });
}

// ============================================================================
// Message Builder Utilities
// ============================================================================

/**
 * Hello メッセージビルダー
 */
export function buildHelloMessage(
  displayName: string,
  capabilities: CapabilityName[],
  capabilityDigest: string,
  identityVersion: NonNegativeInteger,
  revocationEpoch: NonNegativeInteger
): HelloBody {
  return {
    display_name: displayName,
    capability_summary: {
      capabilities,
      capability_digest: capabilityDigest,
    },
    identity_version: identityVersion,
    revocation_epoch: revocationEpoch,
  };
}

/**
 * Collab Invite メッセージビルダー
 */
export function buildCollabInviteMessage(
  inviteId: IdString,
  title: string,
  options?: {
    summary?: string;
    riskLevel?: RiskLevel;
    requiresFreshReverification?: boolean;
  }
): CollabInviteBody {
  return {
    invite_id: inviteId,
    title,
    summary: options?.summary,
    risk_level: options?.riskLevel || 'low',
    requires_fresh_reverification: options?.requiresFreshReverification,
  };
}