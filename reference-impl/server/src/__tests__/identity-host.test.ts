import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  IdentityHostImpl,
  type IdentityManifest,
  type IdentityHostConfig,
} from '../identity-host.js';
import type {
  KeyRef,
  PlatformBinding,
  ServiceEndpoint,
  Signature,
} from '../types.js';
import * as crypto from '../crypto.js';

// Mock the crypto module
vi.mock('../crypto.js');

// Helper function to create a valid manifest
function createMockManifest(overrides?: Partial<IdentityManifest>): IdentityManifest {
  const defaultKeyRef: KeyRef = {
    key_id: 'key_001',
    scope: 'operation',
    algorithm: 'ed25519',
    public_key: 'a'.repeat(64),
    status: 'active',
    valid_from: '2026-03-24T12:00:00Z',
  };

  const defaultBinding: PlatformBinding = {
    platform_type: 'youtube',
    platform_account_id: 'account_001',
    display_handle: '@test_agent',
    binding_status: 'active',
    verified_at: '2026-03-24T12:00:00Z',
    bound_by_key_id: 'key_001',
    binding_version: 1,
  };

  const defaultEndpoint: ServiceEndpoint = {
    name: 'api',
    url: 'https://api.example.com',
    kind: 'rest',
  };

  const defaultSignature: Signature = {
    key_id: 'key_001',
    algorithm: 'ed25519',
    canonicalization: 'jcs',
    value: 'signature_value_hex',
  };

  const defaultManifest: IdentityManifest = {
    spec_version: '0.2',
    manifest_version: 1,
    controller_id: 'ctrl_001',
    agent_id: 'agt_001',
    identity_version: 1,
    updated_at: '2026-03-24T12:00:00Z',
    ledger_ref: 'https://ledger.example.com/agt_001',
    revocation_ref: 'https://revocation.example.com/agt_001',
    keys: [defaultKeyRef],
    platform_bindings: [defaultBinding],
    service_endpoints: [defaultEndpoint],
    capability_summary: ['profile.read', 'message.send'],
    policy_ref: 'https://policy.example.com/default',
    signatures: [defaultSignature],
  };

  return { ...defaultManifest, ...overrides };
}

describe('IdentityHost', () => {
  let identityHost: IdentityHostImpl;
  const createDefaultConfig = (
    overrides?: Partial<IdentityHostConfig>
  ): IdentityHostConfig => ({
    storageRoot: '/tmp/identity-storage',
    cacheTtl: 300, // 5 minutes
    skipSignatureValidation: true, // Skip signature validation for tests with mock manifests
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    identityHost = new IdentityHostImpl(createDefaultConfig());
  });

  describe('Manifest取得', () => {
    describe('getManifest', () => {
      it('should return null for non-existent agent', async () => {
        const manifest = await identityHost.getManifest('non_existent_agent');

        expect(manifest).toBeNull();
      });

      it('should return cached manifest when available', async () => {
        const mockManifest = createMockManifest({ agent_id: 'agt_cached' });

        // Save manifest to populate cache
        await identityHost.saveManifest(mockManifest);

        // Retrieve from cache
        const retrieved = await identityHost.getManifest('agt_cached');

        expect(retrieved).toEqual(mockManifest);
      });

      it('should return manifest from storage when cache is expired', async () => {
        // Create host with very short TTL
        const shortTtlHost = new IdentityHostImpl(createDefaultConfig({ cacheTtl: 0.001 }));

        const mockManifest = createMockManifest({ agent_id: 'agt_expired' });

        await shortTtlHost.saveManifest(mockManifest);

        // Wait for cache to expire
        await new Promise(resolve => setTimeout(resolve, 10));

        const retrieved = await shortTtlHost.getManifest('agt_expired');

        // Storage is implemented, so expired cache should load from storage
        expect(retrieved).toEqual(mockManifest);
      });

      it('should handle different agent IDs independently', async () => {
        const manifest1 = createMockManifest({ agent_id: 'agt_001' });
        const manifest2 = createMockManifest({ agent_id: 'agt_002', controller_id: 'ctrl_002' });

        await identityHost.saveManifest(manifest1);
        await identityHost.saveManifest(manifest2);

        const retrieved1 = await identityHost.getManifest('agt_001');
        const retrieved2 = await identityHost.getManifest('agt_002');

        expect(retrieved1?.agent_id).toBe('agt_001');
        expect(retrieved2?.agent_id).toBe('agt_002');
        expect(retrieved1?.controller_id).toBe('ctrl_001');
        expect(retrieved2?.controller_id).toBe('ctrl_002');
      });
    });
  });

  describe('Manifest保存', () => {
    describe('saveManifest', () => {
      it('should save a valid manifest', async () => {
        const mockManifest = createMockManifest();

        await expect(identityHost.saveManifest(mockManifest)).resolves.not.toThrow();

        // Verify it's cached
        const retrieved = await identityHost.getManifest(mockManifest.agent_id);
        expect(retrieved).toEqual(mockManifest);
      });

      it('should update cache when saving manifest', async () => {
        const manifestV1 = createMockManifest({
          agent_id: 'agt_update',
          identity_version: 1,
        });
        const manifestV2 = createMockManifest({
          agent_id: 'agt_update',
          identity_version: 2,
        });

        await identityHost.saveManifest(manifestV1);
        await identityHost.saveManifest(manifestV2);

        const retrieved = await identityHost.getManifest('agt_update');
        expect(retrieved?.identity_version).toBe(2);
      });

      it('should throw error when signature validation fails', async () => {
        const strictHost = new IdentityHostImpl({
          ...createDefaultConfig(),
          skipSignatureValidation: false,
        });

        // Mock validateManifestSignature to return false
        vi.spyOn(strictHost, 'validateManifestSignature').mockResolvedValue(false);

        const mockManifest = createMockManifest();

        await expect(strictHost.saveManifest(mockManifest)).rejects.toThrow(
          'Invalid manifest signature'
        );
      });

      it('should skip signature validation when configured', async () => {
        const skipValidationHost = new IdentityHostImpl({
          ...createDefaultConfig(),
          skipSignatureValidation: true,
        });

        const mockManifest = createMockManifest();

        // Should not throw even with potential signature issues
        await expect(skipValidationHost.saveManifest(mockManifest)).resolves.not.toThrow();
      });

      it('should save manifest with all required fields', async () => {
        const mockManifest = createMockManifest();

        await identityHost.saveManifest(mockManifest);

        const retrieved = await identityHost.getManifest(mockManifest.agent_id);

        expect(retrieved).toBeDefined();
        expect(retrieved?.spec_version).toBe(mockManifest.spec_version);
        expect(retrieved?.manifest_version).toBe(mockManifest.manifest_version);
        expect(retrieved?.controller_id).toBe(mockManifest.controller_id);
        expect(retrieved?.agent_id).toBe(mockManifest.agent_id);
        expect(retrieved?.identity_version).toBe(mockManifest.identity_version);
        expect(retrieved?.updated_at).toBe(mockManifest.updated_at);
        expect(retrieved?.ledger_ref).toBe(mockManifest.ledger_ref);
        expect(retrieved?.revocation_ref).toBe(mockManifest.revocation_ref);
        expect(retrieved?.keys).toEqual(mockManifest.keys);
        expect(retrieved?.platform_bindings).toEqual(mockManifest.platform_bindings);
        expect(retrieved?.service_endpoints).toEqual(mockManifest.service_endpoints);
        expect(retrieved?.capability_summary).toEqual(mockManifest.capability_summary);
        expect(retrieved?.policy_ref).toBe(mockManifest.policy_ref);
        expect(retrieved?.signatures).toEqual(mockManifest.signatures);
      });

      it('should handle manifest with optional fields', async () => {
        const manifestWithOptional = createMockManifest({
          persona_id: 'persona_001',
          persona_profile_hash: 'sha256:abc123',
        });

        await identityHost.saveManifest(manifestWithOptional);

        const retrieved = await identityHost.getManifest(manifestWithOptional.agent_id);

        expect(retrieved?.persona_id).toBe('persona_001');
        expect(retrieved?.persona_profile_hash).toBe('sha256:abc123');
      });
    });
  });

  describe('署名検証', () => {
    describe('validateManifestSignature', () => {
      it('should return false for invalid/unverifiable signatures', async () => {
        const mockManifest = createMockManifest();

        // When signatures exist but cannot be verified, return false for security
        const result = await identityHost.validateManifestSignature(mockManifest);

        expect(result).toBe(false);
      });

      it('should return false for manifests with multiple unverifiable signatures', async () => {
        const multiSigManifest = createMockManifest({
          signatures: [
            {
              key_id: 'key_001',
              algorithm: 'ed25519',
              canonicalization: 'jcs',
              value: 'sig1_hex',
            },
            {
              key_id: 'key_002',
              algorithm: 'ed25519',
              canonicalization: 'jcs',
              value: 'sig2_hex',
            },
          ],
        });

        // When signatures exist but cannot be verified, return false for security
        const result = await identityHost.validateManifestSignature(multiSigManifest);

        expect(result).toBe(false);
      });

      it('should return false for manifests with different signature algorithms when unverifiable', async () => {
        const manifest = createMockManifest({
          signatures: [
            {
              key_id: 'key_001',
              algorithm: 'ed25519',
              canonicalization: 'jcs',
              value: 'signature_hex',
            },
          ],
        });

        // When signatures exist but cannot be verified, return false for security
        const result = await identityHost.validateManifestSignature(manifest);

        expect(result).toBe(false);
      });

      it('should handle manifest with empty signatures array', async () => {
        const noSigManifest = createMockManifest({
          signatures: [],
        });

        const result = await identityHost.validateManifestSignature(noSigManifest);

        expect(result).toBe(true);
      });

      it('should return true when verifyObject returns true (valid signature)', async () => {
        vi.mocked(crypto.verifyObject).mockResolvedValueOnce(true);

        const mockManifest = createMockManifest({
          signatures: [
            {
              key_id: 'key_001',
              algorithm: 'ed25519',
              canonicalization: 'jcs',
              value: 'valid_signature_hex',
            },
          ],
        });

        const result = await identityHost.validateManifestSignature(mockManifest);

        expect(result).toBe(true);
        expect(crypto.verifyObject).toHaveBeenCalledTimes(1);
      });

      it('should handle verifyObject throwing an error and continue to next signature', async () => {
        vi.mocked(crypto.verifyObject).mockRejectedValueOnce(new Error('Verification error'));
        vi.mocked(crypto.verifyObject).mockResolvedValueOnce(true);

        const mockManifest = createMockManifest({
          keys: [
            {
              key_id: 'key_001',
              scope: 'operation',
              algorithm: 'ed25519',
              public_key: 'a'.repeat(64),
              status: 'active',
              valid_from: '2026-03-24T12:00:00Z',
            },
            {
              key_id: 'key_002',
              scope: 'operation',
              algorithm: 'ed25519',
              public_key: 'b'.repeat(64),
              status: 'active',
              valid_from: '2026-03-24T12:00:00Z',
            },
          ],
          signatures: [
            {
              key_id: 'key_001',
              algorithm: 'ed25519',
              canonicalization: 'jcs',
              value: 'invalid_signature_hex',
            },
            {
              key_id: 'key_002',
              algorithm: 'ed25519',
              canonicalization: 'jcs',
              value: 'valid_signature_hex',
            },
          ],
        });

        const result = await identityHost.validateManifestSignature(mockManifest);

        expect(result).toBe(true);
        expect(crypto.verifyObject).toHaveBeenCalledTimes(2);
      });

      it('should return false when all signatures throw errors', async () => {
        vi.mocked(crypto.verifyObject).mockRejectedValue(new Error('Verification error'));

        const mockManifest = createMockManifest({
          signatures: [
            {
              key_id: 'key_001',
              algorithm: 'ed25519',
              canonicalization: 'jcs',
              value: 'signature_hex',
            },
          ],
        });

        const result = await identityHost.validateManifestSignature(mockManifest);

        expect(result).toBe(false);
      });
    });
  });

  describe('Binding照合', () => {
    describe('matchBinding', () => {
      it('should find matching active binding', () => {
        const mockManifest = createMockManifest({
          platform_bindings: [
            {
              platform_type: 'youtube',
              platform_account_id: 'yt_001',
              display_handle: '@yt_agent',
              binding_status: 'active',
              verified_at: '2026-03-24T12:00:00Z',
              bound_by_key_id: 'key_001',
              binding_version: 1,
            },
            {
              platform_type: 'x',
              platform_account_id: 'x_001',
              display_handle: '@x_agent',
              binding_status: 'active',
              verified_at: '2026-03-24T12:00:00Z',
              bound_by_key_id: 'key_001',
              binding_version: 1,
            },
          ],
        });

        const result = identityHost.matchBinding(mockManifest, 'youtube', 'yt_001');

        expect(result).toBeDefined();
        expect(result?.platform_type).toBe('youtube');
        expect(result?.platform_account_id).toBe('yt_001');
        expect(result?.binding_status).toBe('active');
      });

      it('should return null when no matching binding found', () => {
        const mockManifest = createMockManifest({
          platform_bindings: [
            {
              platform_type: 'youtube',
              platform_account_id: 'yt_001',
              display_handle: '@yt_agent',
              binding_status: 'active',
              verified_at: '2026-03-24T12:00:00Z',
              bound_by_key_id: 'key_001',
              binding_version: 1,
            },
          ],
        });

        const result = identityHost.matchBinding(mockManifest, 'discord', 'discord_001');

        expect(result).toBeNull();
      });

      it('should return null for non-active binding', () => {
        const mockManifest = createMockManifest({
          platform_bindings: [
            {
              platform_type: 'youtube',
              platform_account_id: 'yt_001',
              display_handle: '@yt_agent',
              binding_status: 'pending',
              verified_at: '2026-03-24T12:00:00Z',
              bound_by_key_id: 'key_001',
              binding_version: 1,
            },
          ],
        });

        const result = identityHost.matchBinding(mockManifest, 'youtube', 'yt_001');

        expect(result).toBeNull();
      });

      it('should return null for revoked binding', () => {
        const mockManifest = createMockManifest({
          platform_bindings: [
            {
              platform_type: 'youtube',
              platform_account_id: 'yt_001',
              display_handle: '@yt_agent',
              binding_status: 'revoked',
              verified_at: '2026-03-24T12:00:00Z',
              bound_by_key_id: 'key_001',
              binding_version: 1,
            },
          ],
        });

        const result = identityHost.matchBinding(mockManifest, 'youtube', 'yt_001');

        expect(result).toBeNull();
      });

      it('should return null for removed binding', () => {
        const mockManifest = createMockManifest({
          platform_bindings: [
            {
              platform_type: 'youtube',
              platform_account_id: 'yt_001',
              display_handle: '@yt_agent',
              binding_status: 'removed',
              verified_at: '2026-03-24T12:00:00Z',
              bound_by_key_id: 'key_001',
              binding_version: 1,
            },
          ],
        });

        const result = identityHost.matchBinding(mockManifest, 'youtube', 'yt_001');

        expect(result).toBeNull();
      });

      it('should return null for quarantined binding', () => {
        const mockManifest = createMockManifest({
          platform_bindings: [
            {
              platform_type: 'youtube',
              platform_account_id: 'yt_001',
              display_handle: '@yt_agent',
              binding_status: 'quarantined',
              verified_at: '2026-03-24T12:00:00Z',
              bound_by_key_id: 'key_001',
              binding_version: 1,
            },
          ],
        });

        const result = identityHost.matchBinding(mockManifest, 'youtube', 'yt_001');

        expect(result).toBeNull();
      });

      it('should match platform type case-sensitively', () => {
        const mockManifest = createMockManifest({
          platform_bindings: [
            {
              platform_type: 'youtube',
              platform_account_id: 'yt_001',
              display_handle: '@yt_agent',
              binding_status: 'active',
              verified_at: '2026-03-24T12:00:00Z',
              bound_by_key_id: 'key_001',
              binding_version: 1,
            },
          ],
        });

        // Exact match
        expect(identityHost.matchBinding(mockManifest, 'youtube', 'yt_001')).toBeDefined();
        // Case mismatch
        expect(identityHost.matchBinding(mockManifest, 'YouTube', 'yt_001')).toBeNull();
        expect(identityHost.matchBinding(mockManifest, 'YOUTUBE', 'yt_001')).toBeNull();
      });

      it('should match platform account ID exactly', () => {
        const mockManifest = createMockManifest({
          platform_bindings: [
            {
              platform_type: 'youtube',
              platform_account_id: 'yt_001',
              display_handle: '@yt_agent',
              binding_status: 'active',
              verified_at: '2026-03-24T12:00:00Z',
              bound_by_key_id: 'key_001',
              binding_version: 1,
            },
          ],
        });

        // Exact match
        expect(identityHost.matchBinding(mockManifest, 'youtube', 'yt_001')).toBeDefined();
        // Different account ID
        expect(identityHost.matchBinding(mockManifest, 'youtube', 'yt_002')).toBeNull();
      });

      it('should handle multiple bindings on same platform', () => {
        const mockManifest = createMockManifest({
          platform_bindings: [
            {
              platform_type: 'youtube',
              platform_account_id: 'yt_001',
              display_handle: '@yt_agent_1',
              binding_status: 'active',
              verified_at: '2026-03-24T12:00:00Z',
              bound_by_key_id: 'key_001',
              binding_version: 1,
            },
            {
              platform_type: 'youtube',
              platform_account_id: 'yt_002',
              display_handle: '@yt_agent_2',
              binding_status: 'active',
              verified_at: '2026-03-24T12:00:00Z',
              bound_by_key_id: 'key_001',
              binding_version: 1,
            },
          ],
        });

        const result1 = identityHost.matchBinding(mockManifest, 'youtube', 'yt_001');
        const result2 = identityHost.matchBinding(mockManifest, 'youtube', 'yt_002');

        expect(result1?.platform_account_id).toBe('yt_001');
        expect(result2?.platform_account_id).toBe('yt_002');
      });

      it('should handle empty platform bindings array', () => {
        const mockManifest = createMockManifest({
          platform_bindings: [],
        });

        const result = identityHost.matchBinding(mockManifest, 'youtube', 'yt_001');

        expect(result).toBeNull();
      });

      it('should support all platform types', () => {
        const platformTypes = ['x', 'youtube', 'discord', 'misskey', 'twitch', 'web', 'other'] as const;

        for (const platformType of platformTypes) {
          const mockManifest = createMockManifest({
            platform_bindings: [
              {
                platform_type: platformType,
                platform_account_id: 'account_001',
                display_handle: '@agent',
                binding_status: 'active',
                verified_at: '2026-03-24T12:00:00Z',
                bound_by_key_id: 'key_001',
                binding_version: 1,
              },
            ],
          });

          const result = identityHost.matchBinding(mockManifest, platformType, 'account_001');

          expect(result).toBeDefined();
          expect(result?.platform_type).toBe(platformType);
        }
      });

      it('should return the first matching active binding', () => {
        const mockManifest = createMockManifest({
          platform_bindings: [
            {
              platform_type: 'youtube',
              platform_account_id: 'yt_001',
              display_handle: '@yt_agent_1',
              binding_status: 'pending', // Not active
              verified_at: '2026-03-24T12:00:00Z',
              bound_by_key_id: 'key_001',
              binding_version: 1,
            },
            {
              platform_type: 'youtube',
              platform_account_id: 'yt_001',
              display_handle: '@yt_agent_2',
              binding_status: 'active',
              verified_at: '2026-03-24T12:00:00Z',
              bound_by_key_id: 'key_002',
              binding_version: 2,
            },
          ],
        });

        const result = identityHost.matchBinding(mockManifest, 'youtube', 'yt_001');

        expect(result).toBeDefined();
        expect(result?.binding_status).toBe('active');
        expect(result?.bound_by_key_id).toBe('key_002');
      });
    });
  });

  describe('統合テスト', () => {
    it('should support full manifest lifecycle', async () => {
      // Set up mock before any operations
      vi.mocked(crypto.verifyObject).mockResolvedValue(true);

      const manifest = createMockManifest({
        agent_id: 'agt_lifecycle',
        platform_bindings: [
          {
            platform_type: 'youtube',
            platform_account_id: 'yt_lifecycle',
            display_handle: '@lifecycle_agent',
            binding_status: 'active',
            verified_at: '2026-03-24T12:00:00Z',
            bound_by_key_id: 'key_001',
            binding_version: 1,
          },
        ],
      });

      // Save
      await identityHost.saveManifest(manifest);

      // Retrieve
      const retrieved = await identityHost.getManifest('agt_lifecycle');
      expect(retrieved).toEqual(manifest);

      // Validate signature
      const isValid = await identityHost.validateManifestSignature(retrieved!);
      expect(isValid).toBe(true);

      // Match binding
      const binding = identityHost.matchBinding(retrieved!, 'youtube', 'yt_lifecycle');
      expect(binding).toBeDefined();
      expect(binding?.binding_status).toBe('active');
    });

    it('should handle cache correctly with multiple operations', async () => {
      const manifest1 = createMockManifest({ agent_id: 'agt_multi_1' });
      const manifest2 = createMockManifest({ agent_id: 'agt_multi_2' });
      const manifest3 = createMockManifest({ agent_id: 'agt_multi_3' });

      // Save multiple manifests
      await identityHost.saveManifest(manifest1);
      await identityHost.saveManifest(manifest2);
      await identityHost.saveManifest(manifest3);

      // Retrieve all
      const all = await Promise.all([
        identityHost.getManifest('agt_multi_1'),
        identityHost.getManifest('agt_multi_2'),
        identityHost.getManifest('agt_multi_3'),
      ]);

      expect(all[0]?.agent_id).toBe('agt_multi_1');
      expect(all[1]?.agent_id).toBe('agt_multi_2');
      expect(all[2]?.agent_id).toBe('agt_multi_3');
    });

    it('should work with complex manifest structure', async () => {
      const complexManifest: IdentityManifest = {
        spec_version: '0.2',
        manifest_version: 5,
        controller_id: 'ctrl_complex',
        agent_id: 'agt_complex',
        persona_id: 'persona_complex',
        persona_profile_hash: 'sha256:abc123def456',
        identity_version: 10,
        updated_at: '2026-03-24T15:30:00Z',
        ledger_ref: 'https://ledger.example.com/agt_complex',
        revocation_ref: 'https://revocation.example.com/agt_complex',
        keys: [
          {
            key_id: 'root_key',
            scope: 'root',
            algorithm: 'ed25519',
            public_key: 'a'.repeat(64),
            status: 'active',
            valid_from: '2026-01-01T00:00:00Z',
            valid_until: '2027-01-01T00:00:00Z',
          },
          {
            key_id: 'operation_key',
            scope: 'operation',
            algorithm: 'ed25519',
            public_key: 'b'.repeat(64),
            status: 'active',
            valid_from: '2026-03-01T00:00:00Z',
          },
          {
            key_id: 'session_key',
            scope: 'session',
            algorithm: 'ed25519',
            public_key: 'c'.repeat(64),
            status: 'active',
            valid_from: '2026-03-24T15:00:00Z',
          },
        ],
        platform_bindings: [
          {
            platform_type: 'youtube',
            platform_account_id: 'yt_complex',
            display_handle: '@complex_agent',
            binding_status: 'active',
            verified_at: '2026-03-24T12:00:00Z',
            bound_by_key_id: 'operation_key',
            binding_version: 3,
          },
          {
            platform_type: 'x',
            platform_account_id: 'x_complex',
            display_handle: '@complex_agent_x',
            binding_status: 'active',
            verified_at: '2026-03-24T12:00:00Z',
            bound_by_key_id: 'operation_key',
            binding_version: 2,
          },
        ],
        service_endpoints: [
          { name: 'api', url: 'https://api.example.com', kind: 'rest' },
          { name: 'websocket', url: 'wss://ws.example.com', kind: 'websocket' },
        ],
        capability_summary: [
          'profile.read',
          'profile.write',
          'message.send',
          'message.receive',
        ],
        policy_ref: 'https://policy.example.com/complex',
        signatures: [
          {
            key_id: 'root_key',
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: 'root_signature_hex',
          },
          {
            key_id: 'operation_key',
            algorithm: 'ed25519',
            canonicalization: 'jcs',
            value: 'operation_signature_hex',
          },
        ],
      };

      await identityHost.saveManifest(complexManifest);

      const retrieved = await identityHost.getManifest('agt_complex');

      expect(retrieved).toEqual(complexManifest);
      expect(retrieved?.keys.length).toBe(3);
      expect(retrieved?.platform_bindings.length).toBe(2);
      expect(retrieved?.signatures.length).toBe(2);

      // Match different bindings
      const ytBinding = identityHost.matchBinding(retrieved!, 'youtube', 'yt_complex');
      const xBinding = identityHost.matchBinding(retrieved!, 'x', 'x_complex');

      expect(ytBinding).toBeDefined();
      expect(xBinding).toBeDefined();
    });
  });
});
