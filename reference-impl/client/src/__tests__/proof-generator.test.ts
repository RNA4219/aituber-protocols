/**
 * Proof Generator Tests
 * Tests for proof generation functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProofGeneratorImpl,
  type ProofGeneratorConfig,
} from '../proof-generator';
import { generateKeyPair, verifyObject, SIGNATURE_ALGORITHM } from '../crypto';

describe('Proof Generator', () => {
  let config: ProofGeneratorConfig;
  let proofGenerator: ProofGeneratorImpl;

  beforeEach(async () => {
    const keyPair = await generateKeyPair();
    config = {
      agentId: 'agent_test123',
      instanceId: 'instance_test456',
      keyId: 'key_test789',
      algorithm: SIGNATURE_ALGORITHM,
      privateKey: keyPair.privateKey,
    };
    proofGenerator = new ProofGeneratorImpl(config);
  });

  describe('Constructor', () => {
    it('should create a ProofGeneratorImpl instance', () => {
      expect(proofGenerator).toBeInstanceOf(ProofGeneratorImpl);
    });

    it('should store config', () => {
      const customConfig: ProofGeneratorConfig = {
        agentId: 'custom_agent',
        instanceId: 'custom_instance',
        keyId: 'custom_key',
        algorithm: 'ed25519',
      };
      const generator = new ProofGeneratorImpl(customConfig);

      expect(generator).toBeInstanceOf(ProofGeneratorImpl);
    });
  });

  describe('generateSessionKeyPair', () => {
    it('should generate a session key pair with keyId', async () => {
      const result = await proofGenerator.generateSessionKeyPair();

      expect(result).toHaveProperty('keyId');
      expect(result).toHaveProperty('publicKey');
      expect(result).toHaveProperty('privateKey');
    });

    it('should generate keyId starting with session_', async () => {
      const result = await proofGenerator.generateSessionKeyPair();

      expect(result.keyId).toMatch(/^session_/);
    });

    it('should generate unique keyIds on each call', async () => {
      const result1 = await proofGenerator.generateSessionKeyPair();
      const result2 = await proofGenerator.generateSessionKeyPair();

      expect(result1.keyId).not.toBe(result2.keyId);
    });

    it('should generate valid Ed25519 key pairs', async () => {
      const result = await proofGenerator.generateSessionKeyPair();

      // Public key should be 64 hex characters (32 bytes)
      expect(result.publicKey).toHaveLength(64);
      // Private key should be 64 hex characters (32 bytes)
      expect(result.privateKey).toHaveLength(64);
    });
  });

  describe('generateProof', () => {
    const validChallenge = {
      challenge_id: 'challenge_123',
      nonce: 'abc123xyz789def456',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      intent: 'collaboration',
      epochs: {
        identity_version: 1,
        revocation_epoch: 10,
        policy_epoch: 5,
        session_epoch: 100,
        ledger_checkpoint: 'checkpoint_abc',
      },
    };

    it('should generate a valid Proof object', async () => {
      const proof = await proofGenerator.generateProof(validChallenge);

      expect(proof).toHaveProperty('spec_version');
      expect(proof).toHaveProperty('proof_id');
      expect(proof).toHaveProperty('challenge_id');
      expect(proof).toHaveProperty('agent_id');
      expect(proof).toHaveProperty('instance_id');
      expect(proof).toHaveProperty('nonce');
      expect(proof).toHaveProperty('timestamp');
      expect(proof).toHaveProperty('expires_at');
      expect(proof).toHaveProperty('intent');
      expect(proof).toHaveProperty('capability_digest');
      expect(proof).toHaveProperty('identity_version');
      expect(proof).toHaveProperty('revocation_epoch');
      expect(proof).toHaveProperty('policy_epoch');
      expect(proof).toHaveProperty('session_epoch');
      expect(proof).toHaveProperty('session_pubkey');
      expect(proof).toHaveProperty('signature');
    });

    it('should use correct spec_version', async () => {
      const proof = await proofGenerator.generateProof(validChallenge);

      expect(proof.spec_version).toBe('0.2');
    });

    it('should include correct challenge_id', async () => {
      const proof = await proofGenerator.generateProof(validChallenge);

      expect(proof.challenge_id).toBe(validChallenge.challenge_id);
    });

    it('should include correct agent_id from config', async () => {
      const proof = await proofGenerator.generateProof(validChallenge);

      expect(proof.agent_id).toBe(config.agentId);
    });

    it('should include correct instance_id from config', async () => {
      const proof = await proofGenerator.generateProof(validChallenge);

      expect(proof.instance_id).toBe(config.instanceId);
    });

    it('should include correct nonce from challenge', async () => {
      const proof = await proofGenerator.generateProof(validChallenge);

      expect(proof.nonce).toBe(validChallenge.nonce);
    });

    it('should include correct expires_at from challenge', async () => {
      const proof = await proofGenerator.generateProof(validChallenge);

      expect(proof.expires_at).toBe(validChallenge.expires_at);
    });

    it('should include correct intent from challenge', async () => {
      const proof = await proofGenerator.generateProof(validChallenge);

      expect(proof.intent).toBe(validChallenge.intent);
    });

    it('should copy epoch values from challenge', async () => {
      const proof = await proofGenerator.generateProof(validChallenge);

      expect(proof.identity_version).toBe(validChallenge.epochs.identity_version);
      expect(proof.revocation_epoch).toBe(validChallenge.epochs.revocation_epoch);
      expect(proof.policy_epoch).toBe(validChallenge.epochs.policy_epoch);
      expect(proof.session_epoch).toBe(validChallenge.epochs.session_epoch);
    });

    it('should generate valid session_pubkey structure', async () => {
      const proof = await proofGenerator.generateProof(validChallenge);

      expect(proof.session_pubkey).toHaveProperty('key_id');
      expect(proof.session_pubkey).toHaveProperty('algorithm');
      expect(proof.session_pubkey).toHaveProperty('public_key');
      expect(proof.session_pubkey.algorithm).toBe(SIGNATURE_ALGORITHM);
    });

    it('should generate valid signature structure', async () => {
      const proof = await proofGenerator.generateProof(validChallenge);

      expect(proof.signature).toHaveProperty('key_id');
      expect(proof.signature).toHaveProperty('algorithm');
      expect(proof.signature).toHaveProperty('canonicalization');
      expect(proof.signature).toHaveProperty('value');
      expect(proof.signature.key_id).toBe(config.keyId);
      expect(proof.signature.algorithm).toBe(config.algorithm);
    });

    it('should generate proof_id starting with proof_', async () => {
      const proof = await proofGenerator.generateProof(validChallenge);

      expect(proof.proof_id).toMatch(/^proof_/);
    });

    it('should generate unique proof_ids', async () => {
      const proof1 = await proofGenerator.generateProof(validChallenge);
      // Need to create a new challenge for second proof
      const challenge2 = { ...validChallenge, challenge_id: 'challenge_456' };
      const proof2 = await proofGenerator.generateProof(challenge2);

      expect(proof1.proof_id).not.toBe(proof2.proof_id);
    });

    it('should reuse session key pair for subsequent proofs', async () => {
      const proof1 = await proofGenerator.generateProof(validChallenge);
      const challenge2 = { ...validChallenge, challenge_id: 'challenge_456' };
      const proof2 = await proofGenerator.generateProof(challenge2);

      // Same session key pair should be reused
      expect(proof1.session_pubkey.key_id).toBe(proof2.session_pubkey.key_id);
      expect(proof1.session_pubkey.public_key).toBe(proof2.session_pubkey.public_key);
    });

    it('should generate capability_digest with sha256 prefix', async () => {
      const proof = await proofGenerator.generateProof(validChallenge);

      expect(proof.capability_digest).toMatch(/^sha256:/);
    });

    it('should generate non-empty signature value', async () => {
      const proof = await proofGenerator.generateProof(validChallenge);

      expect(proof.signature.value).toBeTruthy();
      expect(proof.signature.value.length).toBeGreaterThan(0);
    });

    it('should generate valid ISO timestamp', async () => {
      const proof = await proofGenerator.generateProof(validChallenge);

      const timestamp = new Date(proof.timestamp);
      expect(timestamp.toISOString()).toBe(proof.timestamp);
    });

    it('should work without privateKey configured (uses session key for signing)', async () => {
      const configWithoutKey: ProofGeneratorConfig = {
        agentId: 'agent_test',
        instanceId: 'instance_test',
        keyId: 'key_test',
        algorithm: 'ed25519',
        // privateKey is undefined - proof generator uses session key pair for signing
      };
      const generator = new ProofGeneratorImpl(configWithoutKey);

      // Should work because signing uses the session key pair, not config.privateKey
      const proof = await generator.generateProof(validChallenge);

      expect(proof).toBeDefined();
      expect(proof.signature.value).toBeTruthy();
      expect(proof.signature.value.length).toBeGreaterThan(0);
    });

    describe('Proof with different epoch values', () => {
      it('should handle zero epoch values', async () => {
        const challengeWithZeros = {
          ...validChallenge,
          epochs: {
            identity_version: 0,
            revocation_epoch: 0,
            policy_epoch: 0,
            session_epoch: 0,
            ledger_checkpoint: '',
          },
        };

        const proof = await proofGenerator.generateProof(challengeWithZeros);

        expect(proof.identity_version).toBe(0);
        expect(proof.revocation_epoch).toBe(0);
        expect(proof.policy_epoch).toBe(0);
        expect(proof.session_epoch).toBe(0);
      });

      it('should handle large epoch values', async () => {
        const challengeWithLargeValues = {
          ...validChallenge,
          epochs: {
            identity_version: Number.MAX_SAFE_INTEGER,
            revocation_epoch: Number.MAX_SAFE_INTEGER,
            policy_epoch: Number.MAX_SAFE_INTEGER,
            session_epoch: Number.MAX_SAFE_INTEGER,
            ledger_checkpoint: 'checkpoint_large',
          },
        };

        const proof = await proofGenerator.generateProof(challengeWithLargeValues);

        expect(proof.identity_version).toBe(Number.MAX_SAFE_INTEGER);
      });
    });

    describe('Proof with different intents', () => {
      it('should handle collaboration intent', async () => {
        const challenge = { ...validChallenge, intent: 'collaboration' };
        const proof = await proofGenerator.generateProof(challenge);

        expect(proof.intent).toBe('collaboration');
      });

      it('should handle message intent', async () => {
        const challenge = { ...validChallenge, intent: 'message' };
        const proof = await proofGenerator.generateProof(challenge);

        expect(proof.intent).toBe('message');
      });

      it('should handle custom intent', async () => {
        const challenge = { ...validChallenge, intent: 'custom_action' };
        const proof = await proofGenerator.generateProof(challenge);

        expect(proof.intent).toBe('custom_action');
      });
    });
  });

  describe('Multiple Proof Generators', () => {
    it('should generate independent session keys for different generators', async () => {
      const keyPair1 = await generateKeyPair();
      const keyPair2 = await generateKeyPair();

      const config1: ProofGeneratorConfig = {
        agentId: 'agent1',
        instanceId: 'instance1',
        keyId: 'key1',
        algorithm: SIGNATURE_ALGORITHM,
        privateKey: keyPair1.privateKey,
      };

      const config2: ProofGeneratorConfig = {
        agentId: 'agent2',
        instanceId: 'instance2',
        keyId: 'key2',
        algorithm: SIGNATURE_ALGORITHM,
        privateKey: keyPair2.privateKey,
      };

      const generator1 = new ProofGeneratorImpl(config1);
      const generator2 = new ProofGeneratorImpl(config2);

      const challenge = {
        challenge_id: 'challenge_multi',
        nonce: 'nonce_multi',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        intent: 'test',
        epochs: {
          identity_version: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          session_epoch: 1,
          ledger_checkpoint: 'checkpoint',
        },
      };

      const proof1 = await generator1.generateProof(challenge);
      const proof2 = await generator2.generateProof(challenge);

      // Different generators should have different session keys
      expect(proof1.session_pubkey.key_id).not.toBe(proof2.session_pubkey.key_id);
      expect(proof1.session_pubkey.public_key).not.toBe(proof2.session_pubkey.public_key);
    });
  });
});