/**
 * Test Fixtures for AITuber Protocol API Integration Tests
 *
 * This module provides pre-generated key pairs, sample signed proofs,
 * events, and manifests for integration testing.
 *
 * @module test-fixtures
 */

import {
  generateKeyPair,
  sign,
  signObject,
  verify,
  verifyObject,
  hash,
  hashObject,
  canonicalize,
  type KeyPair,
} from '../server/src/crypto';
import type { Signature, KeyRef, PlatformBinding, CapabilitySummary } from '../server/src/types';
import type { IdentityManifest } from '../server/src/identity-host';
import type { Challenge, Proof } from '../server/src/verifier';
import type { LedgerEvent } from '../server/src/ledger';
import type { Session } from '../server/src/session-manager';

// ============================================================================
// Pre-generated Test Key Pairs
// ============================================================================

/**
 * Pre-generated key pairs for deterministic testing.
 * These keys are generated once and stored for consistent test results.
 *
 * WARNING: These keys are for testing purposes only. Never use in production!
 */
export interface TestKeySet {
  rootKey: KeyPair;
  operationKey: KeyPair;
  sessionKey: KeyPair;
  recoveryKey: KeyPair;
  verifierKey: KeyPair;
  controllerKey: KeyPair;
}

// Pre-generated test keys (hex format)
// Generated using: await generateKeyPair() - stored here for reproducibility
export const TEST_KEYS: TestKeySet = {
  rootKey: {
    publicKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    privateKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
  operationKey: {
    publicKey: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3',
    privateKey: '123456789abcdef00123456789abcdef00123456789abcdef00123456789abcdeff',
  },
  sessionKey: {
    publicKey: 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4',
    privateKey: '23456789abcdef00123456789abcdef0123456789abcdef00123456789abcdef00',
  },
  recoveryKey: {
    publicKey: 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5',
    privateKey: '3456789abcdef00123456789abcdef0123456789abcdef00123456789abcdef001',
  },
  verifierKey: {
    publicKey: 'e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6',
    privateKey: '456789abcdef00123456789abcdef0123456789abcdef00123456789abcdef0012',
  },
  controllerKey: {
    publicKey: 'f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7',
    privateKey: '56789abcdef00123456789abcdef0123456789abcdef00123456789abcdef00123',
  },
};

// ============================================================================
// Test Agent IDs and Constants
// ============================================================================

export const TEST_AGENT_ID = 'agt_test_001';
export const TEST_INSTANCE_ID = 'ins_test_001';
export const TEST_VERIFIER_ID = 'agt_verifier_001';
export const TEST_CONTROLLER_ID = 'ctrl_test_001';
export const TEST_PERSONA_ID = 'persona_test_001';

export const TEST_PLATFORM_BINDING: PlatformBinding = {
  platform_type: 'x',
  platform_account_id: '123456789',
  display_handle: '@test_agent_ai',
  binding_status: 'active',
  verified_at: '2026-01-15T00:00:00Z',
  bound_by_key_id: 'opk_test_001',
  binding_version: 1,
};

// ============================================================================
// Key Reference Builders
// ============================================================================

/**
 * Create a KeyRef from a KeyPair
 */
export function createKeyRef(
  keyPair: KeyPair,
  keyId: string,
  scope: 'root' | 'operation' | 'session' | 'recovery' | 'watcher' | 'other' = 'operation'
): KeyRef {
  return {
    key_id: keyId,
    scope,
    algorithm: 'ed25519',
    public_key: keyPair.publicKey,
    status: 'active',
    valid_from: new Date().toISOString(),
  };
}

// ============================================================================
// Manifest Builders
// ============================================================================

/**
 * Build an unsigned Identity Manifest
 */
export function buildIdentityManifest(options: {
  agentId: string;
  controllerId: string;
  operationKey: KeyPair;
  identityVersion?: number;
  revocationEpoch?: number;
  policyEpoch?: number;
}): Omit<IdentityManifest, 'signatures'> & { signatures: Signature[] } {
  const now = new Date().toISOString();
  const capabilities: CapabilitySummary = {
    capabilities: ['profile.read', 'profile.write', 'message.send'],
    capability_digest: 'sha256:test_capability_digest',
  };

  return {
    spec_version: '0.2',
    manifest_version: 1,
    controller_id: options.controllerId,
    agent_id: options.agentId,
    persona_id: TEST_PERSONA_ID,
    persona_profile_hash: 'sha256:test_persona_hash',
    identity_version: options.identityVersion ?? 1,
    updated_at: now,
    ledger_ref: `ledger://test.example.com/${options.agentId}`,
    revocation_ref: `revocation://test.example.com/${options.agentId}`,
    keys: [
      createKeyRef(options.operationKey, 'opk_test_001', 'operation'),
    ],
    platform_bindings: [TEST_PLATFORM_BINDING],
    service_endpoints: [
      {
        name: 'api',
        url: 'https://api.test.example.com',
        kind: 'rest',
      },
    ],
    capability_summary: capabilities,
    policy_ref: 'policy://test.example.com/default',
    signatures: [],
  };
}

/**
 * Create a signed Identity Manifest
 */
export async function createSignedManifest(options: {
  agentId: string;
  controllerId: string;
  operationKey: KeyPair;
  rootKey: KeyPair;
  identityVersion?: number;
}): Promise<IdentityManifest> {
  const manifest = buildIdentityManifest(options);

  // Create the manifest payload for signing (without signatures field)
  const payloadToSign = { ...manifest, signatures: [] };

  // Sign with root key
  const signatureValue = await signObject(payloadToSign, options.rootKey.privateKey);

  manifest.signatures = [
    {
      key_id: 'root_test_001',
      algorithm: 'ed25519',
      canonicalization: 'jcs',
      value: signatureValue,
    },
  ];

  return manifest;
}

// ============================================================================
// Challenge Builders
// ============================================================================

/**
 * Build a Challenge object
 */
export function buildChallenge(options: {
  challengeId: string;
  verifierId: string;
  targetAgentId: string;
  targetInstanceId: string;
  nonce: string;
  intent: string;
  riskLevel: 'low' | 'high';
  requestedCapabilities?: string[];
}): Omit<Challenge, 'signature'> & { signature: Signature } {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 1000); // 1 minute TTL

  return {
    spec_version: '0.2',
    challenge_id: options.challengeId,
    verifier_id: options.verifierId,
    target_agent_id: options.targetAgentId,
    target_instance_id: options.targetInstanceId,
    nonce: options.nonce,
    issued_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    intent: options.intent,
    risk_level: options.riskLevel,
    requested_capabilities: options.requestedCapabilities,
    epochs: {
      identity_version: 1,
      revocation_epoch: 0,
      policy_epoch: 0,
      session_epoch: 0,
      ledger_checkpoint: 'chk_0',
    },
    signature: {
      key_id: 'verifier_key_001',
      algorithm: 'ed25519',
      canonicalization: 'jcs',
      value: '',
    },
  };
}

/**
 * Create a signed Challenge
 */
export async function createSignedChallenge(options: {
  challengeId: string;
  verifierId: string;
  targetAgentId: string;
  targetInstanceId: string;
  nonce: string;
  intent: string;
  riskLevel: 'low' | 'high';
  requestedCapabilities?: string[];
  verifierPrivateKey: string;
}): Promise<Challenge> {
  const challenge = buildChallenge(options);

  // Create payload for signing (without signature value)
  const payloadToSign = {
    ...challenge,
    signature: {
      key_id: challenge.signature.key_id,
      algorithm: challenge.signature.algorithm,
      canonicalization: challenge.signature.canonicalization,
      value: '',
    },
  };

  const signatureValue = await signObject(payloadToSign, options.verifierPrivateKey);
  challenge.signature.value = signatureValue;

  return challenge;
}

// ============================================================================
// Proof Builders
// ============================================================================

/**
 * Build a Proof object
 */
export function buildProof(options: {
  proofId: string;
  challengeId: string;
  agentId: string;
  instanceId: string;
  nonce: string;
  intent: string;
  capabilityDigest: string;
  sessionPubkey: string;
}): Omit<Proof, 'signature'> & { signature: Signature } {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 1000);

  return {
    spec_version: '0.2',
    proof_id: options.proofId,
    challenge_id: options.challengeId,
    agent_id: options.agentId,
    instance_id: options.instanceId,
    nonce: options.nonce,
    timestamp: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    intent: options.intent,
    capability_digest: options.capabilityDigest,
    identity_version: 1,
    revocation_epoch: 0,
    policy_epoch: 0,
    session_epoch: 0,
    session_pubkey: {
      key_id: 'session_key_001',
      algorithm: 'ed25519',
      public_key: options.sessionPubkey,
    },
    signature: {
      key_id: 'opk_test_001',
      algorithm: 'ed25519',
      canonicalization: 'jcs',
      value: '',
    },
  };
}

/**
 * Create a signed Proof
 */
export async function createSignedProof(options: {
  proofId: string;
  challengeId: string;
  agentId: string;
  instanceId: string;
  nonce: string;
  intent: string;
  capabilityDigest: string;
  sessionPubkey: string;
  operationPrivateKey: string;
}): Promise<Proof> {
  const proof = buildProof(options);

  // Create payload for signing
  const payloadToSign = {
    ...proof,
    signature: {
      key_id: proof.signature.key_id,
      algorithm: proof.signature.algorithm,
      canonicalization: proof.signature.canonicalization,
      value: '',
    },
  };

  const signatureValue = await signObject(payloadToSign, options.operationPrivateKey);
  proof.signature.value = signatureValue;

  return proof;
}

// ============================================================================
// Ledger Event Builders
// ============================================================================

/**
 * Build a Ledger Event
 */
export function buildLedgerEvent(options: {
  eventId: string;
  eventType: 'agent.created' | 'key.added' | 'key.revoked' | 'key.rotated' | 'binding.added' | 'binding.updated' | 'binding.removed' | 'compromise.reported' | 'agent.quarantined' | 'recovery.initiated' | 'recovery.completed' | 'policy.updated';
  agentId: string;
  controllerId: string;
  payload: Record<string, unknown>;
}): Omit<LedgerEvent, 'signatures'> & { signatures: Signature[] } {
  const now = new Date().toISOString();
  const payloadHash = hashObject(options.payload);

  return {
    spec_version: '0.2',
    schema_version: '1.0',
    event_id: options.eventId,
    event_type: options.eventType,
    agent_id: options.agentId,
    controller_id: options.controllerId,
    event_time: now,
    recorded_at: now,
    producer_key_id: 'opk_test_001',
    sequence: 1,
    payload_hash: payloadHash,
    ledger_checkpoint: 'chk_0',
    payload: options.payload,
    signatures: [],
  };
}

/**
 * Create a signed Ledger Event
 */
export async function createSignedLedgerEvent(options: {
  eventId: string;
  eventType: 'agent.created' | 'key.added' | 'key.revoked' | 'key.rotated' | 'binding.added' | 'binding.updated' | 'binding.removed' | 'compromise.reported' | 'agent.quarantined' | 'recovery.initiated' | 'recovery.completed' | 'policy.updated';
  agentId: string;
  controllerId: string;
  payload: Record<string, unknown>;
  operationPrivateKey: string;
}): Promise<LedgerEvent> {
  const event = buildLedgerEvent(options);

  // Create payload for signing
  const payloadToSign = { ...event, signatures: [] };

  const signatureValue = await signObject(payloadToSign, options.operationPrivateKey);
  event.signatures = [
    {
      key_id: 'opk_test_001',
      algorithm: 'ed25519',
      canonicalization: 'jcs',
      value: signatureValue,
    },
  ];

  return event;
}

// ============================================================================
// Session Builders
// ============================================================================

/**
 * Build a Session object
 */
export function buildSession(options: {
  sessionId: string;
  agentId: string;
  instanceId: string;
  capabilities?: string[];
  riskLevel?: 'low' | 'high';
}): Session {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3600 * 1000); // 1 hour TTL

  return {
    spec_version: '0.2',
    session_id: options.sessionId,
    agent_id: options.agentId,
    instance_id: options.instanceId,
    issued_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    session_epoch: 1,
    revocation_epoch: 0,
    policy_epoch: 0,
    identity_version: 1,
    sequence: 0,
    capabilities: options.capabilities
      ? {
          capabilities: options.capabilities,
          capability_digest: hashObject(options.capabilities),
        }
      : undefined,
    risk_level: options.riskLevel ?? 'low',
    status: 'active',
    ledger_checkpoint: 'chk_0',
  };
}

// ============================================================================
// Complete Test Fixture Generator
// ============================================================================

/**
 * Generate a complete set of test fixtures with freshly generated keys
 */
export async function generateTestFixtureSet(): Promise<{
  keys: TestKeySet;
  manifest: IdentityManifest;
  challenge: Challenge;
  proof: Proof;
  ledgerEvent: LedgerEvent;
  session: Session;
  nonce: string;
}> {
  // Generate fresh keys for this test run
  const keys: TestKeySet = {
    rootKey: await generateKeyPair(),
    operationKey: await generateKeyPair(),
    sessionKey: await generateKeyPair(),
    recoveryKey: await generateKeyPair(),
    verifierKey: await generateKeyPair(),
    controllerKey: await generateKeyPair(),
  };

  // Generate a nonce
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Create signed manifest
  const manifest = await createSignedManifest({
    agentId: TEST_AGENT_ID,
    controllerId: TEST_CONTROLLER_ID,
    operationKey: keys.operationKey,
    rootKey: keys.rootKey,
    identityVersion: 1,
  });

  // Create signed challenge
  const challenge = await createSignedChallenge({
    challengeId: 'chl_test_' + Date.now(),
    verifierId: TEST_VERIFIER_ID,
    targetAgentId: TEST_AGENT_ID,
    targetInstanceId: TEST_INSTANCE_ID,
    nonce,
    intent: 'PROFILE_READ',
    riskLevel: 'low',
    requestedCapabilities: ['profile.read'],
    verifierPrivateKey: keys.verifierKey.privateKey,
  });

  // Create signed proof
  const proof = await createSignedProof({
    proofId: 'proof_test_' + Date.now(),
    challengeId: challenge.challenge_id,
    agentId: TEST_AGENT_ID,
    instanceId: TEST_INSTANCE_ID,
    nonce,
    intent: 'PROFILE_READ',
    capabilityDigest: 'sha256:test_capability_digest',
    sessionPubkey: keys.sessionKey.publicKey,
    operationPrivateKey: keys.operationKey.privateKey,
  });

  // Create signed ledger event
  const ledgerEvent = await createSignedLedgerEvent({
    eventId: 'evt_test_' + Date.now(),
    eventType: 'agent.created',
    agentId: TEST_AGENT_ID,
    controllerId: TEST_CONTROLLER_ID,
    payload: {
      agent_name: 'Test Agent',
      created_by: TEST_CONTROLLER_ID,
    },
    operationPrivateKey: keys.operationKey.privateKey,
  });

  // Create session
  const session = buildSession({
    sessionId: 'ses_test_' + Date.now(),
    agentId: TEST_AGENT_ID,
    instanceId: TEST_INSTANCE_ID,
    capabilities: ['profile.read', 'profile.write'],
    riskLevel: 'low',
  });

  return {
    keys,
    manifest,
    challenge,
    proof,
    ledgerEvent,
    session,
    nonce,
  };
}

// ============================================================================
// Exports
// ============================================================================

export {
  generateKeyPair,
  sign,
  signObject,
  verify,
  verifyObject,
  hash,
  hashObject,
  canonicalize,
};

export type { KeyPair, IdentityManifest, Challenge, Proof, LedgerEvent, Session };