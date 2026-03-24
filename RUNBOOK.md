# aituber-protocols RUNBOOK

## 概要

このドキュメントは、aituber-protocols プロジェクトの開発・運用に関する現在値と手順をまとめたものです。

## 現在の状態

### 完了

| カテゴリ | 項目 | 状態 |
|---------|------|------|
| 仕様書 | requirements.md | ✅ 完了 (v0.2-draft + 追補要件 + 実装要件) |
| 仕様書 | scope.md | ✅ 完了 |
| 仕様書 | interfaces.md | ✅ 完了 |
| 仕様書 | threat-model.md | ✅ 完了 |
| 仕様書 | state-machine.md | ✅ 完了 |
| 仕様書 | cache-and-freshness.md | ✅ 完了 |
| 仕様書 | events.md | ✅ 完了 |
| JSON Schema | core/common.schema.json | ✅ 完了 |
| JSON Schema | auth/*.schema.json | ✅ 完了 (5ファイル) |
| JSON Schema | ledger/*.schema.json | ✅ 完了 (7ファイル) |
| Examples | discovery/ | ✅ 完了 (X/Discord/YouTube) |
| Examples | handshake/ | ✅ 完了 (Low/High-Risk) |
| Examples | revoke/ | ✅ 完了 |
| Examples | recover/ | ✅ 完了 |
| Test Vectors | auth/ | ✅ 完了 |
| Test Vectors | replay/ | ✅ 完了 |
| Test Vectors | rollback/ | ✅ 完了 |
| Test Vectors | quarantine/ | ✅ 完了 |
| Reference Impl | server/ | ✅ 完了 (型定義、実装、テスト、HTTP API) |
| Reference Impl | client/ | ✅ 完了 (Agent Client, Proof Generator, Exchange Client) |
| Reference Impl | watcher/ | ✅ 完了 (Event Monitor, Split-view Detector, Alert Notifier) |

### 実装詳細

#### Server (`reference-impl/server/`)

| モジュール | ファイル | 機能 |
|-----------|---------|------|
| Types | `types.ts` | 共通型定義 |
| Identity Host | `identity-host.ts` | Manifest 保存・取得・更新 |
| Verifier | `verifier.ts` | Challenge 発行、Proof 検証、nonce 管理 |
| Session Manager | `session-manager.ts` | セッション作成・終了・無効化 |
| Ledger | `ledger.ts` | append-only イベントログ |
| Crypto | `crypto.ts` | Ed25519 署名、JCS 正準化、SHA-256 ハッシュ |
| HTTP Server | `server.ts` | Hono ベース HTTP サーバー |

#### Client (`reference-impl/client/`)

| モジュール | ファイル | 機能 |
|-----------|---------|------|
| Types | `types.ts` | クライアント用型定義 |
| Crypto | `crypto.ts` | 暗号ユーティリティ |
| Proof Generator | `proof-generator.ts` | Challenge 応答生成 |
| Agent Client | `agent-client.ts` | 認証フロー実行 |
| Exchange Client | `exchange-client.ts` | メッセージ送受信 |

#### Watcher (`reference-impl/watcher/`)

| モジュール | ファイル | 機能 |
|-----------|---------|------|
| Types | `types.ts` | Watcher 用型定義 |
| Event Monitor | `event-monitor.ts` | Ledger イベント監視 |
| Split-view Detector | `split-view-detector.ts` | チェックポイント矛盾検知 |
| Alert Notifier | `alert-notifier.ts` | 外部システム通知 |

## 開発環境セットアップ

### 前提条件

- Node.js 20+
- pnpm 8+

### セットアップ手順

```bash
cd aituber-protocols/reference-impl
pnpm install
pnpm build
pnpm test
```

## アーキテクチャ

```
aituber-protocols/
├── specs/                 # 仕様書 (完成)
│   ├── core/             # 共通・要件
│   ├── auth/             # 認証関連
│   └── ledger/           # 台帳
├── schemas/              # JSON Schema (完成)
│   ├── core/
│   ├── auth/
│   └── ledger/
├── examples/             # サンプルフロー (完成)
│   ├── discovery/
│   ├── handshake/
│   ├── revoke/
│   └── recover/
├── test-vectors/         # テストベクター (完成)
│   ├── auth/
│   ├── replay/
│   ├── rollback/
│   └── quarantine/
└── reference-impl/       # 参照実装 (完成)
    ├── server/           # Identity Host, Verifier, Session, Ledger, HTTP API
    ├── client/           # Agent Client, Proof Generator, Exchange Client
    └── watcher/          # Event Monitor, Split-view Detector, Alert Notifier
```

## HTTP API エンドポイント一覧

### Identity API

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/v1/agents/:agentId/manifest` | Identity Manifest 取得 |
| PUT | `/v1/agents/:agentId/manifest` | Identity Manifest 更新 |

### Revocation API

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/v1/agents/:agentId/revocation` | Revocation Status 取得 |

### Auth API

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/v1/challenges` | Challenge 発行 |
| POST | `/v1/proofs/verify` | Proof 検証 |
| POST | `/v1/sessions` | Session 作成 |
| DELETE | `/v1/sessions/:sessionId` | Session 終了 |

### Ledger API

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/v1/ledger/events` | イベント記録 |
| GET | `/v1/ledger/events` | イベント一覧取得 |
| GET | `/v1/ledger/checkpoint` | チェックポイント取得 |

### System

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/health` | ヘルスチェック |
| GET | `/` | API 情報 |

## テスト実行

### 全テスト実行

```bash
# プロジェクトルートから
cd reference-impl
pnpm test

# Server テストのみ
cd reference-impl/server
pnpm test

# Client テストのみ
cd reference-impl/client
pnpm test

# Watcher テストのみ
cd reference-impl/watcher
pnpm test
```

### 特定テスト実行

```bash
# 特定のテストファイル
pnpm test -- verifier.test.ts

# パターンマッチ
pnpm test -- --grep "challenge"
```

### カバレッジ

```bash
pnpm test:coverage
```

### テストファイル一覧

| カテゴリ | テストファイル | 対象 |
|---------|--------------|------|
| Server | `crypto.test.ts` | 暗号ユーティリティ |
| Server | `identity-host.test.ts` | Identity Host |
| Server | `verifier.test.ts` | Verifier |
| Server | `session-manager.test.ts` | Session Manager |
| Server | `ledger.test.ts` | Ledger |
| Server | `api.test.ts` | HTTP API |
| Client | `crypto.test.ts` | 暗号ユーティリティ |
| Client | `proof-generator.test.ts` | Proof Generator |
| Client | `agent-client.test.ts` | Agent Client |
| Client | `exchange-client.test.ts` | Exchange Client |
| Watcher | `event-monitor.test.ts` | Event Monitor |
| Watcher | `split-view-detector.test.ts` | Split-view Detector |
| Watcher | `alert-notifier.test.ts` | Alert Notifier |

## サーバー起動

```bash
cd reference-impl/server
pnpm start

# 環境変数で設定変更
PORT=3001 HOST=127.0.0.1 pnpm start

# 開発モード (ホットリロード)
pnpm dev
```

### 設定可能な環境変数

| 変数 | デフォルト | 説明 |
|-----|-----------|------|
| `PORT` | 3000 | サーバーポート |
| `HOST` | 0.0.0.0 | バインドアドレス |
| `STORAGE_ROOT` | ./data/identity | Identity データ保存先 |
| `IDENTITY_CACHE_TTL` | 600 | Identity Cache TTL (秒) |
| `NONCE_TTL` | 300 | nonce 有効期限 (秒) |
| `CHALLENGE_TTL` | 60 | Challenge 有効期限 (秒) |
| `SESSION_TTL` | 300 | Session TTL (秒) |
| `LEDGER_STORAGE_ROOT` | ./data/ledger | Ledger データ保存先 |

## JSON Schema 検証

```bash
# ajv-cli で検証
npx ajv validate -s schemas/auth/challenge.schema.json -d examples/handshake/low-risk-flow.json
```

## デバッグ

### ログレベル

```bash
DEBUG=aituber:* pnpm dev
```

### 主なエラーコード

| コード | 意味 |
|--------|------|
| `INVALID_SIGNATURE` | 署名検証失敗 |
| `NONCE_EXPIRED` | nonce 期限切れ |
| `NONCE_REPLAYED` | nonce 再利用 |
| `TIMESTAMP_INVALID` | タイムスタンプ異常 |
| `KEY_REVOKED` | 鍵失効済み |
| `AGENT_QUARANTINED` | Agent 隔離中 |
| `IDENTITY_ROLLBACK_DETECTED` | ロールバック検知 |
| `SESSION_EPOCH_OLD` | Session epoch 古い |

## 暗号機能

### サポートアルゴリズム

| 種別 | アルゴリズム | 用途 |
|-----|------------|------|
| 署名 | Ed25519 | メッセージ・オブジェクト署名 |
| ハッシュ | SHA-256 | データハッシュ計算 |
| 正準化 | JCS (RFC 8785) | JSON 正準化 |

### 主な関数

```typescript
// 鍵ペア生成
const keyPair = await generateKeyPair();

// 署名
const signature = await sign(message, privateKey);

// 検証
const valid = await verify(message, signature, publicKey);

// オブジェクトハッシュ
const hash = hashObject(obj);

// JCS 正準化
const canonical = canonicalize(obj);
```

## 今後のマイルストーン

1. **Phase 1: 拡張テスト**
   - E2E テスト追加
   - パフォーマンステスト
   - セキュリティ監査

2. **Phase 2: ドキュメント整備**
   - API ドキュメント (OpenAPI)
   - デプロイガイド
   - 統合ガイド

3. **Phase 3: エコシステム**
   - MCP/Skill Bridge 実装
   - Transport Profile 実装
   - CLI ツール

## 関連リンク

- [要件定義](./specs/core/requirements.md)
- [インターフェース](./specs/core/interfaces.md)
- [脅威モデル](./specs/core/threat-model.md)
- [実装計画](./PLAN.md)