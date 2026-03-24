#!/usr/bin/env node
/**
 * Bootstrap demo data for a local reference-impl server.
 *
 * Waits for the server health endpoint, generates a signed demo manifest,
 * registers it via the Identity API, and writes the generated keys/manifest
 * to a local bundle file for follow-up manual testing.
 */

import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';

import { generateKeyPair, signObject } from '../server/src/crypto';
import type { IdentityManifest } from '../server/src/identity-host';
import type { KeyRef, PlatformBinding, ServiceEndpoint, Signature } from '../server/src/types';

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

const SERVER_URL = getArgValue('--server-url') || process.env.SERVER_URL || 'http://localhost:3000';
const AGENT_ID = getArgValue('--agent-id') || 'agt_demo_001';
const CONTROLLER_ID = getArgValue('--controller-id') || 'ctrl_demo_001';
const OUTPUT_PATH = getArgValue('--output') || path.join('data', 'bootstrap', `${AGENT_ID}.json`);

function log(message: string) {
  console.log(`[bootstrap] ${message}`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth(serverUrl: string, retries = 30): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`${serverUrl}/health`);
      if (response.ok) {
        log(`server is healthy: ${serverUrl}`);
        return;
      }
    } catch {
      // keep retrying
    }

    log(`waiting for server... (${attempt}/${retries})`);
    await sleep(1000);
  }

  throw new Error(`server did not become healthy: ${serverUrl}`);
}

async function buildDemoManifest(serverUrl: string): Promise<{
  manifest: IdentityManifest;
  privateKey: string;
}> {
  const operationKey = await generateKeyPair();
  const now = new Date().toISOString();

  const keys: KeyRef[] = [
    {
      key_id: 'opk_demo_001',
      scope: 'operation',
      algorithm: 'ed25519',
      public_key: operationKey.publicKey,
      status: 'active',
      valid_from: now,
    },
  ];

  const platformBindings: PlatformBinding[] = [
    {
      platform_type: 'discord',
      platform_account_id: 'demo-account',
      display_handle: '@aituber-demo',
      binding_status: 'active',
      verified_at: now,
      bound_by_key_id: 'opk_demo_001',
      binding_version: 1,
    },
  ];

  const serviceEndpoints: ServiceEndpoint[] = [
    {
      name: 'auth',
      url: `${serverUrl}/v1`,
      kind: 'rest',
    },
  ];

  const manifestWithoutSignature = {
    spec_version: '0.2',
    manifest_version: 1,
    controller_id: CONTROLLER_ID,
    agent_id: AGENT_ID,
    persona_id: `${AGENT_ID}_persona`,
    persona_profile_hash: 'sha256:demo-persona-profile',
    identity_version: 1,
    updated_at: now,
    ledger_ref: `${serverUrl}/v1/ledger/events?agent_id=${AGENT_ID}`,
    revocation_ref: `${serverUrl}/v1/agents/${AGENT_ID}/revocation`,
    keys,
    platform_bindings: platformBindings,
    service_endpoints: serviceEndpoints,
    capability_summary: {
      capabilities: ['profile.read', 'message.send'],
      capability_digest: 'sha256:demo-capability-digest',
    },
    policy_ref: `${serverUrl}/policies/default`,
    signatures: [] as Signature[],
  };

  const signatureValue = await signObject(
    { ...manifestWithoutSignature, signatures: [] },
    operationKey.privateKey
  );

  const manifest: IdentityManifest = {
    ...manifestWithoutSignature,
    signatures: [
      {
        key_id: 'opk_demo_001',
        algorithm: 'ed25519',
        canonicalization: 'jcs',
        value: signatureValue,
      },
    ],
  };

  return {
    manifest,
    privateKey: operationKey.privateKey,
  };
}

async function registerManifest(serverUrl: string, manifest: IdentityManifest): Promise<void> {
  const response = await fetch(`${serverUrl}/v1/agents/${manifest.agent_id}/manifest`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(`manifest registration failed: ${JSON.stringify(body)}`);
  }
}

async function writeBootstrapBundle(outputPath: string, bundle: unknown): Promise<void> {
  const absolutePath = path.isAbsolute(outputPath)
    ? outputPath
    : path.join(process.cwd(), outputPath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(bundle, null, 2), 'utf-8');
  log(`bootstrap bundle written: ${absolutePath}`);
}

async function main() {
  log(`target server: ${SERVER_URL}`);
  await waitForHealth(SERVER_URL);

  const { manifest, privateKey } = await buildDemoManifest(SERVER_URL);
  await registerManifest(SERVER_URL, manifest);
  log(`manifest registered: ${manifest.agent_id}`);

  await writeBootstrapBundle(OUTPUT_PATH, {
    warning: 'demo bootstrap material for local testing only; never use in production',
    server_url: SERVER_URL,
    agent_id: manifest.agent_id,
    controller_id: manifest.controller_id,
    operation_private_key: privateKey,
    manifest,
  });

  console.log('');
  console.log('Bootstrap complete');
  console.log(`- server: ${SERVER_URL}`);
  console.log(`- agent_id: ${manifest.agent_id}`);
  console.log(`- manifest endpoint: ${SERVER_URL}/v1/agents/${manifest.agent_id}/manifest`);
  console.log(`- bundle: ${path.isAbsolute(OUTPUT_PATH) ? OUTPUT_PATH : path.join(process.cwd(), OUTPUT_PATH)}`);
}

main().catch((error) => {
  console.error('[bootstrap] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
