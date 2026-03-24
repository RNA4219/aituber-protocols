/**
 * Common Utilities - 共通ユーティリティ関数
 * @module common/utils
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

// ============================================================================
// ID Generation
// ============================================================================

/** ID生成オプション */
export interface IdGeneratorOptions {
  prefix: string;
  randomLength?: number;
}

const ID_COUNTERS = new Map<string, number>();

/**
 * 一意のIDを生成する
 * @param prefix IDプレフィックス
 * @param randomLength ランダム部分の長さ (default: 8)
 * @returns 生成されたID
 */
export function generateId(prefix: string, randomLength: number = 8): IdString {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 2 + randomLength);

  // カウンターベースの一意性確保（同一ミリ秒対策）
  const key = `${prefix}:${timestamp}`;
  const counter = ID_COUNTERS.get(key) || 0;
  ID_COUNTERS.set(key, counter + 1);

  // 古いカウンターエントリをクリーンアップ（1秒以上前）
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

/**
 * Proof ID生成
 */
export function generateProofId(): IdString {
  return generateId('proof');
}

// ============================================================================
// Nonce Generation
// ============================================================================

/**
 * 暗号学的に安全なnonceを生成する
 * @param bytes nonceのバイト長 (default: 32)
 * @returns hex形式のnonce
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

/**
 * タイムスタンプの妥当性を検証
 * @param timestamp 検証対象タイムスタンプ
 * @param skewToleranceSeconds 許容する時刻skew (秒)
 * @returns 検証結果
 */
export function validateTimestamp(
  timestamp: Timestamp,
  skewToleranceSeconds: number = DEFAULT_CLOCK_SKEW_TOLERANCE_SEC
): { valid: boolean; skewMs: number } {
  const time = new Date(timestamp);
  const now = new Date();
  const skewMs = Math.abs(now.getTime() - time.getTime());

  return {
    valid: skewMs <= skewToleranceSeconds * 1000,
    skewMs,
  };
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

  /** ハンドラを追加 */
  add(handler: EventHandler<T>): void {
    this.handlers.add(handler);
  }

  /** ハンドラを削除 */
  remove(handler: EventHandler<T>): void {
    this.handlers.delete(handler);
  }

  /** イベントを発火 */
  emit(event: T): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Event handler error:', error);
      }
    }
  }

  /** 全ハンドラをクリア */
  clear(): void {
    this.handlers.clear();
  }

  /** ハンドラ数を取得 */
  get size(): number {
    return this.handlers.size;
  }
}

// ============================================================================
// Cache Manager
// ============================================================================

/** キャッシュエントリ */
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

  /** 値を設定 */
  set(key: string, value: T, ttlMs?: number): void {
    this.cache.set(key, {
      value,
      cachedAt: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    });
  }

  /** 値を取得 */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /** キーが存在するか確認 */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** 値を削除 */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /** 全エントリをクリア */
  clear(): void {
    this.cache.clear();
  }

  /** 期限切れエントリをクリーンアップ */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache) {
      if (now - entry.cachedAt > entry.ttlMs) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  /** エントリ数を取得 */
  get size(): number {
    return this.cache.size;
  }
}

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * タイムアウト付きPromise
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

/**
 * 遅延
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Error Handling
// ============================================================================

/** アプリケーションエラー */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean = false,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * エラーレスポンス作成
 */
export function createErrorResponse(
  code: string,
  message: string,
  retryable: boolean = false,
  details?: Record<string, unknown>
): { error: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> } } {
  return {
    error: {
      code,
      message,
      retryable,
      details,
    },
  };
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
 * 例外をキャッチしてFailureとして返す
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

/**
 * 関数をResultを返す関数に変換
 */
export function trySync<T, E = Error>(
  fn: () => T,
  errorMapper?: (error: unknown) => E
): Result<T, E> {
  try {
    return success(fn());
  } catch (error) {
    if (errorMapper) {
      return failure(errorMapper(error));
    }
    return failure(error instanceof Error ? error as E : new Error(String(error)) as E);
  }
}