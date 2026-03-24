import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VerifierImpl, type Challenge, type Proof, type VerifierConfig } from '../verifier.js';

// Test vectors from positive-vectors.json and negative-vectors.json
const positiveVectors = {
  POS001: {
    issue_challenge_request: {
      verifier_id: 'agt_A001',
      target_agent_id: 'agt_B001',
      target_instance_id: 'ins_B001_001',
      intent: 'PROFILE_READ',
      required_capabilities: ['profile.read'],
      risk_level: 'LOW' as const,
    },
    challenge: {
      challenge_id: 'chl_20260324_001',
      target_agent_id: 'agt_B001',
      target_instance_id: 'ins_B001_001',
      nonce: 'nonce_abc123xyz789',
      issued_at: '2026-03-24T12:30:00Z',
      expires_at: '2026-03-24T12:31:00Z',
      intent: 'PROFILE_READ',
      risk_level: 'LOW' as const,
    },
    proof: {
      agent_id: 'agt_B001',
      instance_id: 'ins_B001_001',
      nonce: 'nonce_abc123xyz789',
      timestamp: '2026-03-24T12:30:15Z',
      expires_at: '2026-03-24T12:31:00Z',
      intent: 'PROFILE_READ',
      identity_version: 5,
      revocation_epoch: 3,
      policy_epoch: 2,
      session_epoch: 10,
    },
    expected: {
      verification_status: 'VERIFIED',
      verified_agent_id: 'agt_B001',
      verified_instance_id: 'ins_B001_001',
      risk_level: 'LOW',
    },
  },
};

const negativeVectors = {
  NEG001: {
    challenge: {
      challenge_id: 'chl_20260324_neg001',
      target_agent_id: 'agt_B001',
      nonce: 'nonce_invalid_sig',
      issued_at: '2026-03-24T12:40:00Z',
      expires_at: '2026-03-24T12:41:00Z',
    },
    proof: {
      agent_id: 'agt_B001',
      instance_id: 'ins_B001_001',
      nonce: 'nonce_invalid_sig',
      timestamp: '2026-03-24T12:40:15Z',
      signature: 'invalid_or_corrupted_signature_hex',
    },
    expected: {
      code: 'INVALID_SIGNATURE',
      message: 'Proof signature verification failed',
    },
  },
  NEG002: {
    challenge: {
      challenge_id: 'chl_20260324_neg002',
      target_agent_id: 'agt_B001',
      nonce: 'nonce_expired_test',
      issued_at: '2026-03-24T12:00:00Z',
      expires_at: '2026-03-24T12:01:00Z',
    },
    proof: {
      agent_id: 'agt_B001',
      instance_id: 'ins_B001_001',
      nonce: 'nonce_expired_test',
      timestamp: '2026-03-24T12:02:00Z',
    },
    expected: {
      code: 'NONCE_EXPIRED',
      message: 'Challenge nonce has expired',
    },
  },
  NEG003: {
    verifier_time: '2026-03-24T12:40:00Z',
    proof_timestamp: '2026-03-24T12:38:00Z',
    max_allowed_skew_seconds: 120,
    actual_skew_seconds: 180,
    expected: {
      code: 'TIMESTAMP_INVALID',
      message: 'Timestamp exceeds allowed clock skew threshold',
    },
  },
};

const replayVectors = {
  REPLAY001: {
    original_proof: {
      challenge_id: 'chl_20260324_001',
      nonce: 'nonce_abc123xyz789',
      agent_id: 'agt_B001',
      instance_id: 'ins_B001_001',
      timestamp: '2026-03-24T12:30:15Z',
    },
    replay_attempt: {
      challenge_id: 'chl_20260324_001',
      nonce: 'nonce_abc123xyz789',
      agent_id: 'agt_B001',
      instance_id: 'ins_B001_001',
      timestamp: '2026-03-24T12:30:15Z',
    },
    expected: {
      code: 'NONCE_REPLAY',
      message: 'Nonce has already been used - possible replay attack',
    },
  },
};

const rollbackVectors = {
  ROLLBACK001: {
    verifier_state: {
      agent_id: 'agt_B001',
      last_identity_version: 15,
    },
    received_identity: {
      agent_id: 'agt_B001',
      identity_version: 10,
    },
    expected: {
      code: 'IDENTITY_ROLLBACK_DETECTED',
      message: 'Identity version regression detected - possible rollback attack',
    },
  },
};

describe('Verifier', () => {
  let verifier: VerifierImpl;
  const defaultConfig: VerifierConfig = {
    nonceTtl: 60,
    challengeTtl: 60,
    clockSkewTolerance: 120,
    nonceRetention: 420,
    skipSignatureValidation: true, // ユニットテストでは署名検証をスキップ
  };

  beforeEach(() => {
    verifier = new VerifierImpl(defaultConfig);
  });

  describe('Challenge発行テスト', () => {
    it('should issue a challenge with correct properties', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      expect(challenge).toBeDefined();
      expect(challenge.challenge_id).toMatch(/^chl_/);
      expect(challenge.target_agent_id).toBe(request.target_agent_id);
      expect(challenge.target_instance_id).toBe(request.target_instance_id);
      expect(challenge.intent).toBe(request.intent);
      expect(challenge.risk_level).toBe(request.risk_level);
      expect(challenge.nonce).toBeDefined();
      expect(challenge.nonce.length).toBeGreaterThan(0);
    });

    it('should generate unique challenge IDs', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge1 = await verifier.issueChallenge(request);
      const challenge2 = await verifier.issueChallenge(request);

      expect(challenge1.challenge_id).not.toBe(challenge2.challenge_id);
    });

    it('should generate unique nonces for each challenge', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge1 = await verifier.issueChallenge(request);
      const challenge2 = await verifier.issueChallenge(request);

      expect(challenge1.nonce).not.toBe(challenge2.nonce);
    });

    it('should set correct expiration time based on challengeTtl config', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const beforeIssue = Date.now();
      const challenge = await verifier.issueChallenge(request);
      const afterIssue = Date.now();

      const issuedAt = new Date(challenge.issued_at).getTime();
      const expiresAt = new Date(challenge.expires_at).getTime();

      expect(expiresAt - issuedAt).toBe(defaultConfig.challengeTtl * 1000);
      expect(issuedAt).toBeGreaterThanOrEqual(beforeIssue);
      expect(issuedAt).toBeLessThanOrEqual(afterIssue);
    });

    it('should include requested capabilities in challenge', async () => {
      const request = {
        ...positiveVectors.POS001.issue_challenge_request,
        requested_capabilities: ['profile.read', 'profile.write'],
      };
      const challenge = await verifier.issueChallenge(request);

      expect(challenge.requested_capabilities).toEqual(['profile.read', 'profile.write']);
    });

    it('should mark nonce as used when challenge is issued', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      expect(verifier.isNonceUsed(challenge.nonce)).toBe(true);
    });
  });

  describe('Proof検証テスト', () => {
    it('should verify a valid proof successfully', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      const proof: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_001',
        challenge_id: challenge.challenge_id,
        agent_id: positiveVectors.POS001.proof.agent_id,
        instance_id: positiveVectors.POS001.proof.instance_id,
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: positiveVectors.POS001.proof.intent,
        capability_digest: 'sha256:capability_digest_hex',
        identity_version: positiveVectors.POS001.proof.identity_version,
        revocation_epoch: positiveVectors.POS001.proof.revocation_epoch,
        policy_epoch: positiveVectors.POS001.proof.policy_epoch,
        session_epoch: positiveVectors.POS001.proof.session_epoch,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'valid_proof_signature_hex',
        },
      };

      const result = await verifier.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('VERIFIED');
      expect(result.agent_id).toBe(positiveVectors.POS001.expected.verified_agent_id);
      expect(result.instance_id).toBe(positiveVectors.POS001.expected.verified_instance_id);
    });

    it('should reject proof with invalid signature', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      // Mock signature verification to return false
      vi.spyOn(verifier as unknown as { verifySignature: (p: Proof) => Promise<boolean> }, 'verifySignature')
        .mockResolvedValue(false);

      const proof: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_neg001',
        challenge_id: challenge.challenge_id,
        agent_id: negativeVectors.NEG001.proof.agent_id,
        instance_id: negativeVectors.NEG001.proof.instance_id,
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'invalid_or_corrupted_signature_hex',
        },
      };

      const result = await verifier.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('REJECTED');
      expect(result.errors?.[0]?.code).toBe('INVALID_SIGNATURE');
    });

    it('should reject proof with mismatched nonce', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      const proof: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_nonce_mismatch',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: 'different_nonce_value',
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      const result = await verifier.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('REJECTED');
      expect(result.errors?.[0]?.code).toBe('NONCE_REPLAYED');
    });
  });

  describe('Nonce再利用拒否テスト', () => {
    it('should reject proof with reused nonce (same challenge)', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      const createProof = (): Proof => ({
        spec_version: '0.2',
        proof_id: 'proof_replay',
        challenge_id: challenge.challenge_id,
        agent_id: replayVectors.REPLAY001.original_proof.agent_id,
        instance_id: replayVectors.REPLAY001.original_proof.instance_id,
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'valid_signature_001',
        },
      });

      // First proof should succeed
      const result1 = await verifier.verifyProof(challenge.challenge_id, createProof());
      expect(result1.status).toBe('VERIFIED');

      // Second proof with same nonce should be rejected
      const result2 = await verifier.verifyProof(challenge.challenge_id, createProof());
      expect(result2.status).toBe('REJECTED');
    });

    it('should detect nonce used in different challenge', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge1 = await verifier.issueChallenge(request);
      const challenge2 = await verifier.issueChallenge(request);

      // Nonce from challenge1 should not be accepted for challenge2
      expect(challenge1.nonce).not.toBe(challenge2.nonce);

      // Verify that each nonce is tracked independently
      expect(verifier.isNonceUsed(challenge1.nonce)).toBe(true);
      expect(verifier.isNonceUsed(challenge2.nonce)).toBe(true);
    });

    it('should correctly check if nonce is used', async () => {
      const nonce = 'test_nonce_123';

      expect(verifier.isNonceUsed(nonce)).toBe(false);

      verifier.markNonceUsed(nonce, Date.now() + 60000);

      expect(verifier.isNonceUsed(nonce)).toBe(true);
    });

    it('should allow nonce reuse after expiration', async () => {
      const nonce = 'test_nonce_expired';
      const pastExpiration = Date.now() - 1000; // Already expired

      verifier.markNonceUsed(nonce, pastExpiration);

      expect(verifier.isNonceUsed(nonce)).toBe(false);
    });
  });

  describe('Timestamp skewテスト', () => {
    it('should reject proof with timestamp exceeding clock skew tolerance', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      // Create proof with timestamp far in the past
      const pastTime = new Date(Date.now() - 200000); // 200 seconds ago, exceeds 120s tolerance
      const proof: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_skew',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: pastTime.toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      const result = await verifier.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('REJECTED');
      expect(result.errors?.[0]?.code).toBe('TIMESTAMP_INVALID');
    });

    it('should accept proof with timestamp within clock skew tolerance', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      // Create proof with timestamp slightly in the past (within tolerance)
      const withinToleranceTime = new Date(Date.now() - 60000); // 60 seconds ago, within 120s tolerance
      const proof: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_skew_ok',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: withinToleranceTime.toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      const result = await verifier.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('VERIFIED');
    });

    it('should accept proof with timestamp slightly in the future within tolerance', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      // Create proof with timestamp slightly in the future
      const futureTime = new Date(Date.now() + 30000); // 30 seconds in future
      const proof: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_future',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: futureTime.toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      const result = await verifier.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('VERIFIED');
    });

    it('should reject proof with timestamp far in the future', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      // Create proof with timestamp far in the future
      const farFutureTime = new Date(Date.now() + 200000); // 200 seconds in future
      const proof: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_far_future',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: farFutureTime.toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      const result = await verifier.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('REJECTED');
      expect(result.errors?.[0]?.code).toBe('TIMESTAMP_INVALID');
    });
  });

  describe('Challenge期限切れテスト', () => {
    it('should reject proof for expired challenge', async () => {
      // Create verifier with very short challenge TTL
      const shortTtlVerifier = new VerifierImpl({
        ...defaultConfig,
        challengeTtl: 0.1, // 100ms
      });

      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await shortTtlVerifier.issueChallenge(request);

      // Wait for challenge to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      const proof: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_expired',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      const result = await shortTtlVerifier.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('REJECTED');
      expect(result.errors?.[0]?.code).toBe('NONCE_EXPIRED');
    });

    it('should reject proof for non-existent challenge', async () => {
      const proof: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_nonexistent',
        challenge_id: 'nonexistent_challenge_id',
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: 'some_nonce',
        timestamp: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60000).toISOString(),
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      const result = await verifier.verifyProof('nonexistent_challenge_id', proof);

      expect(result.status).toBe('REJECTED');
      expect(result.errors?.[0]?.code).toBe('NONCE_EXPIRED');
    });
  });

  describe('Identity Version チェックテスト', () => {
    it('should flag identity version rollback', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      // First, verify with higher identity version
      const proof1: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_1',
        challenge_id: challenge.challenge_id,
        agent_id: rollbackVectors.ROLLBACK001.verifier_state.agent_id,
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: rollbackVectors.ROLLBACK001.verifier_state.last_identity_version,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      await verifier.verifyProof(challenge.challenge_id, proof1);

      // Now try with a lower identity version (new challenge needed)
      const challenge2 = await verifier.issueChallenge(request);
      const proof2: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_2',
        challenge_id: challenge2.challenge_id,
        agent_id: rollbackVectors.ROLLBACK001.verifier_state.agent_id,
        instance_id: 'ins_B001_001',
        nonce: challenge2.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge2.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: rollbackVectors.ROLLBACK001.received_identity.identity_version,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      const result = await verifier.verifyProof(challenge2.challenge_id, proof2);

      expect(result.status).toBe('REJECTED');
      expect(result.errors?.[0]?.code).toBe('IDENTITY_ROLLBACK_DETECTED');
      expect(result.version_check?.rollback_detected).toBe(true);
      expect(result.version_check?.epoch_mismatch).toBe(false);
      expect(result.version_check?.session_epoch_old).toBe(false);
      expect(result.version_check?.policy_mismatch).toBe(false);
    });

    it('should accept proof with higher identity version', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      const proof: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_higher',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 10, // Higher version
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      const result = await verifier.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('VERIFIED');
      expect(result.version_check?.rollback_detected).toBe(false);
      expect(result.version_check?.epoch_mismatch).toBe(false);
      expect(result.version_check?.session_epoch_old).toBe(false);
      expect(result.version_check?.policy_mismatch).toBe(false);
    });

    it('should warn on revocation epoch regression (epoch_mismatch)', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      // First, verify with higher revocation_epoch
      const proof1: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_1',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 10, // Higher revocation epoch
        policy_epoch: 2,
        session_epoch: 5,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      await verifier.verifyProof(challenge.challenge_id, proof1);

      // Now try with a lower revocation_epoch (new challenge needed)
      const challenge2 = await verifier.issueChallenge(request);
      const proof2: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_2',
        challenge_id: challenge2.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge2.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge2.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3, // Lower revocation epoch (regression)
        policy_epoch: 2,
        session_epoch: 5,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      const result = await verifier.verifyProof(challenge2.challenge_id, proof2);

      expect(result.status).toBe('VERIFIED');
      expect(result.version_check?.epoch_mismatch).toBe(true);
      expect(result.version_check?.rollback_detected).toBe(false);
      expect(result.version_check?.session_epoch_old).toBe(false);
      expect(result.version_check?.policy_mismatch).toBe(false);
    });

    it('should warn on session epoch regression (session_epoch_old)', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      // First, verify with higher session_epoch
      const proof1: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_1',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 20, // Higher session epoch
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      await verifier.verifyProof(challenge.challenge_id, proof1);

      // Now try with a lower session_epoch (new challenge needed)
      const challenge2 = await verifier.issueChallenge(request);
      const proof2: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_2',
        challenge_id: challenge2.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge2.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge2.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 5, // Lower session epoch (regression)
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      const result = await verifier.verifyProof(challenge2.challenge_id, proof2);

      expect(result.status).toBe('VERIFIED');
      expect(result.version_check?.session_epoch_old).toBe(true);
      expect(result.version_check?.rollback_detected).toBe(false);
      expect(result.version_check?.epoch_mismatch).toBe(false);
      expect(result.version_check?.policy_mismatch).toBe(false);
    });

    it('should not flag when same values are provided (no regression)', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      // First, verify with specific epoch values
      const proof1: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_1',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 10,
        policy_epoch: 3,
        session_epoch: 15,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      await verifier.verifyProof(challenge.challenge_id, proof1);

      // Now try with the same values (new challenge needed)
      const challenge2 = await verifier.issueChallenge(request);
      const proof2: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_2',
        challenge_id: challenge2.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge2.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge2.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5, // Same identity version
        revocation_epoch: 10, // Same revocation epoch
        policy_epoch: 3, // Same policy epoch
        session_epoch: 15, // Same session epoch
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      const result = await verifier.verifyProof(challenge2.challenge_id, proof2);

      // Same values should not trigger any flags
      expect(result.status).toBe('VERIFIED');
      expect(result.version_check?.rollback_detected).toBe(false);
      expect(result.version_check?.epoch_mismatch).toBe(false);
      expect(result.version_check?.session_epoch_old).toBe(false);
      expect(result.version_check?.policy_mismatch).toBe(false);
    });

    it('should warn on policy epoch regression (policy_mismatch)', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      // First, verify with higher policy_epoch
      const proof1: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_1',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 10, // Higher policy epoch
        session_epoch: 5,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      await verifier.verifyProof(challenge.challenge_id, proof1);

      // Now try with a lower policy_epoch (new challenge needed)
      const challenge2 = await verifier.issueChallenge(request);
      const proof2: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_2',
        challenge_id: challenge2.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge2.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge2.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2, // Lower policy epoch (regression)
        session_epoch: 5,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      const result = await verifier.verifyProof(challenge2.challenge_id, proof2);

      expect(result.status).toBe('VERIFIED');
      expect(result.version_check?.policy_mismatch).toBe(true);
      expect(result.version_check?.rollback_detected).toBe(false);
      expect(result.version_check?.epoch_mismatch).toBe(false);
      expect(result.version_check?.session_epoch_old).toBe(false);
    });

    it('should REJECT when identity_version rollback combined with epoch rollback', async () => {
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifier.issueChallenge(request);

      // First, verify with higher values
      const proof1: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_1',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 20,
        revocation_epoch: 15,
        policy_epoch: 10,
        session_epoch: 25,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      await verifier.verifyProof(challenge.challenge_id, proof1);

      // Now try with both identity_version rollback AND epoch rollbacks (new challenge needed)
      const challenge2 = await verifier.issueChallenge(request);
      const proof2: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_2',
        challenge_id: challenge2.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge2.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge2.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 10, // Identity version rollback
        revocation_epoch: 5, // Revocation epoch rollback
        policy_epoch: 3, // Policy epoch rollback
        session_epoch: 10, // Session epoch rollback
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'signature',
        },
      };

      const result = await verifier.verifyProof(challenge2.challenge_id, proof2);

      // Identity version rollback should cause REJECTION
      expect(result.status).toBe('REJECTED');
      expect(result.errors?.[0]?.code).toBe('IDENTITY_ROLLBACK_DETECTED');
      // All rollback indicators should be flagged
      expect(result.version_check?.rollback_detected).toBe(true);
      expect(result.version_check?.epoch_mismatch).toBe(true);
      expect(result.version_check?.session_epoch_old).toBe(true);
      expect(result.version_check?.policy_mismatch).toBe(true);
    });
  });

  describe('署名検証エッジケーステスト', () => {
    // 署名検証を有効にしたVerifierを使用
    const signatureVerifyingConfig: VerifierConfig = {
      nonceTtl: 60,
      challengeTtl: 60,
      clockSkewTolerance: 120,
      nonceRetention: 420,
      skipSignatureValidation: false, // 署名検証を有効化
    };

    it('should reject proof when signature is missing', async () => {
      const verifierWithSigCheck = new VerifierImpl(signatureVerifyingConfig);
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifierWithSigCheck.issueChallenge(request);

      const proof: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_no_sig',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: '', // Empty signature value
        },
      };

      const result = await verifierWithSigCheck.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('REJECTED');
      expect(result.errors?.[0]?.code).toBe('INVALID_SIGNATURE');
    });

    it('should reject proof when signature object is undefined', async () => {
      const verifierWithSigCheck = new VerifierImpl(signatureVerifyingConfig);
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifierWithSigCheck.issueChallenge(request);

      const proof = {
        spec_version: '0.2',
        proof_id: 'proof_no_sig_obj',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'public_key_hex',
        },
        signature: undefined as unknown as { key_id: string; algorithm: string; canonicalization: string; value: string },
      } as Proof;

      const result = await verifierWithSigCheck.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('REJECTED');
      expect(result.errors?.[0]?.code).toBe('INVALID_SIGNATURE');
    });

    it('should reject proof when session_pubkey is missing', async () => {
      const verifierWithSigCheck = new VerifierImpl(signatureVerifyingConfig);
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifierWithSigCheck.issueChallenge(request);

      const proof = {
        spec_version: '0.2',
        proof_id: 'proof_no_pubkey',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: undefined as unknown as { key_id: string; algorithm: string; public_key: string },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'some_signature_hex',
        },
      } as Proof;

      const result = await verifierWithSigCheck.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('REJECTED');
      expect(result.errors?.[0]?.code).toBe('INVALID_SIGNATURE');
    });

    it('should reject proof when session_pubkey.public_key is missing', async () => {
      const verifierWithSigCheck = new VerifierImpl(signatureVerifyingConfig);
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifierWithSigCheck.issueChallenge(request);

      const proof: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_no_pubkey_value',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: '', // Empty public key
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'some_signature_hex',
        },
      };

      const result = await verifierWithSigCheck.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('REJECTED');
      expect(result.errors?.[0]?.code).toBe('INVALID_SIGNATURE');
    });

    it('should reject proof when verifySignature throws an exception', async () => {
      const verifierWithSigCheck = new VerifierImpl(signatureVerifyingConfig);
      const request = positiveVectors.POS001.issue_challenge_request;
      const challenge = await verifierWithSigCheck.issueChallenge(request);

      // Spy on verifySignature to throw an error
      vi.spyOn(verifierWithSigCheck as unknown as { verifySignature: (p: Proof) => Promise<boolean> }, 'verifySignature')
        .mockImplementation(() => Promise.reject(new Error('Crypto error')));

      const proof: Proof = {
        spec_version: '0.2',
        proof_id: 'proof_exception',
        challenge_id: challenge.challenge_id,
        agent_id: 'agt_B001',
        instance_id: 'ins_B001_001',
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        expires_at: challenge.expires_at,
        intent: 'PROFILE_READ',
        capability_digest: 'sha256:digest',
        identity_version: 5,
        revocation_epoch: 3,
        policy_epoch: 2,
        session_epoch: 10,
        session_pubkey: {
          key_id: 'session_key_001',
          algorithm: 'ed25519',
          public_key: 'valid_public_key_hex',
        },
        signature: {
          key_id: 'opk_B001_1',
          algorithm: 'ed25519',
          canonicalization: 'jcs',
          value: 'some_signature_hex',
        },
      };

      const result = await verifierWithSigCheck.verifyProof(challenge.challenge_id, proof);

      // Exception in verifyObject should be caught and result in INVALID_SIGNATURE
      expect(result.status).toBe('REJECTED');
      expect(result.errors?.[0]?.code).toBe('INVALID_SIGNATURE');
    });
  });
});