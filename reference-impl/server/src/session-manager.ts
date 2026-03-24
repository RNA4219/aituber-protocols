/**
 * Session Manager - セッション管理
 *
 * Agent間の認証済み通信セッションを管理。
 * セッションの作成・更新・終了のライフサイクル管理を担当。
 *
 * ## 主な責務
 * - セッション作成: 認証成功後のセッション確立
 * - セッション更新: 有効期限延長・権限変更
 * - セッション終了: 期限切れ・手動終了・強制終了
 * - セッション検索: ID・Agent単位でのセッション取得
 *
 * ## セッション状態遷移
 * ```
 * active -> renewing -> active (更新)
 * active -> expired (期限切れ)
 * active -> terminated (終了)
 * ```
 *
 * @see ../../../specs/core/interfaces.md
 */

import type {
  IdString,
  Timestamp,
  Signature,
  NonNegativeInteger,
  RiskLevel,
  SessionStatus,
  SessionTerminationReason,
  CapabilitySummary,
} from './types.js';
import { DEFAULT_SESSION_TTL_SEC, generateSessionId } from './utils.js';

/** Session */
export interface Session {
  spec_version: string;
  session_id: IdString;
  agent_id: IdString;
  instance_id: IdString;
  issued_at: Timestamp;
  expires_at: Timestamp;
  session_epoch: NonNegativeInteger;
  revocation_epoch: NonNegativeInteger;
  policy_epoch: NonNegativeInteger;
  identity_version: NonNegativeInteger;
  sequence: NonNegativeInteger;
  capabilities?: CapabilitySummary;
  risk_level?: RiskLevel;
  status: SessionStatus;
  ledger_checkpoint: string;
  termination_reason?: SessionTerminationReason;
  signature?: Signature;
}

/** Session Manager 設定 */
export interface SessionManagerConfig {
  /** Session TTL (秒) */
  sessionTtl: number;
  /** 最大同時セッション数 */
  maxSessions: number;
}

/** デフォルトSession Manager設定 */
export const DEFAULT_SESSION_MANAGER_CONFIG: SessionManagerConfig = {
  sessionTtl: DEFAULT_SESSION_TTL_SEC,
  maxSessions: 1000,
};

/** Session Manager インターフェース */
export interface SessionManager {
  /** セッション作成 */
  createSession(request: {
    agent_id: IdString;
    instance_id: IdString;
    risk_level: RiskLevel;
    capabilities?: CapabilitySummary;
    identity_version: NonNegativeInteger;
    revocation_epoch: NonNegativeInteger;
    policy_epoch: NonNegativeInteger;
    ledger_checkpoint: string;
  }): Promise<Session>;

  /** セッション取得 */
  getSession(sessionId: IdString): Promise<Session | null>;

  /** セッション更新 */
  renewSession(sessionId: IdString): Promise<Session>;

  /** セッション終了 */
  terminateSession(sessionId: IdString, reason: SessionTerminationReason): Promise<void>;

  /** Agentの全セッションを終了 */
  terminateAgentSessions(agentId: IdString, reason: SessionTerminationReason): Promise<number>;

  /** 期限切れセッションのクリーンアップ */
  cleanupExpiredSessions(): Promise<number>;
}

/**
 * Session Manager 実装
 */
export class SessionManagerImpl implements SessionManager {
  private config: SessionManagerConfig;
  private sessions: Map<IdString, Session>;
  private agentSessions: Map<IdString, Set<IdString>>;
  private sessionEpoch: NonNegativeInteger;

  constructor(config: SessionManagerConfig) {
    this.config = config;
    this.sessions = new Map();
    this.agentSessions = new Map();
    this.sessionEpoch = 0;
  }

  async createSession(request: {
    agent_id: IdString;
    instance_id: IdString;
    risk_level: RiskLevel;
    capabilities?: CapabilitySummary;
    identity_version: NonNegativeInteger;
    revocation_epoch: NonNegativeInteger;
    policy_epoch: NonNegativeInteger;
    ledger_checkpoint: string;
  }): Promise<Session> {
    // Session ID生成
    const sessionId = generateSessionId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.sessionTtl * 1000);
    this.sessionEpoch++;

    const session: Session = {
      spec_version: '0.2',
      session_id: sessionId,
      agent_id: request.agent_id,
      instance_id: request.instance_id,
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      session_epoch: this.sessionEpoch,
      revocation_epoch: request.revocation_epoch,
      policy_epoch: request.policy_epoch,
      identity_version: request.identity_version,
      sequence: 0,
      capabilities: request.capabilities,
      risk_level: request.risk_level,
      status: 'active',
      ledger_checkpoint: request.ledger_checkpoint,
    };

    // セッション保存
    this.sessions.set(sessionId, session);

    // Agent → Sessions マッピング
    if (!this.agentSessions.has(request.agent_id)) {
      this.agentSessions.set(request.agent_id, new Set());
    }
    const agentSessionSet = this.agentSessions.get(request.agent_id);
    if (agentSessionSet) {
      agentSessionSet.add(sessionId);
    }

    return session;
  }

  async getSession(sessionId: IdString): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // 期限チェック (既にterminatedの場合は変更しない)
    if (session.status !== 'terminated' && new Date(session.expires_at) < new Date()) {
      session.status = 'expired';
    }

    return session;
  }

  async renewSession(sessionId: IdString): Promise<Session> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status === 'terminated') {
      throw new Error(`Cannot renew terminated session: ${sessionId}`);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.sessionTtl * 1000);
    this.sessionEpoch++;

    const renewedSession: Session = {
      ...session,
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      session_epoch: this.sessionEpoch,
      sequence: session.sequence + 1,
      status: 'active',
    };

    this.sessions.set(sessionId, renewedSession);
    return renewedSession;
  }

  async terminateSession(sessionId: IdString, reason: SessionTerminationReason): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'terminated';
    session.termination_reason = reason;

    // Agent → Sessions から削除
    const agentSessions = this.agentSessions.get(session.agent_id);
    if (agentSessions) {
      agentSessions.delete(sessionId);
    }
  }

  async terminateAgentSessions(agentId: IdString, reason: SessionTerminationReason): Promise<number> {
    const sessionIds = this.agentSessions.get(agentId);
    if (!sessionIds) return 0;

    // Terminate all sessions in parallel for better performance
    const sessionIdsArray = Array.from(sessionIds);
    await Promise.all(
      sessionIdsArray.map(sessionId => this.terminateSession(sessionId, reason))
    );

    return sessionIdsArray.length;
  }

  async cleanupExpiredSessions(): Promise<number> {
    const now = new Date();
    const expiredSessions: IdString[] = [];

    // Collect expired session IDs first
    for (const [sessionId, session] of this.sessions) {
      if (new Date(session.expires_at) < now && session.status !== 'terminated') {
        expiredSessions.push(sessionId);
      }
    }

    // Terminate all expired sessions in parallel
    await Promise.all(
      expiredSessions.map(sessionId => this.terminateSession(sessionId, 'expired'))
    );

    return expiredSessions.length;
  }
}