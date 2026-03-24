/**
 * AITuber相互認証・交流プロトコル 暗号ユーティリティ (Server)
 * @see ../../../specs/core/interfaces.md
 * @see ../../../schemas/core/common.schema.json
 */

import * as ed25519 from '@noble/ed25519';
import { createHash } from 'crypto';

// ============================================================================
// Types
// ============================================================================

/** 鍵ペア */
export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

/** 署名パラメータ */
export interface SignParams {
  /** 署名対象メッセージ */
  message: string;
  /** 秘密鍵 (hex or base64) */
  privateKey: string;
}

/** 検証パラメータ */
export interface VerifyParams {
  /** 検証対象メッセージ */
  message: string;
  /** 署名値 (hex or base64) */
  signature: string;
  /** 公開鍵 (hex or base64) */
  publicKey: string;
}

/** 署名アルゴリズム */
export const SIGNATURE_ALGORITHM = 'ed25519';

/** 正準化アルゴリズム */
export const CANONICALIZATION_ALGORITHM = 'jcs';

// ============================================================================
// Key Generation
// ============================================================================

/**
 * Ed25519鍵ペアを生成する
 * @returns 鍵ペア (publicKey, privateKey はhex形式)
 */
export async function generateKeyPair(): Promise<KeyPair> {
  // ランダムな秘密鍵を生成 (32バイト)
  const privateKeyBytes = ed25519.utils.randomPrivateKey();

  // 秘密鍵から公開鍵を導出
  const publicKeyBytes = await ed25519.getPublicKeyAsync(privateKeyBytes);

  return {
    publicKey: Buffer.from(publicKeyBytes).toString('hex'),
    privateKey: Buffer.from(privateKeyBytes).toString('hex'),
  };
}

/**
 * 秘密鍵から公開鍵を導出する
 * @param privateKey 秘密鍵 (hex形式)
 * @returns 公開鍵 (hex形式)
 */
export async function derivePublicKey(privateKey: string): Promise<string> {
  const privateKeyBytes = hexToBytes(privateKey);
  const publicKeyBytes = await ed25519.getPublicKeyAsync(privateKeyBytes);
  return Buffer.from(publicKeyBytes).toString('hex');
}

// ============================================================================
// Signing
// ============================================================================

/**
 * メッセージに署名する
 * @param message 署名対象メッセージ
 * @param privateKey 秘密鍵 (hex形式)
 * @returns 署名値 (hex形式)
 */
export async function sign(message: string, privateKey: string): Promise<string> {
  const privateKeyBytes = hexToBytes(privateKey);
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = await ed25519.signAsync(messageBytes, privateKeyBytes);
  return Buffer.from(signatureBytes).toString('hex');
}

/**
 * オブジェクトを正準化して署名する
 * @param obj 署名対象オブジェクト
 * @param privateKey 秘密鍵 (hex形式)
 * @returns 署名値 (hex形式)
 */
export async function signObject(obj: unknown, privateKey: string): Promise<string> {
  const canonical = canonicalize(obj);
  return sign(canonical, privateKey);
}

// ============================================================================
// Verification
// ============================================================================

/**
 * 署名を検証する
 * @param message 検証対象メッセージ
 * @param signature 署名値 (hex形式)
 * @param publicKey 公開鍵 (hex形式)
 * @returns 検証結果
 */
export async function verify(
  message: string,
  signature: string,
  publicKey: string
): Promise<boolean> {
  try {
    const publicKeyBytes = hexToBytes(publicKey);
    const signatureBytes = hexToBytes(signature);
    const messageBytes = new TextEncoder().encode(message);
    return await ed25519.verifyAsync(signatureBytes, messageBytes, publicKeyBytes);
  } catch {
    return false;
  }
}

/**
 * オブジェクトの署名を検証する
 * @param obj 検証対象オブジェクト
 * @param signature 署名値 (hex形式)
 * @param publicKey 公開鍵 (hex形式)
 * @returns 検証結果
 */
export async function verifyObject(
  obj: unknown,
  signature: string,
  publicKey: string
): Promise<boolean> {
  const canonical = canonicalize(obj);
  return verify(canonical, signature, publicKey);
}

// ============================================================================
// Canonicalization (JCS - JSON Canonicalization Scheme)
// ============================================================================

/**
 * オブジェクトをJCS (JSON Canonicalization Scheme) で正準化する
 * RFC 8785: JSON Canonicalization Scheme (JCS)
 *
 * 仕様:
 * - オブジェクトのプロパティをUnicodeコードポイント順でソート
 * - 配列は順序を維持
 * - 数値は正規化された形式で出力
 * - 文字列はエスケープ処理
 *
 * @param obj 正準化対象オブジェクト
 * @returns 正準化されたJSON文字列
 */
export function canonicalize(obj: unknown): string {
  return _canonicalizeValue(obj);
}

/**
 * 値を正準化する内部関数
 */
function _canonicalizeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'null'; // undefined は null として扱う
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    // 特殊な数値の処理
    if (Number.isNaN(value)) {
      return 'NaN';
    }
    if (!Number.isFinite(value)) {
      return value > 0 ? 'Infinity' : '-Infinity';
    }
    // 整数の場合は小数点なし、浮動小数点は適切な形式で
    if (Number.isInteger(value)) {
      return value.toString();
    }
    // 浮動小数点数
    return _serializeNumber(value);
  }

  if (typeof value === 'string') {
    return _canonicalizeString(value);
  }

  if (Array.isArray(value)) {
    return _canonicalizeArray(value);
  }

  if (typeof value === 'object') {
    return _canonicalizeObject(value as Record<string, unknown>);
  }

  // その他の型は文字列として扱う
  return _canonicalizeString(String(value));
}

/**
 * 数値を正準化形式でシリアライズする
 * RFC 8785 Section 3.2.2.3 に準拠
 */
function _serializeNumber(num: number): string {
  // 非常に小さいまたは非常に大きい数値は指数表現
  const absNum = Math.abs(num);

  // 整数値の場合
  if (Number.isInteger(num)) {
    return num.toString();
  }

  // 標準的な浮動小数点表現
  const str = num.toString();

  // 指数表記の場合は正規化
  if (str.includes('e') || str.includes('E')) {
    return num.toExponential(15).replace(/\.?0+e/, 'e');
  }

  return str;
}

/**
 * 文字列を正準化する
 * Unicodeエスケープ処理を含む
 */
function _canonicalizeString(str: string): string {
  let result = '"';

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const code = str.charCodeAt(i);

    // エスケープが必要な文字
    switch (char) {
      case '"':
        result += '\\"';
        break;
      case '\\':
        result += '\\\\';
        break;
      case '\b':
        result += '\\b';
        break;
      case '\f':
        result += '\\f';
        break;
      case '\n':
        result += '\\n';
        break;
      case '\r':
        result += '\\r';
        break;
      case '\t':
        result += '\\t';
        break;
      default:
        // 制御文字 (U+0000 - U+001F) はエスケープ
        if (code < 0x20) {
          result += '\\u' + code.toString(16).padStart(4, '0');
        } else {
          result += char;
        }
    }
  }

  result += '"';
  return result;
}

/**
 * オブジェクトを正準化する
 * プロパティをソートして再帰的に処理
 */
function _canonicalizeObject(obj: Record<string, unknown>): string {
  // プロパティキーをUnicodeコードポイント順でソート
  const sortedKeys = Object.keys(obj).sort((a, b) => {
    // Unicodeコードポイント順での比較
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const codeA = a.codePointAt(i) as number;
      const codeB = b.codePointAt(i) as number;
      if (codeA !== codeB) {
        return codeA - codeB;
      }
    }
    return a.length - b.length;
  });

  const parts: string[] = [];

  for (const key of sortedKeys) {
    const value = obj[key];
    // undefined は出力しない (JCS仕様)
    if (value !== undefined) {
      parts.push(_canonicalizeString(key) + ':' + _canonicalizeValue(value));
    }
  }

  return '{' + parts.join(',') + '}';
}

/**
 * 配列を正準化する
 * 順序を維持して再帰的に処理
 */
function _canonicalizeArray(arr: unknown[]): string {
  const parts = arr.map(item => _canonicalizeValue(item));
  return '[' + parts.join(',') + ']';
}

// ============================================================================
// Hashing
// ============================================================================

/**
 * SHA-256ハッシュを計算する
 * @param data ハッシュ対象データ
 * @returns ハッシュ値 (hex形式、sha256:プレフィックス付き)
 */
export function hash(data: string): string {
  const hashBuffer = createHash('sha256').update(data, 'utf8').digest();
  return 'sha256:' + hashBuffer.toString('hex');
}

/**
 * オブジェクトのハッシュを計算する
 * @param obj ハッシュ対象オブジェクト
 * @returns ハッシュ値 (hex形式、sha256:プレフィックス付き)
 */
export function hashObject(obj: unknown): string {
  const canonical = canonicalize(obj);
  return hash(canonical);
}

/**
 * 生のSHA-256ハッシュを計算する (プレフィックスなし)
 * @param data ハッシュ対象データ
 * @returns ハッシュ値 (hex形式)
 */
export function hashRaw(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * hex文字列をバイト配列に変換する
 * @param hex hex文字列
 * @returns バイト配列
 */
function hexToBytes(hex: string): Uint8Array {
  // 0xプレフィックスを削除
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * base64文字列をhex文字列に変換する
 * @param base64 base64文字列
 * @returns hex文字列
 */
export function base64ToHex(base64: string): string {
  const buffer = Buffer.from(base64, 'base64');
  return buffer.toString('hex');
}

/**
 * hex文字列をbase64文字列に変換する
 * @param hex hex文字列
 * @returns base64文字列
 */
export function hexToBase64(hex: string): string {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const buffer = Buffer.from(cleanHex, 'hex');
  return buffer.toString('base64');
}

/**
 * 公開鍵が有効なEd25519公開鍵かどうか検証する
 * @param publicKey 公開鍵 (hex形式)
 * @returns 有効かどうか
 */
export function isValidPublicKey(publicKey: string): boolean {
  try {
    const bytes = hexToBytes(publicKey);
    // Ed25519公開鍵は32バイト
    return bytes.length === 32;
  } catch {
    return false;
  }
}

/**
 * 秘密鍵が有効なEd25519秘密鍵かどうか検証する
 * @param privateKey 秘密鍵 (hex形式)
 * @returns 有効かどうか
 */
export function isValidPrivateKey(privateKey: string): boolean {
  try {
    const bytes = hexToBytes(privateKey);
    // Ed25519秘密鍵は32バイト
    return bytes.length === 32;
  } catch {
    return false;
  }
}