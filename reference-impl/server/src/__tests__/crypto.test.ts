import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateKeyPair,
  derivePublicKey,
  sign,
  signObject,
  verify,
  verifyObject,
  canonicalize,
  hash,
  hashObject,
  hashRaw,
  base64ToHex,
  hexToBase64,
  isValidPublicKey,
  isValidPrivateKey,
  SIGNATURE_ALGORITHM,
  CANONICALIZATION_ALGORITHM,
} from '../crypto.js';

describe('Crypto', () => {
  describe('鍵ペア生成', () => {
    describe('generateKeyPair', () => {
      it('should generate a valid key pair', async () => {
        const keyPair = await generateKeyPair();

        expect(keyPair).toBeDefined();
        expect(keyPair.publicKey).toBeDefined();
        expect(keyPair.privateKey).toBeDefined();
        expect(typeof keyPair.publicKey).toBe('string');
        expect(typeof keyPair.privateKey).toBe('string');
      });

      it('should generate 32-byte keys (64 hex characters)', async () => {
        const keyPair = await generateKeyPair();

        // Ed25519 public key is 32 bytes = 64 hex chars
        expect(keyPair.publicKey.length).toBe(64);
        // Ed25519 private key is 32 bytes = 64 hex chars
        expect(keyPair.privateKey.length).toBe(64);
      });

      it('should generate unique key pairs', async () => {
        const keyPair1 = await generateKeyPair();
        const keyPair2 = await generateKeyPair();

        expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
        expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
      });

      it('should generate valid hex strings', async () => {
        const keyPair = await generateKeyPair();

        // Check that keys are valid hex strings
        expect(/^[0-9a-f]+$/.test(keyPair.publicKey)).toBe(true);
        expect(/^[0-9a-f]+$/.test(keyPair.privateKey)).toBe(true);
      });
    });

    describe('derivePublicKey', () => {
      it('should derive the correct public key from private key', async () => {
        const keyPair = await generateKeyPair();
        const derivedPublicKey = await derivePublicKey(keyPair.privateKey);

        expect(derivedPublicKey).toBe(keyPair.publicKey);
      });

      it('should consistently derive the same public key', async () => {
        const keyPair = await generateKeyPair();

        const derived1 = await derivePublicKey(keyPair.privateKey);
        const derived2 = await derivePublicKey(keyPair.privateKey);

        expect(derived1).toBe(derived2);
      });

      it('should work with 0x prefix', async () => {
        const keyPair = await generateKeyPair();
        const prefixedPrivateKey = '0x' + keyPair.privateKey;

        const derivedPublicKey = await derivePublicKey(prefixedPrivateKey);

        expect(derivedPublicKey).toBe(keyPair.publicKey);
      });
    });
  });

  describe('署名生成・検証', () => {
    describe('sign', () => {
      it('should sign a message and return hex signature', async () => {
        const keyPair = await generateKeyPair();
        const message = 'Hello, World!';

        const signature = await sign(message, keyPair.privateKey);

        expect(signature).toBeDefined();
        expect(typeof signature).toBe('string');
        // Ed25519 signature is 64 bytes = 128 hex chars
        expect(signature.length).toBe(128);
        expect(/^[0-9a-f]+$/.test(signature)).toBe(true);
      });

      it('should generate different signatures for different messages', async () => {
        const keyPair = await generateKeyPair();

        const signature1 = await sign('Message 1', keyPair.privateKey);
        const signature2 = await sign('Message 2', keyPair.privateKey);

        expect(signature1).not.toBe(signature2);
      });

      it('should generate different signatures for same message with different keys', async () => {
        const keyPair1 = await generateKeyPair();
        const keyPair2 = await generateKeyPair();
        const message = 'Same message';

        const signature1 = await sign(message, keyPair1.privateKey);
        const signature2 = await sign(message, keyPair2.privateKey);

        expect(signature1).not.toBe(signature2);
      });
    });

    describe('signObject', () => {
      it('should sign an object after canonicalization', async () => {
        const keyPair = await generateKeyPair();
        const obj = { name: 'test', value: 123 };

        const signature = await signObject(obj, keyPair.privateKey);

        expect(signature).toBeDefined();
        expect(typeof signature).toBe('string');
        expect(signature.length).toBe(128);
      });

      it('should generate same signature for objects with same content but different property order', async () => {
        const keyPair = await generateKeyPair();
        const obj1 = { a: 1, b: 2, c: 3 };
        const obj2 = { c: 3, b: 2, a: 1 };

        const signature1 = await signObject(obj1, keyPair.privateKey);
        const signature2 = await signObject(obj2, keyPair.privateKey);

        expect(signature1).toBe(signature2);
      });
    });

    describe('verify', () => {
      it('should verify a valid signature', async () => {
        const keyPair = await generateKeyPair();
        const message = 'Hello, World!';
        const signature = await sign(message, keyPair.privateKey);

        const result = await verify(message, signature, keyPair.publicKey);

        expect(result).toBe(true);
      });

      it('should reject invalid signature', async () => {
        const keyPair = await generateKeyPair();
        const message = 'Hello, World!';
        const wrongSignature = '0'.repeat(128);

        const result = await verify(message, wrongSignature, keyPair.publicKey);

        expect(result).toBe(false);
      });

      it('should reject signature with wrong public key', async () => {
        const keyPair1 = await generateKeyPair();
        const keyPair2 = await generateKeyPair();
        const message = 'Hello, World!';
        const signature = await sign(message, keyPair1.privateKey);

        const result = await verify(message, signature, keyPair2.publicKey);

        expect(result).toBe(false);
      });

      it('should reject signature for different message', async () => {
        const keyPair = await generateKeyPair();
        const message = 'Hello, World!';
        const signature = await sign(message, keyPair.privateKey);

        const result = await verify('Different message', signature, keyPair.publicKey);

        expect(result).toBe(false);
      });

      it('should return false for invalid public key format', async () => {
        const result = await verify('message', 'signature', 'invalid-key');

        expect(result).toBe(false);
      });

      it('should return false for invalid signature format', async () => {
        const keyPair = await generateKeyPair();

        const result = await verify('message', 'invalid-signature', keyPair.publicKey);

        expect(result).toBe(false);
      });
    });

    describe('verifyObject', () => {
      it('should verify an object signature', async () => {
        const keyPair = await generateKeyPair();
        const obj = { name: 'test', value: 123 };
        const signature = await signObject(obj, keyPair.privateKey);

        const result = await verifyObject(obj, signature, keyPair.publicKey);

        expect(result).toBe(true);
      });

      it('should reject signature for modified object', async () => {
        const keyPair = await generateKeyPair();
        const obj = { name: 'test', value: 123 };
        const signature = await signObject(obj, keyPair.privateKey);

        const modifiedObj = { name: 'test', value: 456 };
        const result = await verifyObject(modifiedObj, signature, keyPair.publicKey);

        expect(result).toBe(false);
      });
    });
  });

  describe('Canonicalization', () => {
    describe('canonicalize', () => {
      it('should canonicalize a simple object', () => {
        const obj = { b: 2, a: 1 };
        const canonical = canonicalize(obj);

        // Properties should be sorted
        expect(canonical).toBe('{"a":1,"b":2}');
      });

      it('should canonicalize an empty object', () => {
        expect(canonicalize({})).toBe('{}');
      });

      it('should canonicalize nested objects', () => {
        const obj = { z: 1, a: { d: 4, c: 3 } };
        const canonical = canonicalize(obj);

        expect(canonical).toBe('{"a":{"c":3,"d":4},"z":1}');
      });

      it('should canonicalize arrays (maintaining order)', () => {
        const obj = { arr: [3, 1, 2] };
        const canonical = canonicalize(obj);

        expect(canonical).toBe('{"arr":[3,1,2]}');
      });

      it('should handle null values', () => {
        expect(canonicalize(null)).toBe('null');
      });

      it('should handle undefined as null', () => {
        expect(canonicalize(undefined)).toBe('null');
      });

      it('should exclude undefined values from objects', () => {
        const obj = { a: 1, b: undefined, c: 3 };
        const canonical = canonicalize(obj);

        expect(canonical).toBe('{"a":1,"c":3}');
      });

      it('should handle boolean values', () => {
        expect(canonicalize(true)).toBe('true');
        expect(canonicalize(false)).toBe('false');
      });

      it('should handle numbers', () => {
        expect(canonicalize(42)).toBe('42');
        expect(canonicalize(0)).toBe('0');
        expect(canonicalize(-1)).toBe('-1');
      });

      it('should handle floating point numbers', () => {
        const canonical = canonicalize(3.14);
        expect(canonical).toBe('3.14');
      });

      it('should handle special numeric values', () => {
        expect(canonicalize(NaN)).toBe('NaN');
        expect(canonicalize(Infinity)).toBe('Infinity');
        expect(canonicalize(-Infinity)).toBe('-Infinity');
      });

      it('should handle strings with proper escaping', () => {
        expect(canonicalize('hello')).toBe('"hello"');
        expect(canonicalize('hello "world"')).toBe('"hello \\"world\\""');
        expect(canonicalize('back\\slash')).toBe('"back\\\\slash"');
      });

      it('should escape control characters', () => {
        expect(canonicalize('\n')).toBe('"\\n"');
        expect(canonicalize('\r')).toBe('"\\r"');
        expect(canonicalize('\t')).toBe('"\\t"');
        expect(canonicalize('\b')).toBe('"\\b"');
        expect(canonicalize('\f')).toBe('"\\f"');
      });

      it('should escape control characters below U+0020', () => {
        // U+0001 (SOH) should be escaped as \u0001
        expect(canonicalize('\u0001')).toBe('"\\u0001"');
      });

      it('should handle arrays with mixed types', () => {
        const arr = [1, 'two', null, true];
        const canonical = canonicalize(arr);

        expect(canonical).toBe('[1,"two",null,true]');
      });

      it('should handle empty arrays', () => {
        expect(canonicalize([])).toBe('[]');
      });

      it('should handle arrays with nested objects', () => {
        const arr = [{ b: 2, a: 1 }, { d: 4, c: 3 }];
        const canonical = canonicalize(arr);

        expect(canonical).toBe('[{"a":1,"b":2},{"c":3,"d":4}]');
      });

      it('should sort object keys by unicode code point', () => {
        const obj = { b: 1, a: 2, B: 3, A: 4 };
        const canonical = canonicalize(obj);

        // Uppercase letters have lower code points than lowercase
        // Order should be: A (65), B (66), a (97), b (98)
        expect(canonical).toBe('{"A":4,"B":3,"a":2,"b":1}');
      });

      it('should handle unicode in keys', () => {
        const obj = { '\u4e00': 'chinese', 'a': 'latin' };
        const canonical = canonicalize(obj);

        // 'a' (97) comes before '\u4e00' (19968)
        expect(canonical).toBe('{"a":"latin","\u4e00":"chinese"}');
      });

      it('should produce consistent output for equivalent objects', () => {
        const obj1 = { c: 3, a: 1, b: { y: 2, x: 1 } };
        const obj2 = { a: 1, b: { x: 1, y: 2 }, c: 3 };

        expect(canonicalize(obj1)).toBe(canonicalize(obj2));
      });
    });
  });

  describe('Hash計算', () => {
    describe('hash', () => {
      it('should compute SHA-256 hash with sha256: prefix', () => {
        const data = 'Hello, World!';
        const result = hash(data);

        expect(result).toMatch(/^sha256:[0-9a-f]{64}$/);
      });

      it('should produce consistent hashes for same input', () => {
        const data = 'test data';

        expect(hash(data)).toBe(hash(data));
      });

      it('should produce different hashes for different inputs', () => {
        const hash1 = hash('data1');
        const hash2 = hash('data2');

        expect(hash1).not.toBe(hash2);
      });

      it('should produce correct SHA-256 hash', () => {
        // Known SHA-256 hash of empty string
        const emptyHash = hash('');
        expect(emptyHash).toBe('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      });
    });

    describe('hashObject', () => {
      it('should hash an object after canonicalization', () => {
        const obj = { name: 'test', value: 123 };
        const result = hashObject(obj);

        expect(result).toMatch(/^sha256:[0-9a-f]{64}$/);
      });

      it('should produce same hash for objects with same content', () => {
        const obj1 = { a: 1, b: 2, c: 3 };
        const obj2 = { c: 3, b: 2, a: 1 };

        expect(hashObject(obj1)).toBe(hashObject(obj2));
      });

      it('should produce different hashes for different objects', () => {
        const obj1 = { a: 1 };
        const obj2 = { a: 2 };

        expect(hashObject(obj1)).not.toBe(hashObject(obj2));
      });
    });

    describe('hashRaw', () => {
      it('should compute SHA-256 hash without prefix', () => {
        const data = 'Hello, World!';
        const result = hashRaw(data);

        expect(result).toMatch(/^[0-9a-f]{64}$/);
        expect(result).not.toContain('sha256:');
      });

      it('should produce correct SHA-256 hash', () => {
        // Known SHA-256 hash of empty string
        const emptyHash = hashRaw('');
        expect(emptyHash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      });

      it('should match hash without prefix', () => {
        const data = 'test';
        const withPrefix = hash(data);
        const withoutPrefix = hashRaw(data);

        expect(withPrefix).toBe('sha256:' + withoutPrefix);
      });
    });
  });

  describe('ユーティリティ関数', () => {
    describe('base64ToHex', () => {
      it('should convert base64 to hex', () => {
        const base64 = 'SGVsbG8='; // "Hello" in base64
        const hex = base64ToHex(base64);

        expect(hex).toBe('48656c6c6f');
      });

      it('should handle empty string', () => {
        expect(base64ToHex('')).toBe('');
      });
    });

    describe('hexToBase64', () => {
      it('should convert hex to base64', () => {
        const hex = '48656c6c6f'; // "Hello" in hex
        const base64 = hexToBase64(hex);

        expect(base64).toBe('SGVsbG8=');
      });

      it('should handle hex with 0x prefix', () => {
        const hex = '0x48656c6c6f';
        const base64 = hexToBase64(hex);

        expect(base64).toBe('SGVsbG8=');
      });

      it('should handle empty string', () => {
        expect(hexToBase64('')).toBe('');
      });
    });

    describe('isValidPublicKey', () => {
      it('should return true for valid 32-byte public key', async () => {
        const keyPair = await generateKeyPair();

        expect(isValidPublicKey(keyPair.publicKey)).toBe(true);
      });

      it('should return false for invalid length', () => {
        expect(isValidPublicKey('abc123')).toBe(false);
      });

      it('should return false for non-hex string', () => {
        expect(isValidPublicKey('ghijklmnopqrstuvwxyz12345678901234567890123456')).toBe(false);
      });

      it('should return false for empty string', () => {
        expect(isValidPublicKey('')).toBe(false);
      });
    });

    describe('isValidPrivateKey', () => {
      it('should return true for valid 32-byte private key', async () => {
        const keyPair = await generateKeyPair();

        expect(isValidPrivateKey(keyPair.privateKey)).toBe(true);
      });

      it('should return false for invalid length', () => {
        expect(isValidPrivateKey('abc123')).toBe(false);
      });

      it('should return false for non-hex string', () => {
        expect(isValidPrivateKey('ghijklmnopqrstuvwxyz12345678901234567890123456')).toBe(false);
      });

      it('should return false for empty string', () => {
        expect(isValidPrivateKey('')).toBe(false);
      });
    });

    describe('Constants', () => {
      it('should export correct signature algorithm', () => {
        expect(SIGNATURE_ALGORITHM).toBe('ed25519');
      });

      it('should export correct canonicalization algorithm', () => {
        expect(CANONICALIZATION_ALGORITHM).toBe('jcs');
      });
    });
  });

  describe('統合テスト', () => {
    it('should work end-to-end: generate keys, sign, and verify', async () => {
      // Generate key pair
      const keyPair = await generateKeyPair();

      // Sign a message
      const message = 'This is a test message';
      const signature = await sign(message, keyPair.privateKey);

      // Verify the signature
      const isValid = await verify(message, signature, keyPair.publicKey);

      expect(isValid).toBe(true);
    });

    it('should work end-to-end with object signing', async () => {
      // Generate key pair
      const keyPair = await generateKeyPair();

      // Create and sign an object
      const obj = {
        id: 'test-001',
        timestamp: '2026-03-24T12:00:00Z',
        data: { key: 'value' },
      };
      const signature = await signObject(obj, keyPair.privateKey);

      // Verify the signature
      const isValid = await verifyObject(obj, signature, keyPair.publicKey);

      expect(isValid).toBe(true);
    });

    it('should work with hash and sign workflow', async () => {
      const keyPair = await generateKeyPair();
      const data = 'Important data to sign';

      // Hash the data
      const dataHash = hash(data);

      // Sign the hash
      const signature = await sign(dataHash, keyPair.privateKey);

      // Verify the signature
      const isValid = await verify(dataHash, signature, keyPair.publicKey);

      expect(isValid).toBe(true);
    });

    it('should produce deterministic hash for use in blockchain scenarios', async () => {
      const obj = {
        version: 1,
        data: 'test',
        timestamp: '2026-03-24T12:00:00Z',
      };

      // Hash should be consistent
      const hash1 = hashObject(obj);
      const hash2 = hashObject(obj);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });

  // ========================================
  // Additional Edge Case Tests
  // ========================================

  describe('Edge Cases - derivePublicKey', () => {
    it('should throw for invalid hex string', async () => {
      await expect(derivePublicKey('not_valid_hex!')).rejects.toThrow();
    });

    it('should throw for empty string', async () => {
      await expect(derivePublicKey('')).rejects.toThrow();
    });

    it('should throw for wrong length hex', async () => {
      await expect(derivePublicKey('abc123')).rejects.toThrow();
    });
  });

  describe('Edge Cases - sign', () => {
    it('should throw for invalid private key format', async () => {
      await expect(sign('test', 'invalid')).rejects.toThrow();
    });

    it('should throw for empty private key', async () => {
      await expect(sign('test', '')).rejects.toThrow();
    });

    it('should handle very long messages', async () => {
      const keyPair = await generateKeyPair();
      const longMessage = 'a'.repeat(100000);
      const signature = await sign(longMessage, keyPair.privateKey);
      expect(signature).toHaveLength(128);
    });

    it('should work with empty message', async () => {
      const keyPair = await generateKeyPair();
      const signature = await sign('', keyPair.privateKey);
      expect(signature).toHaveLength(128);
    });
  });

  describe('Edge Cases - verify', () => {
    it('should return false for empty signature', async () => {
      const keyPair = await generateKeyPair();
      const isValid = await verify('test', '', keyPair.publicKey);
      expect(isValid).toBe(false);
    });

    it('should return false for empty public key', async () => {
      const keyPair = await generateKeyPair();
      const signature = await sign('test', keyPair.privateKey);
      const isValid = await verify('test', signature, '');
      expect(isValid).toBe(false);
    });

    it('should handle signature with 0x prefix', async () => {
      const keyPair = await generateKeyPair();
      const message = 'test';
      const signature = await sign(message, keyPair.privateKey);
      const isValid = await verify(message, '0x' + signature, keyPair.publicKey);
      expect(isValid).toBe(true);
    });

    it('should handle public key with 0x prefix', async () => {
      const keyPair = await generateKeyPair();
      const message = 'test';
      const signature = await sign(message, keyPair.privateKey);
      const isValid = await verify(message, signature, '0x' + keyPair.publicKey);
      expect(isValid).toBe(true);
    });

    it('should return false for correct length but invalid hex values', async () => {
      const keyPair = await generateKeyPair();
      const invalidSignature = 'z'.repeat(128);
      const isValid = await verify('test', invalidSignature, keyPair.publicKey);
      expect(isValid).toBe(false);
    });

    it('should handle very long messages', async () => {
      const keyPair = await generateKeyPair();
      const longMessage = 'a'.repeat(100000);
      const signature = await sign(longMessage, keyPair.privateKey);
      const isValid = await verify(longMessage, signature, keyPair.publicKey);
      expect(isValid).toBe(true);
    });
  });

  describe('Edge Cases - canonicalize', () => {
    it('should handle empty string as input', () => {
      expect(canonicalize('')).toBe('""');
    });

    it('should handle very long strings', () => {
      const longStr = 'a'.repeat(10000);
      const result = canonicalize(longStr);
      expect(result).toBe('"' + longStr + '"');
    });

    it('should handle Unicode strings (emoji)', () => {
      expect(canonicalize('🎉')).toBe('"🎉"');
    });

    it('should handle Unicode strings (Japanese)', () => {
      expect(canonicalize('こんにちは')).toBe('"こんにちは"');
    });

    it('should handle very large numbers', () => {
      const result = canonicalize(1e308);
      expect(result).toMatch(/^1e\+308$|^1\.0e\+308$|^9\.999.*e\+307$/);
    });

    it('should handle very small numbers', () => {
      const result = canonicalize(1e-308);
      // Very small numbers may be represented with different exponents
      expect(result).toMatch(/e-[0-9]+$/);
    });

    it('should handle deeply nested objects', () => {
      const deep: Record<string, unknown> = { value: 1 };
      for (let i = 0; i < 50; i++) {
        deep.nested = { ...deep };
      }
      const result = canonicalize({ deep });
      expect(result).toMatch(/^{"deep":/);
      expect(result).toContain('"value":1');
    });

    it('should handle objects with numeric keys', () => {
      const obj = { '1': 'one', '2': 'two' };
      const result = canonicalize(obj);
      expect(result).toBe('{"1":"one","2":"two"}');
    });

    it('should handle Date objects', () => {
      const date = new Date('2024-01-01');
      const result = canonicalize(date);
      // Date objects are treated as regular objects, not serialized as ISO strings
      // This documents the current behavior
      expect(result).toBe('{}');
    });

    it('should handle very long arrays', () => {
      const arr = Array(1000).fill(0).map((_, i) => i);
      const result = canonicalize(arr);
      expect(result.startsWith('[')).toBe(true);
      expect(result.endsWith(']')).toBe(true);
      expect(result).toContain('0,'); // First element
      expect(result).toContain(',999'); // Last element
    });
  });

  describe('Edge Cases - hash', () => {
    it('should handle very long strings', () => {
      const longStr = 'a'.repeat(100000);
      const result = hash(longStr);
      expect(result).toMatch(/^sha256:/);
    });

    it('should handle Unicode content', () => {
      const result = hash('日本語テスト🎉');
      expect(result).toMatch(/^sha256:/);
    });

    it('should handle special characters', () => {
      const result = hash('\n\t\r\0');
      expect(result).toMatch(/^sha256:/);
    });
  });

  describe('Edge Cases - isValidPublicKey', () => {
    it('should return true for valid key with 0x prefix', async () => {
      const keyPair = await generateKeyPair();
      expect(isValidPublicKey('0x' + keyPair.publicKey)).toBe(true);
    });

    it('should return false for exactly 63 characters', () => {
      const key63 = 'a'.repeat(63);
      expect(isValidPublicKey(key63)).toBe(false);
    });

    it('should return true for exactly 65 characters - documents truncation behavior', () => {
      // 65 chars = 32.5 bytes, but hexToBytes truncates odd-length hex strings
      // This test documents the current behavior; consider if this should be rejected
      const key65 = 'a'.repeat(65);
      expect(isValidPublicKey(key65)).toBe(true);
    });
  });

  describe('Edge Cases - isValidPrivateKey', () => {
    it('should return false for empty string', () => {
      expect(isValidPrivateKey('')).toBe(false);
    });

    it('should return true for valid key with 0x prefix', async () => {
      const keyPair = await generateKeyPair();
      expect(isValidPrivateKey('0x' + keyPair.privateKey)).toBe(true);
    });
  });

  describe('Edge Cases - signObject', () => {
    it('should handle null object', async () => {
      const keyPair = await generateKeyPair();
      const signature = await signObject(null, keyPair.privateKey);
      expect(signature).toHaveLength(128);
    });

    it('should handle undefined object', async () => {
      const keyPair = await generateKeyPair();
      const signature = await signObject(undefined, keyPair.privateKey);
      expect(signature).toHaveLength(128);
    });

    it('should handle array as root element', async () => {
      const keyPair = await generateKeyPair();
      const signature = await signObject([1, 2, 3], keyPair.privateKey);
      expect(signature).toHaveLength(128);
    });

    it('should handle empty object', async () => {
      const keyPair = await generateKeyPair();
      const signature = await signObject({}, keyPair.privateKey);
      expect(signature).toHaveLength(128);
    });
  });

  describe('Edge Cases - verifyObject', () => {
    it('should return false for invalid signature format', async () => {
      const keyPair = await generateKeyPair();
      const isValid = await verifyObject({ test: 1 }, 'invalid', keyPair.publicKey);
      expect(isValid).toBe(false);
    });

    it('should return false for invalid public key format', async () => {
      const keyPair = await generateKeyPair();
      const signature = await signObject({ test: 1 }, keyPair.privateKey);
      const isValid = await verifyObject({ test: 1 }, signature, 'invalid');
      expect(isValid).toBe(false);
    });
  });
});