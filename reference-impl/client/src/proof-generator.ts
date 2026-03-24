/**
 * Proof Generator - 認証証明生成
 * @see ../../../specs/core/interfaces.md
 */

import type {
  IdString,
  Timestamp,
  NonNegativeInteger,
  Proof,
  HashString,
} from './types.js';
import {
  generateKeyPair,
  signObject,
  hashObject,
  SIGNATURE_ALGORITHM,
  CANONICALIZATION_ALGORITHM,
} from './crypto.js';
import { generateId, generateProofId, now } from './utils.js';

// Re-export Proof type for backward compatibility
export type { Proof } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** 現在のプロトコルバージョン */
export const PROOF_SPEC_VERSION = '0.2';

// ============================================================================
// Types
// ============================================================================

/** Proof Generator 設定 */
export interface ProofGeneratorConfig {
  /** Agent ID */
  agentId: IdString;
  /** Instance ID */
  instanceId: IdString;
  /** 鍵ID */
  keyId: IdString;
  /** アルゴリズム */
  algorithm: string;
  /** 秘密鍵 (hex形式) */
  privateKey?: string;
}

/** Challenge情報 */
export interface ChallengeInfo {
  challenge_id: IdString;
  nonce: string;
  expires_at: Timestamp;
  intent: string;
  epochs: {
    identity_version: NonNegativeInteger;
    revocation_epoch: NonNegativeInteger;
    policy_epoch: NonNegativeInteger;
    session_epoch: NonNegativeInteger;
    ledger_checkpoint: string;
  };
}

/** Session鍵ペア情報 */
export interface SessionKeyPair {
  keyId: IdString;
  publicKey: string;
  privateKey: string;
}

/** Proof Generator インターフェース */
export interface ProofGenerator {
  /** ChallengeからProofを生成 */
  generateProof(challenge: ChallengeInfo): Promise<Proof>;

  /** Session鍵ペアを生成 */
  generateSessionKeyPair(): Promise<SessionKeyPair>;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Proof Generator 実装
 *
 * 責務:
 * - Challengeに対するProof生成
 * - Session鍵ペア管理
 * - Capability digest計算
 * - 署名生成
 */
export class ProofGeneratorImpl implements ProofGenerator {
  private config: ProofGeneratorConfig;
  private sessionKeyPair?: SessionKeyPair;

  constructor(config: ProofGeneratorConfig) {
    this.config = config;
  }

  /**
   * ChallengeからProofを生成する
   *
   * @param challenge - チャレンジ情報
   * @returns 生成されたProof
   */
  async generateProof(challenge: ChallengeInfo): Promise<Proof> {
    // Session鍵ペア確保（遅延初期化）
    const sessionKey = await this.ensureSessionKeyPair();

    // Capability digest計算
    const capabilityDigest = this.calculateCapabilityDigest([]);

    // Proof構築
    const proof: Proof = this.buildProof(challenge, sessionKey, capabilityDigest);

    // 署名生成
    proof.signature.value = await this.signProof(proof);

    return proof;
  }

  /**
   * Session用鍵ペアを生成する
   */
  async generateSessionKeyPair(): Promise<SessionKeyPair> {
    const keyPair = await generateKeyPair();

    return {
      keyId: generateId('session'),
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Session鍵ペアを確保（存在しない場合は生成）
   */
  private async ensureSessionKeyPair(): Promise<SessionKeyPair> {
    if (!this.sessionKeyPair) {
      this.sessionKeyPair = await this.generateSessionKeyPair();
    }
    return this.sessionKeyPair;
  }

  /**
   * Proofオブジェクトを構築
   */
  private buildProof(
    challenge: ChallengeInfo,
    sessionKey: SessionKeyPair,
    capabilityDigest: HashString
  ): Proof {
    return {
      spec_version: PROOF_SPEC_VERSION,
      proof_id: generateProofId(),
      challenge_id: challenge.challenge_id,
      agent_id: this.config.agentId,
      instance_id: this.config.instanceId,
      nonce: challenge.nonce,
      timestamp: now(),
      expires_at: challenge.expires_at,
      intent: challenge.intent,
      capability_digest: capabilityDigest,
      identity_version: challenge.epochs.identity_version,
      revocation_epoch: challenge.epochs.revocation_epoch,
      policy_epoch: challenge.epochs.policy_epoch,
      session_epoch: challenge.epochs.session_epoch,
      session_pubkey: {
        key_id: sessionKey.keyId,
        algorithm: SIGNATURE_ALGORITHM,
        public_key: sessionKey.publicKey,
      },
      signature: {
        key_id: this.config.keyId,
        algorithm: this.config.algorithm,
        canonicalization: CANONICALIZATION_ALGORITHM,
        value: '',
      },
    };
  }

  /**
   * Capability digestを計算
   */
  private calculateCapabilityDigest(capabilities: string[]): HashString {
    const sortedCapabilities = [...capabilities].sort();
    return hashObject({ capabilities: sortedCapabilities });
  }

  /**
   * Proofに署名
   */
  private async signProof(proof: Proof): Promise<string> {
    // 署名対象はsignature.valueを空にしたproofオブジェクト
    const proofForSignature: Proof = {
      ...proof,
      signature: {
        ...proof.signature,
        value: '',
      },
    };

    // セッション秘密鍵で署名（検証はセッション公開鍵で行う）
    return signObject(proofForSignature, this.sessionKeyPair!.privateKey);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Proof Generatorを作成
 */
export function createProofGenerator(config: ProofGeneratorConfig): ProofGenerator {
  return new ProofGeneratorImpl(config);
}