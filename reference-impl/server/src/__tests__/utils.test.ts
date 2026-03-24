import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isFailure,
  isSuccess,
  success,
  failure,
  tryAsync,
  type Result,
  generateId,
  generateNonce,
  now,
  timestampAfter,
  EventEmitter,
  Cache,
} from '../utils.js';

describe('isFailure', () => {
  it('should return true for Failure result', () => {
    const result = failure(new Error('test error'));
    expect(isFailure(result)).toBe(true);
  });

  it('should return false for Success result', () => {
    const result = success('test value');
    expect(isFailure(result)).toBe(false);
  });

  it('should narrow type correctly for Failure', () => {
    const result: Result<string, Error> = failure(new Error('test error'));
    if (isFailure(result)) {
      expect(result.error.message).toBe('test error');
    }
  });
});

describe('isSuccess', () => {
  it('should return true for Success result', () => {
    const result = success('test value');
    expect(isSuccess(result)).toBe(true);
  });

  it('should return false for Failure result', () => {
    const result = failure(new Error('test error'));
    expect(isSuccess(result)).toBe(false);
  });
});

describe('tryAsync', () => {
  it('should return success for resolved promise', async () => {
    const promise = Promise.resolve('test value');
    const result = await tryAsync(promise);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('test value');
    }
  });

  it('should return failure for rejected promise with Error instance', async () => {
    const error = new Error('test error');
    const promise = Promise.reject(error);
    const result = await tryAsync(promise);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(error);
    }
  });

  it('should return failure with wrapped error for non-Error rejection', async () => {
    const promise = Promise.reject('string error');
    const result = await tryAsync(promise);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('string error');
    }
  });

  it('should return failure with wrapped error for object rejection', async () => {
    const promise = Promise.reject({ code: 500, message: 'server error' });
    const result = await tryAsync(promise);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('[object Object]');
    }
  });

  it('should use errorMapper when provided', async () => {
    const promise = Promise.reject(new Error('original error'));
    const result = await tryAsync(promise, (error) => ({
      code: 500,
      message: String(error),
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: 500,
        message: 'Error: original error',
      });
    }
  });

  it('should use errorMapper for non-Error rejection', async () => {
    const promise = Promise.reject('string error');
    const result = await tryAsync(promise, (error) => ({
      code: 400,
      message: `Mapped: ${String(error)}`,
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: 400,
        message: 'Mapped: string error',
      });
    }
  });

  it('should return failure with null rejection', async () => {
    const promise = Promise.reject(null);
    const result = await tryAsync(promise);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('null');
    }
  });

  it('should return failure with undefined rejection', async () => {
    const promise = Promise.reject(undefined);
    const result = await tryAsync(promise);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('undefined');
    }
  });

  it('should return failure with number rejection', async () => {
    const promise = Promise.reject(42);
    const result = await tryAsync(promise);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('42');
    }
  });
});

describe('success and failure helpers', () => {
  it('should create success result with value', () => {
    const result = success({ name: 'test' });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ name: 'test' });
  });

  it('should create failure result with error', () => {
    const error = new Error('test error');
    const result = failure(error);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(error);
  });

  it('should create failure result with custom error type', () => {
    const customError = { code: 404, reason: 'not found' };
    const result = failure(customError);
    expect(result.ok).toBe(false);
    expect(result.error).toEqual(customError);
  });
});

// ============================================================================
// generateId Tests
// ============================================================================

describe('generateId', () => {
  it('should generate ID with prefix', () => {
    const id = generateId('test');
    expect(id).toMatch(/^test_\d+_[a-z0-9]+$/);
  });

  it('should generate ID with default random length of 8', () => {
    const id = generateId('prefix');
    const parts = id.split('_');
    // Format: prefix_timestamp_random or prefix_timestamp_counter_random
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const randomPart = parts[parts.length - 1];
    expect(randomPart.length).toBe(8);
  });

  it('should generate ID with custom random length', () => {
    const id = generateId('prefix', 12);
    const parts = id.split('_');
    const randomPart = parts[parts.length - 1];
    // Note: Math.random().toString(36) may produce slightly shorter strings
    // due to leading zeros or the nature of base36 conversion
    expect(randomPart.length).toBeLessThanOrEqual(12);
    expect(randomPart.length).toBeGreaterThanOrEqual(6);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId('test'));
    }
    expect(ids.size).toBe(100);
  });

  it('should include timestamp in ID', () => {
    const before = Date.now();
    const id = generateId('test');
    const after = Date.now();
    const parts = id.split('_');
    const timestamp = parseInt(parts[1], 10);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

// ============================================================================
// generateNonce Tests
// ============================================================================

describe('generateNonce', () => {
  it('should generate nonce with default length of 32 bytes', () => {
    const nonce = generateNonce();
    // 32 bytes = 64 hex characters
    expect(nonce.length).toBe(64);
  });

  it('should generate nonce with custom length', () => {
    const nonce = generateNonce(16);
    // 16 bytes = 32 hex characters
    expect(nonce.length).toBe(32);
  });

  it('should generate hex format string', () => {
    const nonce = generateNonce(8);
    expect(nonce).toMatch(/^[0-9a-f]+$/);
  });

  it('should generate unique nonces', () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      nonces.add(generateNonce());
    }
    expect(nonces.size).toBe(100);
  });

  it('should generate different nonces for each call', () => {
    const nonce1 = generateNonce();
    const nonce2 = generateNonce();
    expect(nonce1).not.toBe(nonce2);
  });
});

// ============================================================================
// now Tests
// ============================================================================

describe('now', () => {
  it('should return ISO 8601 format string', () => {
    const timestamp = now();
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('should return current timestamp', () => {
    const before = new Date().toISOString();
    const timestamp = now();
    const after = new Date().toISOString();
    expect(timestamp >= before).toBe(true);
    expect(timestamp <= after).toBe(true);
  });

  it('should return valid Date when parsed', () => {
    const timestamp = now();
    const date = new Date(timestamp);
    expect(date).toBeInstanceOf(Date);
    expect(isNaN(date.getTime())).toBe(false);
  });
});

// ============================================================================
// timestampAfter Tests
// ============================================================================

describe('timestampAfter', () => {
  it('should return ISO 8601 format string', () => {
    const timestamp = timestampAfter(60);
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('should return future timestamp', () => {
    const nowTimestamp = Date.now();
    const futureTimestamp = timestampAfter(300);
    const futureDate = new Date(futureTimestamp);
    const expectedTime = nowTimestamp + 300 * 1000;
    // Allow 100ms tolerance for execution time
    expect(futureDate.getTime()).toBeGreaterThanOrEqual(expectedTime - 100);
    expect(futureDate.getTime()).toBeLessThanOrEqual(expectedTime + 100);
  });

  it('should calculate correct time for zero seconds', () => {
    const before = new Date().toISOString();
    const timestamp = timestampAfter(0);
    const after = new Date().toISOString();
    expect(timestamp >= before).toBe(true);
    expect(timestamp <= after).toBe(true);
  });

  it('should calculate correct time for large values', () => {
    const seconds = 86400; // 1 day
    const timestamp = timestampAfter(seconds);
    const futureDate = new Date(timestamp);
    const now = new Date();
    const diffMs = futureDate.getTime() - now.getTime();
    const expectedDiffMs = seconds * 1000;
    // Allow 100ms tolerance
    expect(diffMs).toBeGreaterThanOrEqual(expectedDiffMs - 100);
    expect(diffMs).toBeLessThanOrEqual(expectedDiffMs + 100);
  });
});

// ============================================================================
// EventEmitter Tests
// ============================================================================

describe('EventEmitter', () => {
  it('should emit event to registered handler', () => {
    const emitter = new EventEmitter<string>();
    const handler = vi.fn();
    emitter.add(handler);
    emitter.emit('test event');
    expect(handler).toHaveBeenCalledWith('test event');
  });

  it('should emit event to multiple handlers', () => {
    const emitter = new EventEmitter<number>();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    emitter.add(handler1);
    emitter.add(handler2);
    emitter.emit(42);
    expect(handler1).toHaveBeenCalledWith(42);
    expect(handler2).toHaveBeenCalledWith(42);
  });

  it('should remove handler correctly', () => {
    const emitter = new EventEmitter<string>();
    const handler = vi.fn();
    emitter.add(handler);
    emitter.remove(handler);
    emitter.emit('test');
    expect(handler).not.toHaveBeenCalled();
  });

  it('should return correct size', () => {
    const emitter = new EventEmitter<void>();
    expect(emitter.size).toBe(0);
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    emitter.add(handler1);
    expect(emitter.size).toBe(1);
    emitter.add(handler2);
    expect(emitter.size).toBe(2);
    emitter.remove(handler1);
    expect(emitter.size).toBe(1);
  });

  it('should not add duplicate handler', () => {
    const emitter = new EventEmitter<string>();
    const handler = vi.fn();
    emitter.add(handler);
    emitter.add(handler);
    expect(emitter.size).toBe(1);
  });

  it('should handle errors in handlers gracefully', () => {
    const emitter = new EventEmitter<string>();
    const errorHandler = vi.fn(() => {
      throw new Error('Handler error');
    });
    const normalHandler = vi.fn();

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    emitter.add(errorHandler);
    emitter.add(normalHandler);
    emitter.emit('test');

    expect(errorHandler).toHaveBeenCalled();
    expect(normalHandler).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should clear all handlers', () => {
    const emitter = new EventEmitter<string>();
    emitter.add(vi.fn());
    emitter.add(vi.fn());
    expect(emitter.size).toBe(2);
    emitter.clear();
    expect(emitter.size).toBe(0);
  });

  it('should handle emitting when no handlers registered', () => {
    const emitter = new EventEmitter<string>();
    expect(() => emitter.emit('test')).not.toThrow();
  });
});

// ============================================================================
// Cache Tests
// ============================================================================

describe('Cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should set and get value', () => {
    const cache = new Cache<string>();
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('should return undefined for non-existent key', () => {
    const cache = new Cache<string>();
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('should delete value', () => {
    const cache = new Cache<string>();
    cache.set('key1', 'value1');
    expect(cache.delete('key1')).toBe(true);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should return false when deleting non-existent key', () => {
    const cache = new Cache<string>();
    expect(cache.delete('nonexistent')).toBe(false);
  });

  it('should clear all values', () => {
    const cache = new Cache<string>();
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.clear();
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBeUndefined();
  });

  it('should expire value after TTL', () => {
    const cache = new Cache<string>(1000); // 1 second TTL
    cache.set('key1', 'value1');

    vi.advanceTimersByTime(500);
    expect(cache.get('key1')).toBe('value1');

    vi.advanceTimersByTime(501);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should use custom TTL for specific entry', () => {
    const cache = new Cache<string>(10000); // 10 second default TTL
    cache.set('key1', 'value1', 500); // 500ms custom TTL

    vi.advanceTimersByTime(400);
    expect(cache.get('key1')).toBe('value1');

    vi.advanceTimersByTime(101);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should handle different value types', () => {
    const cache = new Cache<{ name: string; count: number }>();
    cache.set('obj', { name: 'test', count: 42 });
    const value = cache.get('obj');
    expect(value).toEqual({ name: 'test', count: 42 });
  });

  it('should allow overwriting existing key', () => {
    const cache = new Cache<string>();
    cache.set('key1', 'value1');
    cache.set('key1', 'value2');
    expect(cache.get('key1')).toBe('value2');
  });

  it('should reset TTL when overwriting key', () => {
    const cache = new Cache<string>(1000);
    cache.set('key1', 'value1');

    vi.advanceTimersByTime(500);
    cache.set('key1', 'value2'); // Reset TTL

    vi.advanceTimersByTime(600); // Total 1100ms from first set, but 600ms from second set
    expect(cache.get('key1')).toBe('value2');

    vi.advanceTimersByTime(401); // Now past TTL
    expect(cache.get('key1')).toBeUndefined();
  });
});