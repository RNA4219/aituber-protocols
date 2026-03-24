/**
 * Verifier - 認証検証者
 *
 * Challenge-Response認証フローにおける検証者(Verifier)の実装。
 * Agentの身元証明を行うためのChallenge発行とProof検証を担当。
 *
 * ## 主な責務
 * - Challenge発行: 対象Agentに対して一意のnonceを含むChallengeを生成
 * - Proof検証: 受け取ったProofの署名・nonce・タイムスタンプを検証
 * - Replay攻撃防止: 使用済みnonceの管理とChallenge再利用の防止
 * - Rollback検出: Version Vectorの監視によるID復帰攻撃検知
 *
 * @see ../../../specs/core/interfaces.md
 * @see ../../../specs/auth/state-machine.md
 */

import type {
  IdString,
  Timestamp,
  Signature,
  NonNegativeInteger,
  RiskLevel,
  FreshnessStatus,
  AgentStatus,
  QuarantineLevel,
  VersionVector,
  CapabilityDigest,
  AgentIdentityRef,
  AuthErrorCode,
} from './types.js';
import {
  DEFAULT_NONCE_TTL_SEC,
  DEFAULT_CHALLENGE_TTL_SEC,
  DEFAULT_CLOCK_SKEW_TOLERANCE_SEC,
  generateChallengeId,
  generateNonce,
} from './utils.js';
import { verifyObject } from './crypto.js';

/** Challenge */
export interface Challenge {
  spec_version: string;
  challenge_id: IdString;
  verifier_id: IdString;
  target_agent_id: IdString;
  target_instance_id: IdString;
  nonce: string;
  issued_at: Timestamp;
  expires_at: Timestamp;
  intent: string;
  risk_level: RiskLevel;
  requested_capabilities?: string[];
  epochs: {
    identity_version: NonNegativeInteger;
    revocation_epoch: NonNegativeInteger;
    policy_epoch: NonNegativeInteger;
    session_epoch: NonNegativeInteger;
    ledger_checkpoint: string;
  };
  signature: Signature;
}

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
  capability_digest: string;
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

/** Verification Result */
export interface VerificationResult {
  status: 'VERIFIED' | 'REJECTED' | 'DEFERRED';
  agent_id?: IdString;
  instance_id?: IdString;
  risk_level?: RiskLevel;
  freshness_status?: FreshnessStatus;
  capability_status?: 'MATCHED' | 'MISMATCHED' | 'DOWNGRADED';
  version_check?: {
    rollback_detected: boolean;
    epoch_mismatch: boolean;
    session_epoch_old: boolean;
    policy_mismatch: boolean;
  };
  errors?: Array<{ code: AuthErrorCode; message: string }>;
}

/** Verifier 設定 */
export interface VerifierConfig {
  /** nonce TTL (秒) */
  nonceTtl: number;
  /** Challenge TTL (秒) */
  challengeTtl: number;
  /** 時刻許容skew (秒) */
  clockSkewTolerance: number;
  /** nonce保持期間 (Challenge TTL + 秒) */
  nonceRetention: number;
  /** 署名検証をスキップするかどうか (テスト用) */
  skipSignatureValidation?: boolean;
}

/** デフォルトVerifier設定 */
export const DEFAULT_VERIFIER_CONFIG: VerifierConfig = {
  nonceTtl: DEFAULT_NONCE_TTL_SEC,
  challengeTtl: DEFAULT_CHALLENGE_TTL_SEC,
  clockSkewTolerance: DEFAULT_CLOCK_SKEW_TOLERANCE_SEC,
  nonceRetention: DEFAULT_CHALLENGE_TTL_SEC + 60,
};

/** Verifier インターフェース */
export interface Verifier {
  /** Challengeを発行 */
  issueChallenge(request: {
    verifier_id: IdString;
    target_agent_id: IdString;
    target_instance_id: IdString;
    intent: string;
    risk_level: RiskLevel;
    requested_capabilities?: string[];
  }): Promise<Challenge>;

  /** Proofを検証 */
  verifyProof(challengeId: IdString, proof: Proof): Promise<VerificationResult>;

  /** nonceが使用済みかチェック */
  isNonceUsed(nonce: string): boolean;

  /** nonceを使用済みとしてマーク */
  markNonceUsed(nonce: string, expiresAt: number): void;
}

/**
 * Verifier 実装
 */
export class VerifierImpl implements Verifier {
  private config: VerifierConfig;
  private challenges: Map<IdString, { challenge: Challenge; issuedAt: number }>;
  private usedNonces: Map<string, number>;
  private consumedChallenges: Set<IdString>;  // 検証済みチャレンジID
  private versionVectors: Map<IdString, VersionVector>;

  constructor(config: VerifierConfig) {
    this.config = config;
    this.challenges = new Map();
    this.usedNonces = new Map();
    this.consumedChallenges = new Set();
    this.versionVectors = new Map();
  }

  async issueChallenge(request: {
    verifier_id: IdString;
    target_agent_id: IdString;
    target_instance_id: IdString;
    intent: string;
    risk_level: RiskLevel;
    requested_capabilities?: string[];
  }): Promise<Challenge> {
    const challengeId = generateChallengeId();
    const nonce = generateNonce();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.challengeTtl * 1000);

    // Version vector取得
    const versionVector = this.versionVectors.get(request.target_agent_id) || {
      identity_version: 0,
      revocation_epoch: 0,
      policy_epoch: 0,
      session_epoch: 0,
      ledger_checkpoint: '',
    };

    const challenge: Challenge = {
      spec_version: '0.2',
      challenge_id: challengeId,
      verifier_id: request.verifier_id,
      target_agent_id: request.target_agent_id,
      target_instance_id: request.target_instance_id,
      nonce,
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      intent: request.intent,
      risk_level: request.risk_level,
      requested_capabilities: request.requested_capabilities,
      epochs: {
        identity_version: versionVector.identity_version,
        revocation_epoch: versionVector.revocation_epoch,
        policy_epoch: versionVector.policy_epoch || 0,
        session_epoch: versionVector.session_epoch || 0,
        ledger_checkpoint: versionVector.ledger_checkpoint || '',
      },
      signature: {
        key_id: 'verifier_key_1',
        algorithm: 'ed25519',
        canonicalization: 'jcs',
        value: '', // TODO: 実際の署名
      },
    };

    // Challenge保存
    this.challenges.set(challengeId, {
      challenge,
      issuedAt: Date.now(),
    });

    // nonceを使用済みとしてマーク
    this.markNonceUsed(nonce, expiresAt.getTime());

    return challenge;
  }

  async verifyProof(challengeId: IdString, proof: Proof): Promise<VerificationResult> {
    // Challenge取得
    const challengeEntry = this.challenges.get(challengeId);
    if (!challengeEntry) {
      return {
        status: 'REJECTED',
        errors: [{ code: 'NONCE_EXPIRED', message: 'Challenge not found' }],
      };
    }

    const challenge = challengeEntry.challenge;

    // 期限チェック
    if (new Date(challenge.expires_at) < new Date()) {
      return {
        status: 'REJECTED',
        errors: [{ code: 'NONCE_EXPIRED', message: 'Challenge expired' }],
      };
    }

    // nonce一致チェック
    if (proof.nonce !== challenge.nonce) {
      return {
        status: 'REJECTED',
        errors: [{ code: 'NONCE_REPLAYED', message: 'Nonce mismatch' }],
      };
    }

    // タイムスタンプチェック
    const proofTime = new Date(proof.timestamp);
    const now = new Date();
    const skew = Math.abs(now.getTime() - proofTime.getTime()) / 1000;
    if (skew > this.config.clockSkewTolerance) {
      return {
        status: 'REJECTED',
        errors: [{ code: 'TIMESTAMP_INVALID', message: `Clock skew ${skew}s exceeds tolerance` }],
      };
    }

    // 署名検証
    const signatureValid = await this.verifySignature(proof);
    if (!signatureValid) {
      return {
        status: 'REJECTED',
        errors: [{ code: 'INVALID_SIGNATURE', message: 'Signature verification failed' }],
      };
    }

    // Nonce再利用チェック (チャレンジIDが既に検証に使用されているか)
    if (this.consumedChallenges.has(challengeId)) {
      return {
        status: 'REJECTED',
        errors: [{ code: 'NONCE_REPLAYED', message: 'Challenge already used in previous proof' }],
      };
    }

    // Version vector チェック (rollback detection)
    const knownVersion = this.versionVectors.get(proof.agent_id);
    const versionCheck = {
      rollback_detected: false,
      epoch_mismatch: false,
      session_epoch_old: false,
      policy_mismatch: false,
    };

    if (knownVersion) {
      if (proof.identity_version < knownVersion.identity_version) {
        versionCheck.rollback_detected = true;
      }
      if (proof.revocation_epoch < knownVersion.revocation_epoch) {
        versionCheck.epoch_mismatch = true;
      }
      if (proof.session_epoch < (knownVersion.session_epoch || 0)) {
        versionCheck.session_epoch_old = true;
      }
      if (proof.policy_epoch < (knownVersion.policy_epoch || 0)) {
        versionCheck.policy_mismatch = true;
      }
    }

    if (versionCheck.rollback_detected) {
      return {
        status: 'REJECTED',
        errors: [{ code: 'IDENTITY_ROLLBACK_DETECTED', message: 'Identity version regression' }],
        version_check: versionCheck,
      };
    }

    // チャレンジを使用済みとしてマーク (再利用防止)
    this.consumedChallenges.add(challengeId);

    // Version vector更新
    this.versionVectors.set(proof.agent_id, {
      identity_version: proof.identity_version,
      revocation_epoch: proof.revocation_epoch,
      policy_epoch: proof.policy_epoch,
      session_epoch: proof.session_epoch,
    });

    return {
      status: 'VERIFIED',
      agent_id: proof.agent_id,
      instance_id: proof.instance_id,
      risk_level: challenge.risk_level,
      freshness_status: 'fresh',
      capability_status: 'MATCHED',
      version_check: versionCheck,
    };
  }

  isNonceUsed(nonce: string): boolean {
    const expiresAt = this.usedNonces.get(nonce);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this.usedNonces.delete(nonce);
      return false;
    }
    return true;
  }

  markNonceUsed(nonce: string, expiresAt: number): void {
    this.usedNonces.set(nonce, expiresAt);
  }

  private async verifySignature(proof: Proof): Promise<boolean> {
    try {
      // テスト用に署名検証をスキップ
      if (this.config.skipSignatureValidation) {
        return true;
      }

      // 署名が存在しない場合は検証失敗
      if (!proof.signature || !proof.signature.value) {
        return false;
      }

      // 公開鍵を取得
      // Proofにはsession_pubkeyが含まれており、これを使用して署名を検証
      const publicKey = proof.session_pubkey?.public_key;
      if (!publicKey) {
        return false;
      }

      // 署名対象データを作成（signature.valueを空にしたオブジェクト）
      // 署名時と同じ形式にする必要がある
      const dataToVerify = {
        ...proof,
        signature: {
          ...proof.signature,
          value: '',
        },
      };

      // verifyObjectで署名検証
      return await verifyObject(dataToVerify, proof.signature.value, publicKey);
    } catch {
      return false;
    }
  }
}