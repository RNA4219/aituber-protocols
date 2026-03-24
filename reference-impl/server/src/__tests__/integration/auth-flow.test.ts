/**
 * Authentication Flow Integration Tests
 *
 * Tests the complete authentication flow using actual module interactions:
 * 1. Identity Resolution
 * 2. Challenge Issuance
 * 3. Proof Generation
 * 4. Proof Verification
 * 5. Session Creation
 *
 * Uses real modules with minimal mocking to validate actual inter-module communication.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VerifierImpl, DEFAULT_VERIFIER_CONFIG, type Challenge, type Proof } from '../../verifier.js';
import { SessionManagerImpl, type SessionManagerConfig } from '../../session-manager.js';
import { IdentityHostImpl, type IdentityManifest } from '../../identity-host.js';
import { ProofGeneratorImpl, type ChallengeInfo } from '../../../../client/src/proof-generator.js';
import { generateKeyPair, signObject, verifyObject } from '../../crypto.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/** Test Agent Configuration */
interface TestAgentConfig {
  agentId: string;
  instanceId: string;
  keyId: string;
  privateKey: string;
  publicKey: string;
}

/** Creates a test agent with real Ed25519 key pair */
async function createTestAgent(id: string): Promise<TestAgentConfig> {
  const keyPair = await generateKeyPair();
  return {
    agentId: `agt_${id}`,
    instanceId: `ins_${id}_001`,
    keyId: `key_${id}_001`,
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
  };
}

/** Creates a test Identity Manifest */
function createTestManifest(agent: TestAgentConfig): IdentityManifest {
  return {
    spec_version: '0.2',
    manifest_version: 1,
    controller_id: `controller_${agent.agentId}`,
    agent_id: agent.agentId,
    identity_version: 1,
    updated_at: new Date().toISOString(),
    ledger_ref: 'https://ledger.example.com/agent/1',
    revocation_ref: 'https://revocation.example.com/agent/1',
    keys: [{
      key_id: agent.keyId,
      scope: 'operation',
      algorithm: 'ed25519',
      public_key: agent.publicKey,
      status: 'active',
      valid_from: new Date().toISOString(),
    }],
    platform_bindings: [{
      platform_type: 'youtube',
      platform_account_id: `channel_${agent.agentId}`,
      display_handle: `@${agent.agentId}`,
      binding_status: 'active',
      verified_at: new Date().toISOString(),
      bound_by_key_id: agent.keyId,
      binding_version: 1,
    }],
    service_endpoints: [{
      name: 'auth',
      url: 'https://auth.example.com',
      kind: 'auth',
    }],
    capability_summary: {
      capabilities: ['profile.read', 'chat.basic'],
      capability_digest: 'sha256:test_digest',
    },
    policy_ref: 'https://policy.example.com/1',
    signatures: [],
  };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Authentication Flow Integration Tests', () => {
  // Each test should create its own instances to ensure isolation
  // These are just type declarations; actual instances are created in each test
  let verifier: VerifierImpl;
  let sessionManager: SessionManagerImpl;
  let identityHost: IdentityHostImpl;

  const sessionConfig: SessionManagerConfig = {
    sessionTtl: 300, // 5 minutes
    maxSessions: 100,
  };

  // Store created agents for cleanup
  const testAgents: TestAgentConfig[] = [];

  beforeEach(async () => {
    // Initialize fresh real modules for each test
    verifier = new VerifierImpl(DEFAULT_VERIFIER_CONFIG);
    sessionManager = new SessionManagerImpl(sessionConfig);
    identityHost = new IdentityHostImpl({
      storageRoot: '/tmp/test-identity',
      cacheTtl: 300,
      skipSignatureValidation: true, // Skip for integration tests
    });
    testAgents.length = 0;
  });

  afterEach(async () => {
    // Cleanup
    testAgents.length = 0;
  });

  // ==========================================================================
  // Complete Authentication Flow
  // ==========================================================================

  describe('Complete Authentication Flow', () => {
    it('should complete full auth flow: challenge -> proof -> session', async () => {
      // Step 1: Create test agents
      const clientAgent = await createTestAgent('client');
      const verifierAgent = await createTestAgent('verifier');
      testAgents.push(clientAgent, verifierAgent);

      // Step 2: Setup Identity Host with manifest
      const manifest = createTestManifest(clientAgent);
      await identityHost.saveManifest(manifest);

      // Step 3: Verifier issues challenge
      const challenge = await verifier.issueChallenge({
        verifier_id: verifierAgent.agentId,
        target_agent_id: clientAgent.agentId,
        target_instance_id: clientAgent.instanceId,
        intent: 'authenticate',
        risk_level: 'low',
        requested_capabilities: ['profile.read'],
      });

      expect(challenge).toBeDefined();
      expect(challenge.challenge_id).toMatch(/^chl_/);
      expect(challenge.target_agent_id).toBe(clientAgent.agentId);
      expect(challenge.nonce).toHaveLength(64); // 32 bytes in hex

      // Step 4: Client creates proof generator and generates proof
      proofGenerator = new ProofGeneratorImpl({
        agentId: clientAgent.agentId,
        instanceId: clientAgent.instanceId,
        keyId: clientAgent.keyId,
        algorithm: 'ed25519',
        privateKey: clientAgent.privateKey,
      });

      const challengeInfo: ChallengeInfo = {
        challenge_id: challenge.challenge_id,
        nonce: challenge.nonce,
        expires_at: challenge.expires_at,
        intent: challenge.intent,
        epochs: challenge.epochs,
      };

      const proof = await proofGenerator.generateProof(challengeInfo);

      expect(proof).toBeDefined();
      expect(proof.proof_id).toMatch(/^proof_/);
      expect(proof.challenge_id).toBe(challenge.challenge_id);
      expect(proof.agent_id).toBe(clientAgent.agentId);
      expect(proof.nonce).toBe(challenge.nonce);
      expect(proof.signature.value).toBeTruthy();
      expect(proof.signature.value).not.toBe('');

      // Step 5: Verifier verifies the proof
      const verificationResult = await verifier.verifyProof(challenge.challenge_id, proof);

      expect(verificationResult.status).toBe('VERIFIED');
      expect(verificationResult.agent_id).toBe(clientAgent.agentId);
      expect(verificationResult.instance_id).toBe(clientAgent.instanceId);
      expect(verificationResult.risk_level).toBe('low');
      expect(verificationResult.freshness_status).toBe('fresh');

      // Step 6: Create session
      const session = await sessionManager.createSession({
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        risk_level: 'low',
        capabilities: ['profile.read'],
        identity_version: proof.identity_version,
        revocation_epoch: proof.revocation_epoch,
        policy_epoch: proof.policy_epoch,
        ledger_checkpoint: proof.session_epoch.toString(),
      });

      expect(session).toBeDefined();
      expect(session.session_id).toMatch(/^ses_/);
      expect(session.agent_id).toBe(clientAgent.agentId);
      expect(session.status).toBe('active');
    });

    it('should reject proof with mismatched nonce', async () => {
      const clientAgent = await createTestAgent('client2');
      const verifierAgent = await createTestAgent('verifier2');
      testAgents.push(clientAgent, verifierAgent);

      // Issue challenge
      const challenge = await verifier.issueChallenge({
        verifier_id: verifierAgent.agentId,
        target_agent_id: clientAgent.agentId,
        target_instance_id: clientAgent.instanceId,
        intent: 'authenticate',
        risk_level: 'low',
      });

      // Generate proof with different nonce
      proofGenerator = new ProofGeneratorImpl({
        agentId: clientAgent.agentId,
        instanceId: clientAgent.instanceId,
        keyId: clientAgent.keyId,
        algorithm: 'ed25519',
        privateKey: clientAgent.privateKey,
      });

      const challengeInfo: ChallengeInfo = {
        challenge_id: challenge.challenge_id,
        nonce: '0'.repeat(64), // Wrong nonce
        expires_at: challenge.expires_at,
        intent: challenge.intent,
        epochs: challenge.epochs,
      };

      const proof = await proofGenerator.generateProof(challengeInfo);

      // Verification should fail
      const result = await verifier.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('REJECTED');
      expect(result.errors).toBeDefined();
      expect(result.errors?.some(e => e.code === 'NONCE_REPLAYED')).toBe(true);
    });

    it('should reject proof for expired challenge', async () => {
      const clientAgent = await createTestAgent('client3');
      const verifierAgent = await createTestAgent('verifier3');
      testAgents.push(clientAgent, verifierAgent);

      // Create verifier with very short TTL
      const shortTtlVerifier = new VerifierImpl({
        ...DEFAULT_VERIFIER_CONFIG,
        challengeTtl: 0.1, // 100ms
      });

      const challenge = await shortTtlVerifier.issueChallenge({
        verifier_id: verifierAgent.agentId,
        target_agent_id: clientAgent.agentId,
        target_instance_id: clientAgent.instanceId,
        intent: 'authenticate',
        risk_level: 'low',
      });

      // Wait for challenge to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      proofGenerator = new ProofGeneratorImpl({
        agentId: clientAgent.agentId,
        instanceId: clientAgent.instanceId,
        keyId: clientAgent.keyId,
        algorithm: 'ed25519',
        privateKey: clientAgent.privateKey,
      });

      const challengeInfo: ChallengeInfo = {
        challenge_id: challenge.challenge_id,
        nonce: challenge.nonce,
        expires_at: challenge.expires_at,
        intent: challenge.intent,
        epochs: challenge.epochs,
      };

      const proof = await proofGenerator.generateProof(challengeInfo);
      const result = await shortTtlVerifier.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('REJECTED');
      expect(result.errors?.some(e => e.code === 'NONCE_EXPIRED')).toBe(true);
    });

    it('should prevent replay attacks with same challenge', async () => {
      const clientAgent = await createTestAgent('client4');
      const verifierAgent = await createTestAgent('verifier4');
      testAgents.push(clientAgent, verifierAgent);

      // Issue challenge
      const challenge = await verifier.issueChallenge({
        verifier_id: verifierAgent.agentId,
        target_agent_id: clientAgent.agentId,
        target_instance_id: clientAgent.instanceId,
        intent: 'authenticate',
        risk_level: 'low',
      });

      proofGenerator = new ProofGeneratorImpl({
        agentId: clientAgent.agentId,
        instanceId: clientAgent.instanceId,
        keyId: clientAgent.keyId,
        algorithm: 'ed25519',
        privateKey: clientAgent.privateKey,
      });

      const challengeInfo: ChallengeInfo = {
        challenge_id: challenge.challenge_id,
        nonce: challenge.nonce,
        expires_at: challenge.expires_at,
        intent: challenge.intent,
        epochs: challenge.epochs,
      };

      const proof = await proofGenerator.generateProof(challengeInfo);

      // First verification should succeed
      const firstResult = await verifier.verifyProof(challenge.challenge_id, proof);
      expect(firstResult.status).toBe('VERIFIED');

      // Second verification with same challenge should fail (replay attack)
      const secondResult = await verifier.verifyProof(challenge.challenge_id, proof);
      expect(secondResult.status).toBe('REJECTED');
      expect(secondResult.errors?.some(e => e.code === 'NONCE_REPLAYED')).toBe(true);
    });
  });

  // ==========================================================================
  // High-Risk Authentication Flow
  // ==========================================================================

  describe('High-Risk Authentication Flow', () => {
    it('should handle high-risk authentication with additional verification', async () => {
      const clientAgent = await createTestAgent('high_risk_client');
      const verifierAgent = await createTestAgent('high_risk_verifier');
      testAgents.push(clientAgent, verifierAgent);

      // Issue high-risk challenge
      const challenge = await verifier.issueChallenge({
        verifier_id: verifierAgent.agentId,
        target_agent_id: clientAgent.agentId,
        target_instance_id: clientAgent.instanceId,
        intent: 'high_value_operation',
        risk_level: 'high',
        requested_capabilities: ['collab.invite', 'collab.accept'],
      });

      expect(challenge.risk_level).toBe('high');

      proofGenerator = new ProofGeneratorImpl({
        agentId: clientAgent.agentId,
        instanceId: clientAgent.instanceId,
        keyId: clientAgent.keyId,
        algorithm: 'ed25519',
        privateKey: clientAgent.privateKey,
      });

      const challengeInfo: ChallengeInfo = {
        challenge_id: challenge.challenge_id,
        nonce: challenge.nonce,
        expires_at: challenge.expires_at,
        intent: challenge.intent,
        epochs: challenge.epochs,
      };

      const proof = await proofGenerator.generateProof(challengeInfo);
      const result = await verifier.verifyProof(challenge.challenge_id, proof);

      expect(result.status).toBe('VERIFIED');
      expect(result.risk_level).toBe('high');

      // Create session with high risk
      const session = await sessionManager.createSession({
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        risk_level: 'high',
        capabilities: ['collab.invite', 'collab.accept'],
        identity_version: proof.identity_version,
        revocation_epoch: proof.revocation_epoch,
        policy_epoch: proof.policy_epoch,
        ledger_checkpoint: 'chk_high_risk',
      });

      expect(session.risk_level).toBe('high');
    });
  });

  // ==========================================================================
  // Version Vector and Rollback Detection
  // ==========================================================================

  describe('Version Vector and Rollback Detection', () => {
    it('should detect identity version rollback', async () => {
      const clientAgent = await createTestAgent('rollback_client');
      const verifierAgent = await createTestAgent('rollback_verifier');
      testAgents.push(clientAgent, verifierAgent);

      // First, establish a known version vector with higher version
      await verifier.issueChallenge({
        verifier_id: verifierAgent.agentId,
        target_agent_id: clientAgent.agentId,
        target_instance_id: clientAgent.instanceId,
        intent: 'authenticate',
        risk_level: 'low',
      });

      // Manually set a higher version vector for the agent
      // (simulating previous successful authentication with higher version)
      const challenge = await verifier.issueChallenge({
        verifier_id: verifierAgent.agentId,
        target_agent_id: clientAgent.agentId,
        target_instance_id: clientAgent.instanceId,
        intent: 'authenticate',
        risk_level: 'low',
      });

      proofGenerator = new ProofGeneratorImpl({
        agentId: clientAgent.agentId,
        instanceId: clientAgent.instanceId,
        keyId: clientAgent.keyId,
        algorithm: 'ed25519',
        privateKey: clientAgent.privateKey,
      });

      const challengeInfo: ChallengeInfo = {
        challenge_id: challenge.challenge_id,
        nonce: challenge.nonce,
        expires_at: challenge.expires_at,
        intent: challenge.intent,
        epochs: {
          ...challenge.epochs,
          identity_version: 10, // Higher version first
        },
      };

      const proof = await proofGenerator.generateProof(challengeInfo);
      const result = await verifier.verifyProof(challenge.challenge_id, proof);
      expect(result.status).toBe('VERIFIED');

      // Now try with lower identity version (rollback attack)
      const challenge2 = await verifier.issueChallenge({
        verifier_id: verifierAgent.agentId,
        target_agent_id: clientAgent.agentId,
        target_instance_id: clientAgent.instanceId,
        intent: 'authenticate',
        risk_level: 'low',
      });

      const challengeInfo2: ChallengeInfo = {
        challenge_id: challenge2.challenge_id,
        nonce: challenge2.nonce,
        expires_at: challenge2.expires_at,
        intent: challenge2.intent,
        epochs: {
          ...challenge2.epochs,
          identity_version: 5, // Lower version (rollback attempt)
        },
      };

      const proof2 = await proofGenerator.generateProof(challengeInfo2);
      const result2 = await verifier.verifyProof(challenge2.challenge_id, proof2);

      expect(result2.status).toBe('REJECTED');
      expect(result2.version_check?.rollback_detected).toBe(true);
      expect(result2.errors?.some(e => e.code === 'IDENTITY_ROLLBACK_DETECTED')).toBe(true);
    });
  });

  // ==========================================================================
  // Session Lifecycle Integration
  // ==========================================================================

  describe('Session Lifecycle Integration', () => {
    it('should manage complete session lifecycle', async () => {
      const clientAgent = await createTestAgent('lifecycle_client');
      testAgents.push(clientAgent);

      // Create session
      const session = await sessionManager.createSession({
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        risk_level: 'low',
        capabilities: ['profile.read'],
        identity_version: 1,
        revocation_epoch: 1,
        policy_epoch: 1,
        ledger_checkpoint: 'chk_1',
      });

      expect(session.status).toBe('active');

      // Get session
      const retrieved = await sessionManager.getSession(session.session_id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.session_id).toBe(session.session_id);

      // Renew session
      const renewed = await sessionManager.renewSession(session.session_id);
      expect(renewed.session_epoch).toBeGreaterThan(session.session_epoch);
      expect(renewed.sequence).toBe(session.sequence + 1);

      // Terminate session
      await sessionManager.terminateSession(session.session_id, 'manual_termination');
      const terminated = await sessionManager.getSession(session.session_id);
      expect(terminated?.status).toBe('terminated');
      expect(terminated?.termination_reason).toBe('manual_termination');
    });

    it('should handle session expiration correctly', async () => {
      const shortTtlManager = new SessionManagerImpl({
        sessionTtl: 0.1, // 100ms
        maxSessions: 100,
      });

      const clientAgent = await createTestAgent('expire_client');
      testAgents.push(clientAgent);

      const session = await shortTtlManager.createSession({
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        risk_level: 'low',
        identity_version: 1,
        revocation_epoch: 1,
        policy_epoch: 1,
        ledger_checkpoint: 'chk_1',
      });

      expect(session.status).toBe('active');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      // Get expired session
      const expired = await shortTtlManager.getSession(session.session_id);
      expect(expired?.status).toBe('expired');
    });

    it('should terminate all sessions for an agent', async () => {
      const clientAgent = await createTestAgent('multi_session_client');
      testAgents.push(clientAgent);

      // Create multiple sessions
      const sessions = await Promise.all([
        sessionManager.createSession({
          agent_id: clientAgent.agentId,
          instance_id: `${clientAgent.instanceId}_1`,
          risk_level: 'low',
          identity_version: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          ledger_checkpoint: 'chk_1',
        }),
        sessionManager.createSession({
          agent_id: clientAgent.agentId,
          instance_id: `${clientAgent.instanceId}_2`,
          risk_level: 'low',
          identity_version: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          ledger_checkpoint: 'chk_1',
        }),
        sessionManager.createSession({
          agent_id: clientAgent.agentId,
          instance_id: `${clientAgent.instanceId}_3`,
          risk_level: 'high',
          identity_version: 1,
          revocation_epoch: 1,
          policy_epoch: 1,
          ledger_checkpoint: 'chk_1',
        }),
      ]);

      expect(sessions).toHaveLength(3);

      // Terminate all sessions for this agent
      const terminatedCount = await sessionManager.terminateAgentSessions(
        clientAgent.agentId,
        'quarantine'
      );

      expect(terminatedCount).toBe(3);

      // Verify all sessions are terminated
      for (const session of sessions) {
        const terminated = await sessionManager.getSession(session.session_id);
        expect(terminated?.status).toBe('terminated');
        expect(terminated?.termination_reason).toBe('quarantine');
      }
    });
  });

  // ==========================================================================
  // Cryptographic Integration
  // ==========================================================================

  describe('Cryptographic Integration', () => {
    it('should create valid Ed25519 signatures and verify them', async () => {
      const agent = await createTestAgent('crypto_test');
      testAgents.push(agent);

      // Test data
      const testData = {
        message: 'test message',
        timestamp: new Date().toISOString(),
        nonce: 'test_nonce',
      };

      // Sign with private key
      const signature = await signObject(testData, agent.privateKey);
      expect(signature).toBeTruthy();
      expect(signature).toHaveLength(128); // 64 bytes in hex

      // Verify with public key
      const isValid = await verifyObject(testData, signature, agent.publicKey);
      expect(isValid).toBe(true);

      // Verify with wrong data fails
      const wrongData = { ...testData, message: 'wrong message' };
      const isWrongValid = await verifyObject(wrongData, signature, agent.publicKey);
      expect(isWrongValid).toBe(false);
    });

    it('should generate unique session key pairs', async () => {
      const keyPair1 = await proofGenerator.generateSessionKeyPair();
      const keyPair2 = await proofGenerator.generateSessionKeyPair();

      expect(keyPair1.keyId).not.toBe(keyPair2.keyId);
      expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
      expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
    });
  });

  // ==========================================================================
  // Error Recovery Scenarios
  // ==========================================================================

  describe('Error Recovery Scenarios', () => {
    it('should recover from invalid challenge by requesting new one', async () => {
      const clientAgent = await createTestAgent('recovery_client');
      const verifierAgent = await createTestAgent('recovery_verifier');
      testAgents.push(clientAgent, verifierAgent);

      // Create verifier with very short TTL for quick expiration
      const shortTtlVerifier = new VerifierImpl({
        ...DEFAULT_VERIFIER_CONFIG,
        challengeTtl: 0.1, // 100ms
      });

      // First challenge
      const challenge1 = await shortTtlVerifier.issueChallenge({
        verifier_id: verifierAgent.agentId,
        target_agent_id: clientAgent.agentId,
        target_instance_id: clientAgent.instanceId,
        intent: 'authenticate',
        risk_level: 'low',
      });

      // Wait for challenge to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      proofGenerator = new ProofGeneratorImpl({
        agentId: clientAgent.agentId,
        instanceId: clientAgent.instanceId,
        keyId: clientAgent.keyId,
        algorithm: 'ed25519',
        privateKey: clientAgent.privateKey,
      });

      // Try with expired challenge
      const challengeInfo1: ChallengeInfo = {
        challenge_id: challenge1.challenge_id,
        nonce: challenge1.nonce,
        expires_at: challenge1.expires_at,
        intent: challenge1.intent,
        epochs: challenge1.epochs,
      };

      const proof1 = await proofGenerator.generateProof(challengeInfo1);
      const result1 = await shortTtlVerifier.verifyProof(challenge1.challenge_id, proof1);
      expect(result1.status).toBe('REJECTED');

      // Request new challenge from regular verifier
      const challenge2 = await verifier.issueChallenge({
        verifier_id: verifierAgent.agentId,
        target_agent_id: clientAgent.agentId,
        target_instance_id: clientAgent.instanceId,
        intent: 'authenticate',
        risk_level: 'low',
      });

      const challengeInfo2: ChallengeInfo = {
        challenge_id: challenge2.challenge_id,
        nonce: challenge2.nonce,
        expires_at: challenge2.expires_at,
        intent: challenge2.intent,
        epochs: challenge2.epochs,
      };

      const proof2 = await proofGenerator.generateProof(challengeInfo2);
      const result2 = await verifier.verifyProof(challenge2.challenge_id, proof2);
      expect(result2.status).toBe('VERIFIED');
    });

    it('should handle session re-authentication after expiry', async () => {
      const clientAgent = await createTestAgent('reauth_client');
      testAgents.push(clientAgent);

      // Create initial session
      const session = await sessionManager.createSession({
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        risk_level: 'low',
        capabilities: ['profile.read'],
        identity_version: 1,
        revocation_epoch: 1,
        policy_epoch: 1,
        ledger_checkpoint: 'chk_1',
      });

      // Simulate session near expiry by terminating and creating new one
      await sessionManager.terminateSession(session.session_id, 'expired');

      // Create new session (re-authentication)
      const newSession = await sessionManager.createSession({
        agent_id: clientAgent.agentId,
        instance_id: clientAgent.instanceId,
        risk_level: 'low',
        capabilities: ['profile.read'],
        identity_version: 1,
        revocation_epoch: 1,
        policy_epoch: 1,
        ledger_checkpoint: 'chk_2',
      });

      expect(newSession.session_id).not.toBe(session.session_id);
      expect(newSession.session_epoch).toBeGreaterThan(session.session_epoch);
    });
  });
});