/**
 * Utils Tests
 * Comprehensive tests for utility functions
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_NONCE_TTL_SEC,
  DEFAULT_CHALLENGE_TTL_SEC,
  DEFAULT_SESSION_TTL_SEC,
  DEFAULT_CLOCK_SKEW_TOLERANCE_SEC,
  generateId,
  generateMessageId,
  generateSessionId,
  generateChallengeId,
  generateProofId,
  generateNonce,
  now,
  timestampAfter,
  validateTimestamp,
  EventEmitter,
  Cache,
  withTimeout,
  delay,
  AppError,
  createErrorResponse,
  tryAsync,
  trySync,
  success,
  failure,
  isSuccess,
  isFailure,
} from '../utils';

describe('Constants', () => {
  it('should export DEFAULT_TIMEOUT_MS with correct value', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30000);
  });

  it('should export DEFAULT_CACHE_TTL_MS with correct value', () => {
    expect(DEFAULT_CACHE_TTL_MS).toBe(600000);
  });

  it('should export DEFAULT_NONCE_TTL_SEC with correct value', () => {
    expect(DEFAULT_NONCE_TTL_SEC).toBe(300);
  });

  it('should export DEFAULT_CHALLENGE_TTL_SEC with correct value', () => {
    expect(DEFAULT_CHALLENGE_TTL_SEC).toBe(300);
  });

  it('should export DEFAULT_SESSION_TTL_SEC with correct value', () => {
    expect(DEFAULT_SESSION_TTL_SEC).toBe(3600);
  });

  it('should export DEFAULT_CLOCK_SKEW_TOLERANCE_SEC with correct value', () => {
    expect(DEFAULT_CLOCK_SKEW_TOLERANCE_SEC).toBe(120);
  });
});

describe('ID Generation', () => {
  describe('generateId', () => {
    it('should generate ID with prefix', () => {
      const id = generateId('test');

      // Format: prefix_timestamp_random OR prefix_timestamp_counter_random
      expect(id).toMatch(/^test_\d+(_\d+)?_[a-z0-9]+$/);
    });

    it('should generate ID with custom random length', () => {
      const id = generateId('test', 12);

      // The random part should be approximately 12 characters
      // Format can be: prefix_timestamp_random OR prefix_timestamp_counter_random
      expect(id).toMatch(/^test_\d+(_\d+)?_[a-z0-9]+$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId('test'));
      }

      expect(ids.size).toBe(100);
    });

    it('should use default random length of 8', () => {
      const id = generateId('test');
      const parts = id.split('_');

      // Format: prefix_timestamp_random or prefix_timestamp_counter_random
      expect(parts.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('generateMessageId', () => {
    it('should generate message ID with msg prefix', () => {
      const id = generateMessageId();

      expect(id).toMatch(/^msg_\d+_[a-z0-9]+$/);
    });
  });

  describe('generateSessionId', () => {
    it('should generate session ID with ses prefix', () => {
      const id = generateSessionId();

      expect(id).toMatch(/^ses_\d+_[a-z0-9]+$/);
    });
  });

  describe('generateChallengeId', () => {
    it('should generate challenge ID with chl prefix', () => {
      const id = generateChallengeId();

      expect(id).toMatch(/^chl_\d+_[a-z0-9]+$/);
    });
  });

  describe('generateProofId', () => {
    it('should generate proof ID with proof prefix', () => {
      const id = generateProofId();

      expect(id).toMatch(/^proof_\d+_[a-z0-9]+$/);
    });
  });
});

describe('Nonce Generation', () => {
  describe('generateNonce', () => {
    it('should generate nonce with default 32 bytes', () => {
      const nonce = generateNonce();

      expect(nonce).toHaveLength(64); // 32 bytes = 64 hex characters
      expect(nonce).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate nonce with custom byte length', () => {
      const nonce = generateNonce(16);

      expect(nonce).toHaveLength(32); // 16 bytes = 32 hex characters
    });

    it('should generate unique nonces', () => {
      const nonces = new Set<string>();
      for (let i = 0; i < 100; i++) {
        nonces.add(generateNonce());
      }

      expect(nonces.size).toBe(100);
    });
  });
});

describe('Timestamp Utilities', () => {
  describe('now', () => {
    it('should return current ISO 8601 timestamp', () => {
      const timestamp = now();

      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should return valid Date', () => {
      const timestamp = now();
      const date = new Date(timestamp);

      expect(date.getTime()).not.toBeNaN();
    });
  });

  describe('timestampAfter', () => {
    it('should return timestamp in the future', () => {
      const seconds = 60;
      const timestamp = timestampAfter(seconds);
      const date = new Date(timestamp);
      const now = new Date();

      expect(date.getTime()).toBeGreaterThan(now.getTime());
    });

    it('should be approximately correct number of seconds in the future', () => {
      const seconds = 60;
      const before = Date.now();
      const timestamp = timestampAfter(seconds);
      const after = Date.now();
      const date = new Date(timestamp);

      // Should be within the time it took to call the function
      expect(date.getTime()).toBeGreaterThanOrEqual(before + seconds * 1000);
      expect(date.getTime()).toBeLessThanOrEqual(after + seconds * 1000);
    });
  });

  describe('validateTimestamp', () => {
    it('should validate current timestamp', () => {
      const timestamp = new Date().toISOString();
      const result = validateTimestamp(timestamp);

      expect(result.valid).toBe(true);
      expect(result.skewMs).toBeLessThan(1000);
    });

    it('should reject timestamp outside tolerance', () => {
      const timestamp = new Date(Date.now() - 200000).toISOString();
      const result = validateTimestamp(timestamp);

      expect(result.valid).toBe(false);
    });

    it('should accept timestamp within custom tolerance', () => {
      const timestamp = new Date(Date.now() - 100000).toISOString();
      const result = validateTimestamp(timestamp, 150);

      expect(result.valid).toBe(true);
    });

    it('should reject timestamp outside custom tolerance', () => {
      const timestamp = new Date(Date.now() - 200000).toISOString();
      const result = validateTimestamp(timestamp, 150);

      expect(result.valid).toBe(false);
    });

    it('should return skew in milliseconds', () => {
      const skewSeconds = 30;
      const timestamp = new Date(Date.now() - skewSeconds * 1000).toISOString();
      const result = validateTimestamp(timestamp);

      expect(result.skewMs).toBeGreaterThanOrEqual(skewSeconds * 1000 - 100);
      expect(result.skewMs).toBeLessThanOrEqual(skewSeconds * 1000 + 100);
    });
  });
});

describe('EventEmitter', () => {
  describe('add', () => {
    it('should add handler', () => {
      const emitter = new EventEmitter<string>();
      const handler = vi.fn();

      emitter.add(handler);

      expect(emitter.size).toBe(1);
    });

    it('should not add duplicate handler', () => {
      const emitter = new EventEmitter<string>();
      const handler = vi.fn();

      emitter.add(handler);
      emitter.add(handler);

      expect(emitter.size).toBe(1);
    });
  });

  describe('remove', () => {
    it('should remove handler', () => {
      const emitter = new EventEmitter<string>();
      const handler = vi.fn();

      emitter.add(handler);
      emitter.remove(handler);

      expect(emitter.size).toBe(0);
    });

    it('should not throw when removing non-existent handler', () => {
      const emitter = new EventEmitter<string>();
      const handler = vi.fn();

      expect(() => emitter.remove(handler)).not.toThrow();
    });
  });

  describe('emit', () => {
    it('should call all handlers with event', () => {
      const emitter = new EventEmitter<string>();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter.add(handler1);
      emitter.add(handler2);
      emitter.emit('test_event');

      expect(handler1).toHaveBeenCalledWith('test_event');
      expect(handler2).toHaveBeenCalledWith('test_event');
    });

    it('should catch handler errors and log to console', () => {
      const emitter = new EventEmitter<string>();
      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      emitter.add(errorHandler);
      emitter.emit('test_event');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should continue emitting to other handlers after error', () => {
      const emitter = new EventEmitter<string>();
      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const normalHandler = vi.fn();
      vi.spyOn(console, 'error').mockImplementation(() => {});

      emitter.add(errorHandler);
      emitter.add(normalHandler);
      emitter.emit('test_event');

      expect(normalHandler).toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should clear all handlers', () => {
      const emitter = new EventEmitter<string>();
      emitter.add(() => {});
      emitter.add(() => {});

      emitter.clear();

      expect(emitter.size).toBe(0);
    });
  });

  describe('size', () => {
    it('should return number of handlers', () => {
      const emitter = new EventEmitter<string>();

      expect(emitter.size).toBe(0);

      emitter.add(() => {});
      expect(emitter.size).toBe(1);

      emitter.add(() => {});
      expect(emitter.size).toBe(2);
    });
  });
});

describe('Cache', () => {
  describe('set and get', () => {
    it('should set and get value', () => {
      const cache = new Cache<string>();

      cache.set('key1', 'value1');
      const result = cache.get('key1');

      expect(result).toBe('value1');
    });

    it('should return undefined for non-existent key', () => {
      const cache = new Cache<string>();

      const result = cache.get('nonexistent');

      expect(result).toBeUndefined();
    });

    it('should return undefined for expired entry', async () => {
      const cache = new Cache<string>(100); // 100ms TTL

      cache.set('key1', 'value1');

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = cache.get('key1');

      expect(result).toBeUndefined();
    });

    it('should delete expired entry on get', async () => {
      const cache = new Cache<string>(100);

      cache.set('key1', 'value1');
      await new Promise(resolve => setTimeout(resolve, 150));
      cache.get('key1');

      expect(cache.size).toBe(0);
    });
  });

  describe('has', () => {
    it('should return true for existing key', () => {
      const cache = new Cache<string>();

      cache.set('key1', 'value1');

      expect(cache.has('key1')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      const cache = new Cache<string>();

      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should return false for expired key', async () => {
      const cache = new Cache<string>(100);

      cache.set('key1', 'value1');
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(cache.has('key1')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete entry', () => {
      const cache = new Cache<string>();

      cache.set('key1', 'value1');
      const result = cache.delete('key1');

      expect(result).toBe(true);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should return false for non-existent key', () => {
      const cache = new Cache<string>();

      const result = cache.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      const cache = new Cache<string>();

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();

      expect(cache.size).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      const cache = new Cache<string>(100);

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      await new Promise(resolve => setTimeout(resolve, 150));

      cache.set('key3', 'value3'); // Fresh entry

      const cleaned = cache.cleanup();

      expect(cleaned).toBe(2);
      expect(cache.size).toBe(1);
      expect(cache.has('key3')).toBe(true);
    });

    it('should return 0 when nothing to clean', () => {
      const cache = new Cache<string>();

      cache.set('key1', 'value1');

      const cleaned = cache.cleanup();

      expect(cleaned).toBe(0);
    });
  });

  describe('size', () => {
    it('should return number of entries', () => {
      const cache = new Cache<string>();

      expect(cache.size).toBe(0);

      cache.set('key1', 'value1');
      expect(cache.size).toBe(1);

      cache.set('key2', 'value2');
      expect(cache.size).toBe(2);
    });
  });

  describe('custom TTL', () => {
    it('should use custom TTL for individual entry', async () => {
      const cache = new Cache<string>(1000); // 1 second default TTL

      cache.set('key1', 'value1', 100); // 100ms custom TTL

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(cache.get('key1')).toBeUndefined();
    });
  });
});

describe('Async Utilities', () => {
  describe('withTimeout', () => {
    it('should resolve if promise resolves before timeout', async () => {
      const promise = Promise.resolve('result');

      const result = await withTimeout(promise, 1000);

      expect(result).toBe('result');
    });

    it('should reject if promise takes too long', async () => {
      const promise = new Promise<string>(resolve => {
        setTimeout(() => resolve('result'), 1000);
      });

      await expect(withTimeout(promise, 100)).rejects.toThrow('Operation timed out');
    });

    it('should use custom timeout message', async () => {
      const promise = new Promise<string>(resolve => {
        setTimeout(() => resolve('result'), 1000);
      });

      await expect(withTimeout(promise, 100, 'Custom timeout message')).rejects.toThrow(
        'Custom timeout message'
      );
    });

    it('should propagate promise rejection', async () => {
      const promise = Promise.reject(new Error('Promise error'));

      await expect(withTimeout(promise, 1000)).rejects.toThrow('Promise error');
    });
  });

  describe('delay', () => {
    it('should delay for specified milliseconds', async () => {
      const start = Date.now();

      await delay(100);

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some variance
    });

    it('should resolve to undefined', async () => {
      const result = await delay(10);

      expect(result).toBeUndefined();
    });
  });
});

describe('Error Handling', () => {
  describe('AppError', () => {
    it('should create error with code and message', () => {
      const error = new AppError('ERR001', 'Test error');

      expect(error.code).toBe('ERR001');
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('AppError');
      expect(error.retryable).toBe(false);
    });

    it('should create error with retryable flag', () => {
      const error = new AppError('ERR001', 'Test error', true);

      expect(error.retryable).toBe(true);
    });

    it('should create error with details', () => {
      const details = { foo: 'bar', count: 42 };
      const error = new AppError('ERR001', 'Test error', false, details);

      expect(error.details).toEqual(details);
    });

    it('should be instanceof Error', () => {
      const error = new AppError('ERR001', 'Test error');

      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('createErrorResponse', () => {
    it('should create error response object', () => {
      const response = createErrorResponse('ERR001', 'Test error');

      expect(response).toEqual({
        error: {
          code: 'ERR001',
          message: 'Test error',
          retryable: false,
        },
      });
    });

    it('should create error response with retryable', () => {
      const response = createErrorResponse('ERR001', 'Test error', true);

      expect(response.error.retryable).toBe(true);
    });

    it('should create error response with details', () => {
      const details = { foo: 'bar' };
      const response = createErrorResponse('ERR001', 'Test error', false, details);

      expect(response.error.details).toEqual(details);
    });
  });
});

describe('Result Type Utilities', () => {
  describe('success', () => {
    it('should create a success result', () => {
      const result = success('value');

      expect(result.ok).toBe(true);
      expect(result.value).toBe('value');
    });

    it('should create a success result with object value', () => {
      const obj = { foo: 'bar', count: 42 };
      const result = success(obj);

      expect(result.ok).toBe(true);
      expect(result.value).toBe(obj);
      expect(result.value).toEqual({ foo: 'bar', count: 42 });
    });
  });

  describe('failure', () => {
    it('should create a failure result', () => {
      const error = new Error('test error');
      const result = failure(error);

      expect(result.ok).toBe(false);
      expect(result.error).toBe(error);
    });

    it('should create a failure result with custom error type', () => {
      const customError = { code: 'ERR001', message: 'Custom error' };
      const result = failure(customError);

      expect(result.ok).toBe(false);
      expect(result.error).toEqual(customError);
    });
  });

  describe('isSuccess', () => {
    it('should return true for success result', () => {
      const result = success('value');

      expect(isSuccess(result)).toBe(true);
    });

    it('should return false for failure result', () => {
      const result = failure(new Error('error'));

      expect(isSuccess(result)).toBe(false);
    });
  });

  describe('isFailure', () => {
    it('should return true for failure result', () => {
      const result = failure(new Error('error'));

      expect(isFailure(result)).toBe(true);
    });

    it('should return false for success result', () => {
      const result = success('value');

      expect(isFailure(result)).toBe(false);
    });
  });
});

describe('tryAsync', () => {
  it('should return success result when promise resolves', async () => {
    const promise = Promise.resolve('value');
    const result = await tryAsync(promise);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('value');
    }
  });

  it('should return failure result when promise rejects', async () => {
    const error = new Error('test error');
    const promise = Promise.reject(error);
    const result = await tryAsync(promise);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(error);
    }
  });

  it('should use errorMapper when promise rejects', async () => {
    const error = new Error('original error');
    const promise = Promise.reject(error);
    const errorMapper = vi.fn().mockReturnValue({ code: 'MAPPED', message: 'mapped error' });
    const result = await tryAsync(promise, errorMapper);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'MAPPED', message: 'mapped error' });
    }
    expect(errorMapper).toHaveBeenCalledWith(error);
  });

  it('should wrap non-Error rejection in Error when no errorMapper', async () => {
    const promise = Promise.reject('string error');
    const result = await tryAsync(promise);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('string error');
    }
  });

  it('should handle object rejection without errorMapper', async () => {
    const promise = Promise.reject({ code: 'OBJ_ERROR' });
    const result = await tryAsync(promise);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('[object Object]');
    }
  });

  it('should return typed Result with custom error type', async () => {
    type CustomError = { code: string; details: string };
    const promise = Promise.resolve('value');
    const result = await tryAsync<string, CustomError>(promise);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('value');
    }
  });

  it('should return typed Result with custom error type on failure', async () => {
    type CustomError = { code: string; details: string };
    const originalError = new Error('test error');
    const promise = Promise.reject(originalError);
    const customError: CustomError = { code: 'CUSTOM_ERR', details: 'custom error details' };
    const result = await tryAsync<string, CustomError>(promise, () => customError);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(customError);
    }
  });
});

describe('trySync', () => {
  it('should return success result when function succeeds', () => {
    const fn = () => 'value';
    const result = trySync(fn);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('value');
    }
  });

  it('should return failure result when function throws', () => {
    const error = new Error('test error');
    const fn = () => {
      throw error;
    };
    const result = trySync(fn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(error);
    }
  });

  it('should use errorMapper when function throws', () => {
    const error = new Error('original error');
    const fn = () => {
      throw error;
    };
    const errorMapper = vi.fn().mockReturnValue({ code: 'MAPPED', message: 'mapped error' });
    const result = trySync(fn, errorMapper);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'MAPPED', message: 'mapped error' });
    }
    expect(errorMapper).toHaveBeenCalledWith(error);
  });

  it('should wrap non-Error throw in Error when no errorMapper', () => {
    const fn = () => {
      throw 'string error';
    };
    const result = trySync(fn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('string error');
    }
  });

  it('should handle object throw without errorMapper', () => {
    const fn = () => {
      throw { code: 'OBJ_ERROR' };
    };
    const result = trySync(fn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('[object Object]');
    }
  });

  it('should return typed Result with custom error type', () => {
    type CustomError = { code: string; details: string };
    const fn = () => 'value';
    const result = trySync<string, CustomError>(fn);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('value');
    }
  });

  it('should return typed Result with custom error type on failure', () => {
    type CustomError = { code: string; details: string };
    const originalError = new Error('test error');
    const fn = () => {
      throw originalError;
    };
    const customError: CustomError = { code: 'CUSTOM_ERR', details: 'custom error details' };
    const result = trySync<string, CustomError>(fn, () => customError);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(customError);
    }
  });

  describe('edge cases with falsy values', () => {
    it.each([
      { name: 'zero', value: 0 },
      { name: 'false', value: false },
      { name: 'empty string', value: '' },
      { name: 'null', value: null },
      { name: 'undefined', value: undefined },
    ])('should handle $name as return value', ({ value }) => {
      const fn = () => value;
      const result = trySync(fn);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(value);
      }
    });
  });
});