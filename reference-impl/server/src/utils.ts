/**
 * Common Utilities - 共通ユーティリティ関数 (Server用)
 * @module server/common/utils
 */

import type { IdString, Timestamp } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** デフォルトタイムアウト (ms) */
export const DEFAULT_TIMEOUT_MS = 30000;

/** デフォルトキャッシュTTL (ms) */
export const DEFAULT_CACHE_TTL_MS = 600000; // 10分

/** デフォルトnonce TTL (秒) */
export const DEFAULT_NONCE_TTL_SEC = 300;

/** デフォルトChallenge TTL (秒) */
export const DEFAULT_CHALLENGE_TTL_SEC = 300;

/** デフォルトSession TTL (秒) */
export const DEFAULT_SESSION_TTL_SEC = 3600;

/** 時刻許容skew (秒) */
export const DEFAULT_CLOCK_SKEW_TOLERANCE_SEC = 120;

/** デフォルト最大シーケンスskew */
export const DEFAULT_MAX_SEQUENCE_SKEW = 10;

/** デフォルトメッセージタイムアウト (ms) */
export const DEFAULT_MESSAGE_TIMEOUT_MS = 30000;

// ============================================================================
// ID Generation
// ============================================================================

const ID_COUNTERS = new Map<string, number>();

/**
 * 一意のIDを生成する
 */
export function generateId(prefix: string, randomLength: number = 8): IdString {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 2 + randomLength);

  const key = `${prefix}:${timestamp}`;
  const counter = ID_COUNTERS.get(key) || 0;
  ID_COUNTERS.set(key, counter + 1);

  const now = Date.now();
  for (const [k] of ID_COUNTERS) {
    const ts = parseInt(k.split(':')[1], 10);
    if (now - ts > 1000) {
      ID_COUNTERS.delete(k);
    }
  }

  return counter > 0
    ? `${prefix}_${timestamp}_${counter}_${random}`
    : `${prefix}_${timestamp}_${random}`;
}

/**
 * Message ID生成
 */
export function generateMessageId(): IdString {
  return generateId('msg');
}

/**
 * Session ID生成
 */
export function generateSessionId(): IdString {
  return generateId('ses');
}

/**
 * Challenge ID生成
 */
export function generateChallengeId(): IdString {
  return generateId('chl');
}

// ============================================================================
// Nonce Generation
// ============================================================================

/**
 * 暗号学的に安全なnonceを生成する
 */
export function generateNonce(bytes: number = 32): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// Timestamp Utilities
// ============================================================================

/**
 * 現在のISO 8601タイムスタンプを取得
 */
export function now(): Timestamp {
  return new Date().toISOString();
}

/**
 * 指定秒後のISO 8601タイムスタンプを取得
 */
export function timestampAfter(seconds: number): Timestamp {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

// ============================================================================
// Event Emitter
// ============================================================================

/** イベントハンドラ型 */
export type EventHandler<T = unknown> = (event: T) => void;

/**
 * 型安全なイベントエミッター
 */
export class EventEmitter<T> {
  private handlers: Set<EventHandler<T>> = new Set();

  add(handler: EventHandler<T>): void {
    this.handlers.add(handler);
  }

  remove(handler: EventHandler<T>): void {
    this.handlers.delete(handler);
  }

  emit(event: T): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Event handler error:', error);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }

  get size(): number {
    return this.handlers.size;
  }
}

// ============================================================================
// Cache Manager
// ============================================================================

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
  ttlMs: number;
}

/**
 * シンプルなTTLキャッシュ
 */
export class Cache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = DEFAULT_CACHE_TTL_MS) {
    this.defaultTtlMs = defaultTtlMs;
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.cache.set(key, {
      value,
      cachedAt: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    });
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

// ============================================================================
// Result Type (Functional Error Handling)
// ============================================================================

/** 成功結果 */
export type Success<T> = { ok: true; value: T };

/** 失敗結果 */
export type Failure<E = Error> = { ok: false; error: E };

/** Result型 */
export type Result<T, E = Error> = Success<T> | Failure<E>;

/** 成功結果を作成 */
export function success<T>(value: T): Success<T> {
  return { ok: true, value };
}

/** 失敗結果を作成 */
export function failure<E = Error>(error: E): Failure<E> {
  return { ok: false, error };
}

/** Resultが成功かどうか判定 */
export function isSuccess<T, E>(result: Result<T, E>): result is Success<T> {
  return result.ok === true;
}

/** Resultが失敗かどうか判定 */
export function isFailure<T, E>(result: Result<T, E>): result is Failure<E> {
  return result.ok === false;
}

/**
 * PromiseをResultに変換
 */
export async function tryAsync<T, E = Error>(
  promise: Promise<T>,
  errorMapper?: (error: unknown) => E
): Promise<Result<T, E>> {
  try {
    const value = await promise;
    return success(value);
  } catch (error) {
    if (errorMapper) {
      return failure(errorMapper(error));
    }
    return failure(error instanceof Error ? error as E : new Error(String(error)) as E);
  }
}