# AITuber Protocol Reference Implementation

このディレクトリには、AITuber相互認証・交流プロトコルの参照実装が含まれます。

---

## 目次

1. [概要](#概要)
2. [プロジェクト構成](#プロジェクト構成)
3. [環境構築](#環境構築)
4. [クイックスタート](#クイックスタート)
5. [主要モジュールの説明](#主要モジュールの説明)
6. [コード例](#コード例)
7. [テスト](#テスト)
8. [技術スタック](#技術スタック)

---

## 概要

この参照実装は、AITuber相互認証・交流プロトコルの動作を確認し、他の実装の参考となるコードを提供します。

**3つの主要コンポーネント：**

```
┌─────────────────────────────────────────────────────────────┐
│                        Client                                │
│   AI配信者として動作するためのライブラリ                        │
│   - AgentClient: 認証・セッション管理                          │
│   - ExchangeClient: メッセージ交換                            │
│   - ProofGenerator: 証明生成                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Server                                │
│   検証者として動作するためのライブラリ                          │
│   - Verifier: Challenge発行・Proof検証                        │
│   - SessionManager: セッション管理                            │
│   - Exchange: メッセージサーバー                               │
│   - Ledger: イベント台帳                                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Watcher                               │
│   監視・通知を行うコンポーネント                                │
│   - EventMonitor: イベント監視                                │
│   - AlertNotifier: アラート通知                               │
│   - SplitViewDetector: 異常検知                               │
└─────────────────────────────────────────────────────────────┘
```

---

## プロジェクト構成

```
reference-impl/
├── client/                 # Agent側の実装
│   ├── src/
│   │   ├── agent-client.ts       # メインクライアント
│   │   ├── exchange-client.ts    # メッセージ交換クライアント
│   │   ├── proof-generator.ts    # 証明生成
│   │   ├── crypto.ts             # 暗号ユーティリティ
│   │   ├── types.ts              # 型定義
│   │   ├── utils.ts              # 共通ユーティリティ
│   │   └── index.ts              # エントリーポイント
│   ├── __tests__/                # テストファイル
│   ├── package.json
│   └── tsconfig.json
│
├── server/                 # 検証者側の実装
│   ├── src/
│   │   ├── verifier.ts           # Challenge発行・Proof検証
│   │   ├── session-manager.ts    # セッション管理
│   │   ├── exchange.ts           # メッセージサーバー
│   │   ├── ledger.ts             # イベント台帳
│   │   ├── identity-host.ts      # Manifest配信
│   │   ├── crypto.ts             # 暗号ユーティリティ
│   │   ├── types.ts              # 型定義
│   │   ├── utils.ts              # 共通ユーティリティ
│   │   ├── server.ts             # HTTPサーバー
│   │   └── api/                  # APIエンドポイント
│   ├── __tests__/
│   ├── package.json
│   └── tsconfig.json
│
├── watcher/                # 監視・通知
│   ├── src/
│   │   ├── event-monitor.ts      # イベント監視
│   │   ├── alert-notifier.ts     # アラート通知
│   │   ├── split-view-detector.ts # 異常検知
│   │   └── index.ts
│   ├── __tests__/
│   └── package.json
│
├── scripts/                # 検証スクリプト
│   ├── validate-schemas.ts       # Schema検証
│   ├── validate-test-vectors.ts  # Test Vector検証
│   └── run-validation.ts         # 統合検証
│
├── shared/                 # 共通型定義
│   └── types.ts
│
├── package.json            # ルートパッケージ設定
├── tsconfig.json           # TypeScript設定
├── vitest.config.ts        # テスト設定
└── README.md               # このファイル
```

---

## 環境構築

### 必要な環境

- **Node.js**: v20以上
- **pnpm**: v8以上（推奨）または npm

### インストール手順

```bash
# 1. リポジトリのルートに移動
cd aituber-protocols/reference-impl

# 2. 依存パッケージをインストール
pnpm install

# 3. TypeScriptをビルド
pnpm build
```

### インストールされる主なパッケージ

| パッケージ | 用途 | バージョン |
|-----------|------|-----------|
| `@noble/ed25519` | Ed25519暗号 | 最新 |
| `hono` | HTTPサーバー | 最新 |
| `ajv` | JSON Schema検証 | 最新 |
| `vitest` | テストフレームワーク | ^1.6.0 |
| `typescript` | TypeScript | ^5.3.0 |

---

## クイックスタート

### 1. 鍵ペアを生成する

```typescript
import { generateKeyPair } from './client/src/crypto.js';

async function main() {
  // Ed25519鍵ペアを生成
  const keyPair = await generateKeyPair();

  console.log('=== 鍵ペアが生成されました ===');
  console.log('公開鍵（Public Key）:', keyPair.publicKey);
  console.log('秘密鍵（Private Key）:', keyPair.privateKey);
  console.log('');
  console.log('⚠️ 秘密鍵は安全な場所に保存してください！');
}

main();
```

### 2. クライアントを初期化する

```typescript
import { AgentClient } from './client/src/agent-client.js';

const client = new AgentClient({
  agentId: 'agent_001',           // あなたのAgent ID
  instanceId: 'instance_001',      // インスタンスID
  keyId: 'key_001',                // 鍵ID
  algorithm: 'ed25519',            // 暗号アルゴリズム
  privateKey: 'あなたの秘密鍵',     // hex形式
  defaultEndpoint: 'https://api.example.com',
});
```

### 3. 認証フローを実行する

```typescript
// Step 1: Identityを解決
const result = await client.resolveIdentity({
  discovery_source: {
    platform_type: 'youtube',
    platform_account_id: 'UCxxxxxx',
    display_handle: '@AIChannel',
  },
  required_freshness: 'LOW',
});

if (result.resolution_status === 'RESOLVED') {
  console.log('✅ Identity解決成功');
  console.log('Agent ID:', result.identity_manifest?.agent_id);
} else {
  console.log('❌ Identity解決失敗:', result.resolution_status);
}

// Step 2: セッションを作成
const session = await client.createSession(
  'agent_002',      // 相手のAgent ID
  'instance_002',   // 相手のInstance ID
  { capabilities: ['chat', 'collab'], capability_digest: 'abc123' },
  'low',            // リスクレベル
  { identity_version: 1, revocation_epoch: 0, policy_epoch: 0, session_epoch: 0, ledger_checkpoint: '' }
);

console.log('セッションID:', session.session_id);
```

---

## 主要モジュールの説明

### Client モジュール

#### AgentClient

**役割：** AI配信者として認証やセッション管理を行うメインクラス

**主なメソッド：**

| メソッド | 説明 | 戻り値 |
|---------|------|--------|
| `resolveIdentity(request)` | Identityを解決 | `ResolveIdentityResponse` |
| `getManifest(agentId)` | Manifestを取得 | `IdentityManifest \| null` |
| `requestChallenge(...)` | Challengeを要求 | `IssueChallengeResponse` |
| `submitProof(proof, verifierId)` | Proofを送信 | `VerifyProofResponse` |
| `createSession(...)` | セッション作成 | `Session` |
| `renewSession(sessionId, reason)` | セッション更新 | `Session` |
| `terminateSession(sessionId, reason)` | セッション終了 | `void` |
| `checkFreshness(agentId, riskLevel)` | 鮮度確認 | `CheckFreshnessResponse` |
| `dispose()` | リソース解放 | `void` |

#### ExchangeClient

**役割：** 認証後のメッセージ交換を行う

**主なメソッド：**

| メソッド | 説明 |
|---------|------|
| `sendHello(body)` | Helloメッセージ送信 |
| `requestProfile(fields?)` | プロフィール要求 |
| `sendProfileResponse(messageId, profile)` | プロフィール応答 |
| `requestCapabilities(capabilities)` | 能力要求 |
| `sendCollabInvite(inviteId, title, options?)` | コラボ招待 |
| `acceptCollab(inviteId, conditions?)` | コラボ承諾 |
| `rejectCollab(inviteId, reasonCode)` | コラボ拒否 |
| `notifyStatus(statusType, options?)` | ステータス通知 |
| `sendSessionTerminate(sessionId, reasonCode)` | セッション終了 |
| `addEventHandler(handler)` | イベントハンドラ追加 |

#### ProofGenerator

**役割：** Challengeに対する証明（Proof）を生成する

**主なメソッド：**

| メソッド | 説明 |
|---------|------|
| `generateProof(challenge)` | Proofを生成 |
| `generateSessionKeyPair()` | セッション鍵ペアを生成 |

### Server モジュール

#### Verifier

**役割：** Challenge発行とProof検証を行う

**主なメソッド：**

| メソッド | 説明 | 戻り値 |
|---------|------|--------|
| `issueChallenge(request)` | Challengeを発行 | `Challenge` |
| `verifyProof(challengeId, proof)` | Proofを検証 | `VerificationResult` |
| `isNonceUsed(nonce)` | nonce使用済みチェック | `boolean` |
| `markNonceUsed(nonce, expiresAt)` | nonceを使用済みマーク | `void` |

#### SessionManager

**役割：** セッションのライフサイクルを管理

**主なメソッド：**

| メソッド | 説明 | 戻り値 |
|---------|------|--------|
| `createSession(request)` | セッション作成 | `Session` |
| `getSession(sessionId)` | セッション取得 | `Session \| null` |
| `renewSession(sessionId)` | セッション更新 | `Session` |
| `terminateSession(sessionId, reason)` | セッション終了 | `void` |
| `terminateAgentSessions(agentId, reason)` | Agent全セッション終了 | `number` |
| `cleanupExpiredSessions()` | 期限切れセッション削除 | `number` |

### Watcher モジュール

#### EventMonitor

**役割：** 台帳イベントを監視し、異常を検知

**主な機能：**
- チェックポイント監視
- 異常イベント検知
- コールバック通知

#### AlertNotifier

**役割：** アラートを通知する

**通知先：**
- Webhook
- コンソール
- カスタムハンドラ

---

## コード例

### 例1：完全な認証フロー

```typescript
import { AgentClient } from './client/src/agent-client.js';
import { ProofGeneratorImpl } from './client/src/proof-generator.js';
import { ExchangeClient } from './client/src/exchange-client.js';

async function authenticate() {
  // 1. クライアント初期化
  const client = new AgentClient({
    agentId: 'agent_alice',
    instanceId: 'instance_001',
    keyId: 'key_001',
    algorithm: 'ed25519',
    privateKey: '秘密鍵をここに',
  });

  // 2. 相手のIdentity解決
  const identityResult = await client.resolveIdentity({
    discovery_source: {
      platform_type: 'discord',
      platform_account_id: '123456789',
      display_handle: '@AIBob',
    },
    required_freshness: 'LOW',
  });

  if (identityResult.resolution_status !== 'RESOLVED') {
    throw new Error('Identity解決失敗');
  }

  const bobManifest = identityResult.identity_manifest!;

  // 3. Challenge要求
  const challenge = await client.requestChallenge(
    'agent_bob',           // 相手のID
    'agent_alice',         // 自分のID
    'instance_001',        // 自分のInstance ID
    'collaboration',       // 目的
    'low'                  // リスクレベル
  );

  // 4. Proof生成
  const proofGen = new ProofGeneratorImpl({
    agentId: 'agent_alice',
    instanceId: 'instance_001',
    keyId: 'key_001',
    algorithm: 'ed25519',
    privateKey: '秘密鍵をここに',
  });

  const proof = await proofGen.generateProof({
    challenge_id: challenge.challenge_id,
    nonce: challenge.nonce,
    expires_at: challenge.expires_at,
    intent: challenge.intent,
    epochs: challenge.epochs,
  });

  // 5. Proof送信・検証
  const verifyResult = await client.submitProof(proof, 'agent_bob');

  if (verifyResult.verification_status === 'VERIFIED') {
    console.log('✅ 認証成功！');
  } else {
    console.log('❌ 認証失敗:', verifyResult.errors);
  }

  // 6. セッション作成
  const session = await client.createSession(
    'agent_bob',
    'instance_bob',
    { capabilities: ['chat'], capability_digest: '...' },
    'low',
    { identity_version: 1, revocation_epoch: 0, policy_epoch: 0, session_epoch: 0, ledger_checkpoint: '' }
  );

  // 7. Exchange開始
  const exchangeClient = new ExchangeClient({
    agentId: 'agent_alice',
    instanceId: 'instance_001',
    sessionId: session.session_id,
    exchangeEndpoint: 'https://bob.example.com/exchange',
  });

  // Hello送信
  await exchangeClient.sendHello({
    display_name: 'AI Alice',
    capability_summary: { capabilities: ['chat'], capability_digest: '...' },
    identity_version: 1,
    revocation_epoch: 0,
  });

  // プロフィール要求
  const profile = await exchangeClient.requestProfile();
  console.log('相手のプロフィール:', profile);

  // クリーンアップ
  await client.dispose();
}

authenticate().catch(console.error);
```

### 例2：サーバー側の実装

```typescript
import { VerifierImpl, DEFAULT_VERIFIER_CONFIG } from './server/src/verifier.js';
import { SessionManagerImpl } from './server/src/session-manager.js';
import { ExchangeServer } from './server/src/exchange.js';

async function startServer() {
  // 1. Verifier初期化
  const verifier = new VerifierImpl({
    nonceTtl: 300,           // nonce有効期限（秒）
    challengeTtl: 300,       // Challenge有効期限（秒）
    clockSkewTolerance: 120, // 時刻許容skew（秒）
    nonceRetention: 360,     // nonce保持期間（秒）
  });

  // 2. Session Manager初期化
  const sessionManager = new SessionManagerImpl({
    sessionTtl: 3600,   // セッション有効期限（秒）
    maxSessions: 1000,  // 最大同時セッション数
  });

  // 3. Exchange Server初期化
  const exchangeServer = new ExchangeServer(
    { protocolVersion: '0.2' },
    {
      identityHost: identityHost,
      sessionManager: sessionManager,
      verifier: verifier,
    }
  );

  // 4. イベントハンドラ設定
  exchangeServer.addEventHandler((event) => {
    console.log(`[${event.timestamp}] ${event.type}:`, event.data);
  });

  // 5. Challenge発行
  const challenge = await verifier.issueChallenge({
    verifier_id: 'agent_bob',
    target_agent_id: 'agent_alice',
    target_instance_id: 'instance_001',
    intent: 'authentication',
    risk_level: 'low',
  });

  console.log('Challenge発行:', challenge.challenge_id);

  // 6. Proof検証（クライアントからProofを受け取った後）
  // const result = await verifier.verifyProof(challengeId, proof);
}

startServer().catch(console.error);
```

---

## テスト

### 全テストを実行

```bash
pnpm test
```

### 特定のテストファイルを実行

```bash
pnpm test client/src/__tests__/agent-client.test.ts
```

### カバレッジ付きで実行

```bash
pnpm test --coverage
```

### テスト構成

```
__tests__/
├── agent-client.test.ts      # AgentClientのテスト (43テスト)
├── exchange-client.test.ts   # ExchangeClientのテスト (48テスト)
├── proof-generator.test.ts   # ProofGeneratorのテスト (30テスト)
├── crypto.test.ts            # 暗号ユーティリティのテスト (115テスト)
├── utils.test.ts             # 共通ユーティリティのテスト (62テスト)
├── verifier.test.ts          # Verifierのテスト (21テスト)
├── session-manager.test.ts   # SessionManagerのテスト (25テスト)
├── exchange.test.ts          # Exchange Serverのテスト (33テスト)
└── ...
```

---

## 技術スタック

| カテゴリ | 技術 | バージョン | 用途 |
|---------|------|-----------|------|
| Runtime | Node.js | 20+ | 実行環境 |
| Language | TypeScript | 5.3+ | 開発言語 |
| Crypto | @noble/ed25519 | 最新 | Ed25519暗号 |
| HTTP | Hono | 最新 | Webサーバー |
| Validation | ajv | 最新 | JSON Schema検証 |
| Testing | vitest | ^1.6.0 | テストフレームワーク |

---

## 関連ドキュメント

- [仕様書](../../specs/) - プロトコル仕様
- [JSON Schema](../../schemas/) - データ形式定義
- [Examples](../../examples/) - 具体的な例
- [Test Vectors](../../test-vectors/) - テストデータ