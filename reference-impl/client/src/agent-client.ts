/**
 * Agent Client - 認証・セッション管理クライアント
 *
 * AITuber相互認証プロトコルにおけるAgent側クライアント実装。
 * Identity解決、Challenge-Response認証、Session管理を担当。
 *
 * ## 主な機能
 * - **Identity解決**: プラットフォーム導線からManifest取得
 * - **Challenge処理**: Challenge受信・Proof生成・送信
 * - **Session管理**: 作成・更新・終了のライフサイクル管理
 * - **Freshness確認**: 最新状態の検証
 *
 * ## 使用例
 * ```typescript
 * const client = new AgentClient({
 *   agentId: 'my-agent',
 *   instanceId: 'instance-001',
 *   keyId: 'key-001',
 *   algorithm: 'ed25519',
 *   privateKey: '...'
 * });
 *
 * // Identity解決
 * const result = await client.resolveIdentity({
 *   discovery_source: { platform_type: 'youtube', ... },
 *   required_freshness: 'LOW'
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
  RiskLevel,
  AgentIdentityRef,
  IdentityManifest,
  Challenge,
  Proof,
  Session,
  ResolveIdentityRequest,
  ResolveIdentityResponse,
  IssueChallengeRequest,
  IssueChallengeResponse,
  VerifyProofRequest,
  VerifyProofResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  RenewSessionRequest,
  TerminateSessionRequest,
  CheckFreshnessRequest,
  CheckFreshnessResponse,
  AgentClientConfig,
  ClientEvent,
  ClientEventHandler,
  ClientEventType,
  EpochBundle,
  CapabilitySummary,
  DiscoverySource,
  SessionStatus,
} from './types.js';
import { DEFAULT_TIMEOUT_MS, DEFAULT_CACHE_TTL_MS, Cache, EventEmitter } from './utils.js';

/**
 * Agent Client 実装
 *
 * 責務:
 * - Identity解決
 * - Manifest取得
 * - Challenge受信
 * - Proof送信
 * - Session管理
 */
export class AgentClient {
  private config: AgentClientConfig;
  private sessions: Map<IdString, Session> = new Map();
  private manifestCache: Cache<IdentityManifest>;
  private eventEmitter: EventEmitter<ClientEvent> = new EventEmitter();
  private currentVersionVector: EpochBundle | null = null;

  constructor(config: AgentClientConfig) {
    this.config = {
      timeout: DEFAULT_TIMEOUT_MS,
      ...config,
    };
    this.manifestCache = new Cache<IdentityManifest>(DEFAULT_CACHE_TTL_MS);
  }

  // ==========================================================================
  // Identity Resolution
  // ==========================================================================

  /**
   * プラットフォーム導線からIdentityを解決
   */
  async resolveIdentity(request: ResolveIdentityRequest): Promise<ResolveIdentityResponse> {
    const manifestUrl = request.canonical_hint || this.buildManifestUrl(request.discovery_source);

    try {
      const manifest = await this.fetchManifest(manifestUrl);

      // Binding照合
      const bindingMatch = this.checkBindingMatch(manifest, request.discovery_source);

      // Manifest署名検証
      const signatureValid = await this.verifyManifestSignature(manifest);

      if (!signatureValid) {
        return {
          resolution_status: 'INVALID_MANIFEST_SIGNATURE',
          warnings: ['Manifest signature verification failed'],
        };
      }

      if (!bindingMatch) {
        return {
          resolution_status: 'BINDING_MISMATCH',
          identity_manifest_url: manifestUrl,
          identity_manifest: manifest,
          binding_match: false,
          warnings: ['Platform binding does not match discovery source'],
        };
      }

      // キャッシュに保存
      this.manifestCache.set(manifest.agent_id, manifest);

      return {
        resolution_status: 'RESOLVED',
        identity_manifest_url: manifestUrl,
        identity_manifest: manifest,
        binding_match: true,
        warnings: [],
      };
    } catch (error) {
      return {
        resolution_status: 'NOT_FOUND',
        warnings: [`Failed to resolve identity: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  /**
   * Agent IDから直接Manifest取得
   */
  async getManifest(agentId: IdString): Promise<IdentityManifest | null> {
    // キャッシュ確認
    const cached = this.manifestCache.get(agentId);
    if (cached) {
      return cached;
    }

    // 新規取得
    const manifestUrl = this.buildAgentManifestUrl(agentId);
    try {
      const manifest = await this.fetchManifest(manifestUrl);
      this.manifestCache.set(agentId, manifest);
      return manifest;
    } catch {
      return null;
    }
  }

  private buildManifestUrl(source: DiscoverySource): UriString {
    // プラットフォーム別のwell-known URL構築
    // 実際の実装ではプラットフォーム固有のロジックが必要
    return `https://${source.display_handle}.well-known/aituber/agent.json`;
  }

  private buildAgentManifestUrl(agentId: IdString): UriString {
    return `${this.config.defaultEndpoint || 'https://default'}/.well-known/aituber/${agentId}/agent.json`;
  }

  private async fetchManifest(url: UriString): Promise<IdentityManifest> {
    // HTTP GET実装
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  private checkBindingMatch(manifest: IdentityManifest, source: DiscoverySource): boolean {
    if (!manifest.platform_bindings) return false;

    return manifest.platform_bindings.some(
      binding =>
        binding.platform_type === source.platform_type &&
        binding.platform_account_id === source.platform_account_id
    );
  }

  private async verifyManifestSignature(manifest: IdentityManifest): Promise<boolean> {
    // TODO: 実際の署名検証
    // 現状は署名が存在すれば有効とみなす
    return !manifest.manifest_signature || manifest.manifest_signature.value.length > 0;
  }

  // ==========================================================================
  // Challenge Handling
  // ==========================================================================

  /**
   * Challenge受信 (サーバーからのChallenge待機)
   */
  async receiveChallenge(challengeData: Challenge): Promise<Challenge> {
    // Challenge検証
    this.validateChallenge(challengeData);

    // Version Vector更新
    this.currentVersionVector = challengeData.version_vector;

    return challengeData;
  }

  /**
   * Challenge発行リクエスト送信
   */
  async requestChallenge(
    verifierId: IdString,
    targetAgentId: IdString,
    targetInstanceId: IdString,
    intent: string,
    riskLevel: RiskLevel,
    options?: {
      requiredCapabilities?: string[];
      sessionPubkey?: string;
      nonceTtlSeconds?: number;
    }
  ): Promise<IssueChallengeResponse> {
    const request: IssueChallengeRequest = {
      verifier_id: verifierId,
      target_agent_id: targetAgentId,
      target_instance_id: targetInstanceId,
      intent,
      risk_level: riskLevel,
      required_capabilities: options?.requiredCapabilities,
      session_pubkey: options?.sessionPubkey,
      nonce_ttl_seconds: options?.nonceTtlSeconds,
    };

    const endpoint = await this.getAuthEndpoint(targetAgentId);
    const response = await fetch(`${endpoint}/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Challenge request failed');
    }

    return response.json();
  }

  private validateChallenge(challenge: Challenge): void {
    const now = new Date();
    const expiresAt = new Date(challenge.expires_at);
    const issuedAt = new Date(challenge.issued_at);

    if (now >= expiresAt) {
      throw new Error('Challenge has expired');
    }

    if (now < issuedAt) {
      throw new Error('Challenge issued_at is in the future');
    }

    if (!challenge.nonce || challenge.nonce.length < 16) {
      throw new Error('Invalid challenge nonce');
    }
  }

  // ==========================================================================
  // Proof Submission
  // ==========================================================================

  /**
   * Proof送信・検証
   */
  async submitProof(proof: Proof, verifierAgentId: IdString): Promise<VerifyProofResponse> {
    const endpoint = await this.getAuthEndpoint(verifierAgentId);

    const request: VerifyProofRequest = {
      challenge_id: proof.challenge_id,
      proof,
    };

    const response = await fetch(`${endpoint}/proof/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Proof verification failed');
    }

    const result: VerifyProofResponse = await response.json();

    // イベント発火
    this.emitEvent({
      type: result.verification_status === 'VERIFIED' ? 'session_created' : 'error_occurred',
      timestamp: new Date().toISOString(),
      data: result,
    });

    return result;
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Session作成
   */
  async createSession(
    peerAgentId: IdString,
    peerInstanceId: IdString,
    capabilitySummary: CapabilitySummary,
    riskLevel: RiskLevel,
    versionVector: EpochBundle
  ): Promise<Session> {
    const endpoint = await this.getAuthEndpoint(peerAgentId);

    const request: CreateSessionRequest = {
      verified_agent_id: this.config.agentId,
      verified_instance_id: this.config.instanceId,
      risk_level: riskLevel,
      capability_summary: capabilitySummary,
      version_vector: versionVector,
    };

    const response = await fetch(`${endpoint}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Session creation failed');
    }

    const sessionResponse: CreateSessionResponse = await response.json();

    const session: Session = {
      session_id: sessionResponse.session_id,
      agent_id: sessionResponse.agent_id,
      instance_id: sessionResponse.instance_id,
      peer_agent_id: peerAgentId,
      peer_instance_id: peerInstanceId,
      issued_at: sessionResponse.issued_at,
      expires_at: sessionResponse.expires_at,
      session_epoch: sessionResponse.session_epoch,
      revocation_epoch: sessionResponse.revocation_epoch,
      policy_epoch: sessionResponse.policy_epoch,
      sequence: sessionResponse.sequence,
      effective_capabilities: sessionResponse.effective_capabilities,
      session_status: 'active',
    };

    this.sessions.set(session.session_id, session);

    this.emitEvent({
      type: 'session_created',
      timestamp: new Date().toISOString(),
      data: session,
    });

    return session;
  }

  /**
   * Session更新
   */
  async renewSession(
    sessionId: IdString,
    reason: 'EXPIRY_APPROACHING' | 'HIGH_RISK_REAUTH' | 'CAPABILITY_CHANGE'
  ): Promise<Session> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const endpoint = await this.getAuthEndpoint(session.peer_agent_id);

    const request: RenewSessionRequest = {
      session_id: sessionId,
      agent_id: this.config.agentId,
      instance_id: this.config.instanceId,
      current_sequence: session.sequence,
      reason,
    };

    const response = await fetch(`${endpoint}/session/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Session renewal failed');
    }

    const renewedSession: CreateSessionResponse = await response.json();

    // Session更新
    const updatedSession: Session = {
      ...session,
      issued_at: renewedSession.issued_at,
      expires_at: renewedSession.expires_at,
      session_epoch: renewedSession.session_epoch,
      sequence: renewedSession.sequence,
      effective_capabilities: renewedSession.effective_capabilities,
      session_status: 'active',
    };

    this.sessions.set(sessionId, updatedSession);

    this.emitEvent({
      type: 'session_renewed',
      timestamp: new Date().toISOString(),
      data: updatedSession,
    });

    return updatedSession;
  }

  /**
   * Session終了
   */
  async terminateSession(
    sessionId: IdString,
    reasonCode: Session['session_status'] extends 'terminated' ? never : string,
    reasonDetail?: string
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const endpoint = await this.getAuthEndpoint(session.peer_agent_id);

    const request: TerminateSessionRequest = {
      session_id: sessionId,
      reason_code: reasonCode as any,
      reason_detail: reasonDetail,
    };

    const response = await fetch(`${endpoint}/session/terminate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Session termination failed');
    }

    // Session状態更新
    const terminatedSession: Session = {
      ...session,
      session_status: 'terminated',
    };

    this.sessions.set(sessionId, terminatedSession);

    this.emitEvent({
      type: 'session_terminated',
      timestamp: new Date().toISOString(),
      data: { sessionId, reasonCode, reasonDetail },
    });
  }

  /**
   * アクティブSession取得
   */
  getSession(sessionId: IdString): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 全Session取得
   */
  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * アクティブSession一覧取得
   */
  getActiveSessions(): Session[] {
    return this.getAllSessions().filter(s => s.session_status === 'active');
  }

  // ==========================================================================
  // Freshness Check
  // ==========================================================================

  /**
   * Freshness確認
   */
  async checkFreshness(
    agentId: IdString,
    riskLevel: RiskLevel,
    knownEpochs?: {
      revocationEpoch: NonNegativeInteger;
      identityVersion: NonNegativeInteger;
      ledgerCheckpoint?: string;
    }
  ): Promise<CheckFreshnessResponse> {
    const manifest = await this.getManifest(agentId);
    if (!manifest) {
      return {
        freshness_status: 'unknown',
        agent_status: 'active',
        quarantine_status: 'NONE',
        current_revocation_epoch: knownEpochs?.revocationEpoch || 0,
        current_identity_version: knownEpochs?.identityVersion || 0,
        warnings: ['Could not fetch manifest'],
      };
    }

    const request: CheckFreshnessRequest = {
      agent_id: agentId,
      required_risk_level: riskLevel,
      known_revocation_epoch: knownEpochs?.revocationEpoch || manifest.revocation_epoch,
      known_identity_version: knownEpochs?.identityVersion || manifest.identity_version,
      known_ledger_checkpoint: knownEpochs?.ledgerCheckpoint,
    };

    const endpoint = await this.getRevocationEndpoint(agentId);

    const response = await fetch(`${endpoint}/freshness`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Freshness check failed');
    }

    const result: CheckFreshnessResponse = await response.json();

    this.emitEvent({
      type: 'freshness_changed',
      timestamp: new Date().toISOString(),
      data: result,
    });

    return result;
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
  // Helper Methods
  // ==========================================================================

  private async getAuthEndpoint(agentId: IdString): Promise<UriString> {
    const manifest = await this.getManifest(agentId);
    if (manifest?.service_endpoints?.auth_endpoint) {
      return manifest.service_endpoints.auth_endpoint;
    }
    return this.config.defaultEndpoint || 'https://default/auth';
  }

  private async getRevocationEndpoint(agentId: IdString): Promise<UriString> {
    const manifest = await this.getManifest(agentId);
    if (manifest?.service_endpoints?.revocation_endpoint) {
      return manifest.service_endpoints.revocation_endpoint;
    }
    if (manifest?.revocation_ref) {
      return manifest.revocation_ref;
    }
    return `${this.config.defaultEndpoint || 'https://default'}/revocation`;
  }

  /**
   * 現在のVersion Vector取得
   */
  getCurrentVersionVector(): EpochBundle | null {
    return this.currentVersionVector;
  }

  /**
   * 設定取得
   */
  getConfig(): AgentClientConfig {
    return { ...this.config };
  }

  /**
   * クリーンアップ
   */
  async dispose(): Promise<void> {
    // 全Session終了
    for (const session of this.getActiveSessions()) {
      try {
        await this.terminateSession(session.session_id, 'manual_termination', 'Client disposed');
      } catch (error) {
        console.error('Failed to terminate session during dispose:', error);
      }
    }

    this.sessions.clear();
    this.manifestCache.clear();
    this.eventEmitter.clear();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Agent Client作成
 */
export function createAgentClient(config: AgentClientConfig): AgentClient {
  return new AgentClient(config);
}

/**
 * Identity解決のショートカット
 */
export async function resolveAgentIdentity(
  platformType: string,
  platformAccountId: string,
  displayHandle: string
): Promise<ResolveIdentityResponse> {
  const client = new AgentClient({
    agentId: 'resolver',
    instanceId: `resolver_${Date.now()}`,
    keyId: 'temp',
    algorithm: 'ed25519',
  });

  return client.resolveIdentity({
    discovery_source: {
      platform_type: platformType as any,
      platform_account_id: platformAccountId,
      display_handle: displayHandle,
    },
    required_freshness: 'LOW',
  });
}