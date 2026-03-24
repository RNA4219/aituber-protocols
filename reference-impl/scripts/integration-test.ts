#!/usr/bin/env node
/**
 * Integration Test Script for AITuber Protocol API Endpoints
 *
 * This script tests the complete authentication flow:
 * 1. Create a test agent with signed manifest
 * 2. Issue a challenge
 * 3. Create and verify a signed proof
 * 4. Create a session
 * 5. Submit a signed ledger event
 *
 * Usage:
 *   npx tsx scripts/integration-test.ts [options]
 *
 * Options:
 *   --server-url <url>  Server URL (default: http://localhost:3000)
 *   --verbose           Enable verbose output
 *   --skip-manifest     Skip manifest creation step
 *
 * @module scripts/integration-test
 */

import {
  generateTestFixtureSet,
  TEST_AGENT_ID,
  TEST_INSTANCE_ID,
  TEST_VERIFIER_ID,
  TEST_CONTROLLER_ID,
  createSignedManifest,
  createSignedChallenge,
  createSignedProof,
  createSignedLedgerEvent,
  buildSession,
  type TestKeySet,
  type IdentityManifest,
} from '../test-fixtures/index';
import { generateKeyPair, signObject, verifyObject } from '../server/src/crypto';

// ============================================================================
// Configuration
// ============================================================================

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const VERBOSE = process.env.VERBOSE === 'true' || process.argv.includes('--verbose');
const SKIP_MANIFEST = process.argv.includes('--skip-manifest');

// Test configuration
const TEST_CONFIG = {
  serverUrl: SERVER_URL,
  timeout: 30000,
  retries: 3,
};

// ============================================================================
// Utility Functions
// ============================================================================

interface TestResult {
  step: string;
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
  duration: number;
}

function log(message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: '\x1b[34m[INFO]\x1b[0m',
    warn: '\x1b[33m[WARN]\x1b[0m',
    error: '\x1b[31m[ERROR]\x1b[0m',
    success: '\x1b[32m[SUCCESS]\x1b[0m',
  }[level];
  console.log(`${timestamp} ${prefix} ${message}`);
}

function logVerbose(message: string, data?: unknown) {
  if (VERBOSE) {
    console.log(`  \x1b[90m[VERBOSE] ${message}\x1b[0m`);
    if (data) {
      console.log(`  \x1b[90m${JSON.stringify(data, null, 2)}\x1b[0m`);
    }
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number = TEST_CONFIG.timeout
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// API Client Functions
// ============================================================================

/**
 * Health check - verify server is running
 */
async function checkHealth(): Promise<TestResult> {
  const startTime = Date.now();
  const step = 'Health Check';

  try {
    logVerbose(`GET ${TEST_CONFIG.serverUrl}/health`);
    const response = await fetchWithTimeout(`${TEST_CONFIG.serverUrl}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();
    logVerbose('Response:', data);

    return {
      step,
      success: response.ok,
      status: response.status,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      step,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Create or update an agent's identity manifest
 */
async function createAgentManifest(manifest: IdentityManifest): Promise<TestResult> {
  const startTime = Date.now();
  const step = 'Create Agent Manifest';

  try {
    const url = `${TEST_CONFIG.serverUrl}/v1/agents/${manifest.agent_id}/manifest`;
    logVerbose(`PUT ${url}`);
    logVerbose('Manifest:', manifest);

    const response = await fetchWithTimeout(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });

    const data = await response.json();
    logVerbose('Response:', data);

    return {
      step,
      success: response.ok,
      status: response.status,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      step,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Get an agent's identity manifest
 */
async function getAgentManifest(agentId: string): Promise<TestResult> {
  const startTime = Date.now();
  const step = 'Get Agent Manifest';

  try {
    const url = `${TEST_CONFIG.serverUrl}/v1/agents/${agentId}/manifest`;
    logVerbose(`GET ${url}`);

    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();
    logVerbose('Response:', data);

    return {
      step,
      success: response.ok,
      status: response.status,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      step,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Issue a challenge for authentication
 */
async function issueChallenge(options: {
  verifierId: string;
  targetAgentId: string;
  targetInstanceId: string;
  intent: string;
  riskLevel: 'low' | 'high';
  requestedCapabilities?: string[];
}): Promise<TestResult & { data?: { challenge_id: string; nonce: string } }> {
  const startTime = Date.now();
  const step = 'Issue Challenge';

  try {
    const url = `${TEST_CONFIG.serverUrl}/v1/challenges`;
    const body = {
      verifier_id: options.verifierId,
      target_agent_id: options.targetAgentId,
      target_instance_id: options.targetInstanceId,
      intent: options.intent,
      risk_level: options.riskLevel,
      requested_capabilities: options.requestedCapabilities,
    };

    logVerbose(`POST ${url}`);
    logVerbose('Request Body:', body);

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    logVerbose('Response:', data);

    return {
      step,
      success: response.ok,
      status: response.status,
      data: response.ok ? data : undefined,
      error: !response.ok ? JSON.stringify(data) : undefined,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      step,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Verify a proof
 */
async function verifyProof(challengeId: string, proof: any): Promise<TestResult> {
  const startTime = Date.now();
  const step = 'Verify Proof';

  try {
    const url = `${TEST_CONFIG.serverUrl}/v1/proofs/verify`;
    const body = {
      challenge_id: challengeId,
      proof,
    };

    logVerbose(`POST ${url}`);
    logVerbose('Request Body:', body);

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    logVerbose('Response:', data);

    return {
      step,
      success: response.ok && data.verification_status === 'VERIFIED',
      status: response.status,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      step,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Create a session after successful verification
 */
async function createSession(options: {
  verifiedAgentId: string;
  verifiedInstanceId: string;
  riskLevel: 'low' | 'high';
  capabilitySummary?: string[];
  versionVector: {
    identity_version: number;
    revocation_epoch: number;
    policy_epoch: number;
    session_epoch: number;
    ledger_checkpoint: string;
  };
}): Promise<TestResult & { data?: { session_id: string } }> {
  const startTime = Date.now();
  const step = 'Create Session';

  try {
    const url = `${TEST_CONFIG.serverUrl}/v1/sessions`;
    const body = {
      verified_agent_id: options.verifiedAgentId,
      verified_instance_id: options.verifiedInstanceId,
      risk_level: options.riskLevel,
      capability_summary: options.capabilitySummary
        ? {
            capabilities: options.capabilitySummary,
            capability_digest: 'sha256:test_digest',
          }
        : undefined,
      version_vector: options.versionVector,
    };

    logVerbose(`POST ${url}`);
    logVerbose('Request Body:', body);

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    logVerbose('Response:', data);

    return {
      step,
      success: response.ok,
      status: response.status,
      data: response.ok ? data : undefined,
      error: !response.ok ? JSON.stringify(data) : undefined,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      step,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Submit a ledger event
 */
async function submitLedgerEvent(event: any): Promise<TestResult> {
  const startTime = Date.now();
  const step = 'Submit Ledger Event';

  try {
    const url = `${TEST_CONFIG.serverUrl}/v1/ledger/events`;
    const body = { event };

    logVerbose(`POST ${url}`);
    logVerbose('Request Body:', body);

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    logVerbose('Response:', data);

    return {
      step,
      success: response.ok && data.append_status === 'APPENDED',
      status: response.status,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      step,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Terminate a session
 */
async function terminateSession(sessionId: string): Promise<TestResult> {
  const startTime = Date.now();
  const step = 'Terminate Session';

  try {
    const url = `${TEST_CONFIG.serverUrl}/v1/sessions/${sessionId}`;
    logVerbose(`DELETE ${url}`);

    const response = await fetchWithTimeout(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        reason_code: 'manual_termination',
      }),
    });

    const data = await response.json();
    logVerbose('Response:', data);

    return {
      step,
      success: response.ok,
      status: response.status,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      step,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Get ledger checkpoint
 */
async function getLedgerCheckpoint(): Promise<TestResult> {
  const startTime = Date.now();
  const step = 'Get Ledger Checkpoint';

  try {
    const url = `${TEST_CONFIG.serverUrl}/v1/ledger/checkpoint`;
    logVerbose(`GET ${url}`);

    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();
    logVerbose('Response:', data);

    return {
      step,
      success: response.ok,
      status: response.status,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      step,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Main Test Runner
// ============================================================================

interface IntegrationTestReport {
  timestamp: string;
  serverUrl: string;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  totalDuration: number;
  results: TestResult[];
  success: boolean;
}

async function runIntegrationTests(): Promise<IntegrationTestReport> {
  const startTime = Date.now();
  const results: TestResult[] = [];

  log('Starting Integration Tests...');
  log(`Server URL: ${TEST_CONFIG.serverUrl}`);
  log(`Verbose: ${VERBOSE}`);
  console.log('');

  // Step 1: Health Check
  log('Step 1: Health Check');
  const healthResult = await checkHealth();
  results.push(healthResult);

  if (!healthResult.success) {
    log('Server is not healthy. Aborting tests.', 'error');
    return {
      timestamp: new Date().toISOString(),
      serverUrl: TEST_CONFIG.serverUrl,
      totalSteps: results.length,
      passedSteps: results.filter((r) => r.success).length,
      failedSteps: results.filter((r) => !r.success).length,
      totalDuration: Date.now() - startTime,
      results,
      success: false,
    };
  }
  log('Server is healthy.', 'success');
  console.log('');

  // Generate test fixtures
  log('Generating test fixtures...');
  const fixtures = await generateTestFixtureSet();
  log(`Generated keys and fixtures for agent: ${TEST_AGENT_ID}`, 'success');
  console.log('');

  // Step 2: Create Agent Manifest
  if (!SKIP_MANIFEST) {
    log('Step 2: Create Agent Manifest');
    const manifestResult = await createAgentManifest(fixtures.manifest as any);
    results.push(manifestResult);

    if (manifestResult.success) {
      log('Manifest created successfully.', 'success');
    } else {
      log(`Failed to create manifest: ${manifestResult.error}`, 'warn');
    }
    console.log('');
  }

  // Step 3: Get Agent Manifest
  log('Step 3: Get Agent Manifest');
  const getManifestResult = await getAgentManifest(fixtures.manifest.agent_id);
  results.push(getManifestResult);

  if (getManifestResult.success) {
    log('Manifest retrieved successfully.', 'success');
  } else {
    log(`Failed to get manifest: ${getManifestResult.error}`, 'warn');
  }
  console.log('');

  // Step 4: Issue Challenge
  log('Step 4: Issue Challenge');
  const challengeResult = await issueChallenge({
    verifierId: TEST_VERIFIER_ID,
    targetAgentId: TEST_AGENT_ID,
    targetInstanceId: TEST_INSTANCE_ID,
    intent: 'PROFILE_READ',
    riskLevel: 'low',
    requestedCapabilities: ['profile.read'],
  });
  results.push(challengeResult);

  if (!challengeResult.success || !challengeResult.data) {
    log('Failed to issue challenge. Aborting authentication flow.', 'error');
    return {
      timestamp: new Date().toISOString(),
      serverUrl: TEST_CONFIG.serverUrl,
      totalSteps: results.length,
      passedSteps: results.filter((r) => r.success).length,
      failedSteps: results.filter((r) => !r.success).length,
      totalDuration: Date.now() - startTime,
      results,
      success: false,
    };
  }
  log(`Challenge issued: ${challengeResult.data.challenge_id}`, 'success');
  console.log('');

  // Step 5: Create and Verify Proof
  log('Step 5: Create and Verify Proof');

  // Create signed proof with the nonce from the challenge
  const proof = await createSignedProof({
    proofId: 'proof_' + Date.now(),
    challengeId: challengeResult.data.challenge_id,
    agentId: TEST_AGENT_ID,
    instanceId: TEST_INSTANCE_ID,
    nonce: challengeResult.data.nonce,
    intent: 'PROFILE_READ',
    capabilityDigest: 'sha256:test_capability_digest',
    sessionPubkey: fixtures.keys.sessionKey.publicKey,
    operationPrivateKey: fixtures.keys.operationKey.privateKey,
  });

  const proofResult = await verifyProof(challengeResult.data.challenge_id, proof);
  results.push(proofResult);

  if (proofResult.success) {
    log('Proof verified successfully.', 'success');
  } else {
    log(`Proof verification failed: ${JSON.stringify(proofResult.data)}`, 'error');
  }
  console.log('');

  // Step 6: Create Session
  log('Step 6: Create Session');
  const sessionResult = await createSession({
    verifiedAgentId: TEST_AGENT_ID,
    verifiedInstanceId: TEST_INSTANCE_ID,
    riskLevel: 'low',
    capabilitySummary: ['profile.read', 'profile.write'],
    versionVector: {
      identity_version: 1,
      revocation_epoch: 0,
      policy_epoch: 0,
      session_epoch: 0,
      ledger_checkpoint: 'chk_0',
    },
  });
  results.push(sessionResult);

  if (sessionResult.success && sessionResult.data) {
    log(`Session created: ${sessionResult.data.session_id}`, 'success');
  } else {
    log(`Failed to create session: ${sessionResult.error}`, 'error');
  }
  console.log('');

  // Step 7: Submit Ledger Event
  log('Step 7: Submit Ledger Event');
  const ledgerEvent = await createSignedLedgerEvent({
    eventId: 'evt_' + Date.now(),
    eventType: 'key.rotated',
    agentId: TEST_AGENT_ID,
    controllerId: TEST_CONTROLLER_ID,
    payload: {
      old_key_id: 'opk_old_001',
      new_key_id: 'opk_test_001',
      rotation_reason: 'scheduled',
    },
    operationPrivateKey: fixtures.keys.operationKey.privateKey,
  });

  const ledgerResult = await submitLedgerEvent(ledgerEvent);
  results.push(ledgerResult);

  if (ledgerResult.success) {
    log('Ledger event submitted successfully.', 'success');
  } else {
    log(`Failed to submit ledger event: ${JSON.stringify(ledgerResult.data)}`, 'error');
  }
  console.log('');

  // Step 8: Get Ledger Checkpoint
  log('Step 8: Get Ledger Checkpoint');
  const checkpointResult = await getLedgerCheckpoint();
  results.push(checkpointResult);

  if (checkpointResult.success) {
    log(`Checkpoint: ${JSON.stringify(checkpointResult.data)}`, 'success');
  } else {
    log('Failed to get checkpoint.', 'warn');
  }
  console.log('');

  // Step 9: Terminate Session (cleanup)
  if (sessionResult.success && sessionResult.data?.session_id) {
    log('Step 9: Terminate Session (cleanup)');
    const terminateResult = await terminateSession(sessionResult.data.session_id);
    results.push(terminateResult);

    if (terminateResult.success) {
      log('Session terminated successfully.', 'success');
    } else {
      log('Failed to terminate session.', 'warn');
    }
    console.log('');
  }

  // Generate report
  const totalDuration = Date.now() - startTime;
  const passedSteps = results.filter((r) => r.success).length;
  const failedSteps = results.filter((r) => !r.success).length;

  log('========================================');
  log('Integration Test Report', 'info');
  log('========================================');
  log(`Total Steps: ${results.length}`);
  log(`Passed: ${passedSteps}`, 'success');
  log(`Failed: ${failedSteps}`, failedSteps > 0 ? 'error' : 'info');
  log(`Total Duration: ${totalDuration}ms`);
  console.log('');

  // Print detailed results
  log('Detailed Results:');
  for (const result of results) {
    const status = result.success ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    const duration = `${result.duration}ms`;
    console.log(`  [${status}] ${result.step} (${duration})`);
    if (result.error && !result.success) {
      console.log(`    \x1b[90mError: ${result.error}\x1b[0m`);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    serverUrl: TEST_CONFIG.serverUrl,
    totalSteps: results.length,
    passedSteps,
    failedSteps,
    totalDuration,
    results,
    success: failedSteps === 0,
  };
}

// ============================================================================
// Entry Point
// ============================================================================

/**
 * Gracefully exit the process, allowing pending async operations to complete.
 * This prevents libuv handle closing errors on Windows.
 */
function gracefulExit(code: number): never {
  // Give libuv a chance to close all handles before exiting
  // This is especially important on Windows where async handle cleanup
  // can trigger "UV_HANDLE_CLOSING" assertion errors if interrupted
  setTimeout(() => {
    process.exit(code);
  }, 100);
  // Prevent the event loop from exiting prematurely
  process.stdin.resume();
  // Never returns, but TypeScript needs a return type
  return undefined as never;
}

async function main() {
  try {
    const report = await runIntegrationTests();

    // Exit with appropriate code
    gracefulExit(report.success ? 0 : 1);
  } catch (error) {
    log('Fatal error during integration tests:', 'error');
    console.error(error);
    gracefulExit(1);
  }
}

// Run if executed directly
main();

export {
  checkHealth,
  createAgentManifest,
  getAgentManifest,
  issueChallenge,
  verifyProof,
  createSession,
  submitLedgerEvent,
  terminateSession,
  getLedgerCheckpoint,
  runIntegrationTests,
  type TestResult,
  type IntegrationTestReport,
};