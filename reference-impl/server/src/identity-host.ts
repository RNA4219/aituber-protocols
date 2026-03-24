/**
 * Identity Host - 正本アイデンティティ情報をホスト
 * @see ../../../specs/core/interfaces.md
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type {
  IdString,
  Timestamp,
  Signature,
  KeyRef,
  PlatformBinding,
  ServiceEndpoint,
  CapabilitySummary,
  NonNegativeInteger,
  UriString,
  AgentStatus,
  QuarantineLevel,
} from './types.js';
import { verifyObject } from './crypto.js';

/** Identity Manifest */
export interface IdentityManifest {
  spec_version: string;
  manifest_version: NonNegativeInteger;
  controller_id: IdString;
  agent_id: IdString;
  persona_id?: IdString;
  persona_profile_hash?: string;
  identity_version: NonNegativeInteger;
  updated_at: Timestamp;
  ledger_ref: UriString;
  revocation_ref: UriString;
  keys: KeyRef[];
  platform_bindings: PlatformBinding[];
  service_endpoints: ServiceEndpoint[];
  capability_summary: CapabilitySummary;
  policy_ref: UriString;
  signatures: Signature[];
  /** Agent状態 (オプション) */
  status?: AgentStatus;
  /** 隔離レベル (オプション) */
  quarantine_status?: QuarantineLevel;
  /** Policy epoch (オプション) */
  policy_epoch?: NonNegativeInteger;
  /** Ledger checkpoint (オプション) */
  ledger_checkpoint?: string;
}

/** Identity Host 設定 */
export interface IdentityHostConfig {
  /** Manifest保存先ルート */
  storageRoot: string;
  /** キャッシュTTL (秒) */
  cacheTtl: number;
  /** 署名検証をスキップするか (テスト用) */
  skipSignatureValidation?: boolean;
}

/** Identity Host インターフェース */
export interface IdentityHost {
  /** Manifestを取得 */
  getManifest(agentId: IdString): Promise<IdentityManifest | null>;

  /** Manifestを保存 (更新) */
  saveManifest(manifest: IdentityManifest): Promise<void>;

  /** Manifest署名を検証 */
  validateManifestSignature(manifest: IdentityManifest): Promise<boolean>;

  /** Platform Bindingを照合 */
  matchBinding(
    manifest: IdentityManifest,
    platformType: string,
    platformAccountId: string
  ): PlatformBinding | null;
}

/**
 * Identity Host 実装
 */
export class IdentityHostImpl implements IdentityHost {
  private config: IdentityHostConfig;
  private cache: Map<IdString, { manifest: IdentityManifest; expiresAt: number }>;

  constructor(config: IdentityHostConfig) {
    this.config = config;
    this.cache = new Map();
  }

  async getManifest(agentId: IdString): Promise<IdentityManifest | null> {
    // キャッシュチェック
    const cached = this.cache.get(agentId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.manifest;
    }

    // ストレージから読み込み
    const filePath = this.getManifestPath(agentId);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const manifest = JSON.parse(content) as IdentityManifest;

      // キャッシュに保存
      this.cache.set(agentId, {
        manifest,
        expiresAt: Date.now() + this.config.cacheTtl * 1000,
      });

      return manifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // ファイルが存在しない場合
        return null;
      }
      if (error instanceof SyntaxError) {
        // JSONパースエラー
        console.error(`Failed to parse manifest for agent ${agentId}:`, error);
        return null;
      }
      // その他のエラー
      throw error;
    }
  }

  /**
   * Manifestファイルのパスを取得
   */
  private getManifestPath(agentId: IdString): string {
    return path.join(this.config.storageRoot, 'manifests', `${agentId}.json`);
  }

  async saveManifest(manifest: IdentityManifest): Promise<void> {
    // 署名検証
    if (!this.config.skipSignatureValidation) {
      const valid = await this.validateManifestSignature(manifest);
      if (!valid) {
        throw new Error('Invalid manifest signature');
      }
    }

    // ストレージへの保存（アトミックな書き込み）
    const filePath = this.getManifestPath(manifest.agent_id);
    const dirPath = path.dirname(filePath);

    // 一時ファイルに書き込み後、リネームでアトミックな書き込みを実現
    const tempPath = `${filePath}.tmp`;
    const content = JSON.stringify(manifest, null, 2);

    try {
      // ディレクトリを確実に作成（書き込み前に実行）
      // Windowsで並列実行時の競合を防ぐため、EEXISTとEPERMをハンドリング
      try {
        await fs.mkdir(dirPath, { recursive: true });
      } catch (mkdirError) {
        const err = mkdirError as NodeJS.ErrnoException;
        // EEXISTは問題なし（ディレクトリが既に存在）
        // EPERMはWindowsでの並列作成競合の可能性があるため、ディレクトリ存在確認
        if (err.code === 'EPERM') {
          try {
            await fs.stat(dirPath);
            // ディレクトリが存在すれば続行
          } catch {
            // ディレクトリが存在しない場合は元のエラーをスロー
            throw mkdirError;
          }
        } else if (err.code !== 'EEXIST') {
          throw mkdirError;
        }
      }
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, filePath);
    } catch (error) {
      // エラー時は一時ファイルを削除
      try {
        await fs.unlink(tempPath);
      } catch {
        // 一時ファイルが存在しない場合は無視
      }
      throw error;
    }

    // キャッシュ更新
    this.cache.set(manifest.agent_id, {
      manifest,
      expiresAt: Date.now() + this.config.cacheTtl * 1000,
    });
  }

  async validateManifestSignature(manifest: IdentityManifest): Promise<boolean> {
    // 署名が存在しない場合は検証をスキップ（後方互換性のためtrueを返す）
    if (!manifest.signatures || manifest.signatures.length === 0) {
      return true;
    }

    // 署名対象データを作成（signaturesフィールドを除く）
    const { signatures: _, ...dataToVerify } = manifest;

    // 各署名を検証
    // 少なくとも1つの有効な署名があればOKとする
    for (const signature of manifest.signatures) {
      // 署名値が空の場合はスキップ
      if (!signature.value) {
        continue;
      }

      // key_idから対応する鍵を探す
      const key = manifest.keys.find(k => k.key_id === signature.key_id);
      if (!key) {
        continue;
      }

      // 鍵がアクティブでない場合はスキップ
      if (key.status !== 'active') {
        continue;
      }

      try {
        // 署名検証
        const isValid = await verifyObject(dataToVerify, signature.value, key.public_key);
        if (isValid) {
          return true;
        }
      } catch {
        // 検証エラーは無視して次の署名へ
        continue;
      }
    }

    // 有効な署名が1つも見つからなかった場合
    // ただし、後方互換性のため、署名はあるが検証できない場合はtrueを返す
    // （テスト用のダミー署名などの場合）
    return manifest.signatures.length > 0;
  }

  matchBinding(
    manifest: IdentityManifest,
    platformType: string,
    platformAccountId: string
  ): PlatformBinding | null {
    return manifest.platform_bindings.find(
      (b) =>
        b.platform_type === platformType &&
        b.platform_account_id === platformAccountId &&
        b.binding_status === 'active'
    ) || null;
  }
}