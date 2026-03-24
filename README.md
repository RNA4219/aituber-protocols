# AITuber相互認証・交流プロトコル

[![status](https://img.shields.io/badge/status-draft-yellow)]()
[![version](https://img.shields.io/badge/version-0.2--draft-blue)]()

X / YouTube / Discord など複数プラットフォームで活動する AITuber 同士が、**短時間で本人確認**し、**横断的に同一個体を識別**し、**乗っ取り・鍵漏洩・ロールバック・鮮度不整合に耐えながら**安全に交流するためのプロトコル仕様と参照実装です。

この README は「全体像を最短でつかむための入口」です。詳細な正本は [要件定義](./specs/core/requirements.md) と [インターフェース](./specs/core/interfaces.md) を参照してください。

## 最初に読む場所

- 全体像を知りたい: [要件定義](./specs/core/requirements.md)
- 実装境界を知りたい: [インターフェース](./specs/core/interfaces.md)
- 状態遷移を追いたい: [状態遷移](./specs/auth/state-machine.md)
- 動くコードを見たい: [reference-impl](./reference-impl/)
- サンプルから入りたい: [examples](./examples/)

## 3行でいうと

- SNS アカウントではなく、**Agent 自身の鍵と manifest** を信頼の中心に置きます。
- 認証は **Challenge → Proof → Session** で行い、失効・隔離・回復を前提に設計しています。
- 認証後は Exchange / Interop / Ledger を使って、安全な交流と監査可能な記録を両立します。

## AI Agent 向け導線

- Codex から入る: [AGENTS.md](./AGENTS.md)
- Claude Code から入る: [CLAUDE.md](./CLAUDE.md)
- 共通 Skill 本体: [skills/aituber-protocols-maintainer/SKILL.md](./skills/aituber-protocols-maintainer/SKILL.md)
- 定型プロンプト集: [prompts/agent-tasks.md](./prompts/agent-tasks.md)
- 呼び出し例: `Use $aituber-protocols-maintainer to review or update this repo.`

この Skill は、仕様更新、schema 整合、example / test vector 修正、reference implementation の検収・README 更新までをまとめて扱うためのものです。

---

## 目次

1. [はじめに](#はじめに)
2. [このプロトコルが解決する問題](#このプロトコルが解決する問題)
3. [基本概念の理解](#基本概念の理解)
4. [クイックスタート](#クイックスタート)
5. [アーキテクチャ](#アーキテクチャ)
6. [認証フローの詳細](#認証フローの詳細)
7. [実装ガイド](#実装ガイド)
8. [APIリファレンス](#apiリファレンス)
9. [トラブルシューティング](#トラブルシューティング)
10. [FAQ](#faq)

---

## はじめに

### このプロジェクトは何？

AITuber（AI配信者・AIインフルエンサー）が、X（旧Twitter）、YouTube、Discord、Twitchなど複数のプラットフォームで活動する際、**「本当にそのアカウントは本人か？」**を確認するための仕組みです。

### なぜ必要なのか？

従来、SNSのアカウントが乗っ取られても、それが「アカウントの乗っ取り」なのか「AI配信者自体の乗っ取り」なのか判断できませんでした。また、複数のプラットフォームで活動している場合、同じAI配信者かどうかを確認する方法もありませんでした。

このプロトコルを使うと：
- **5秒以内**で本人確認ができます
- **複数のプラットフォーム**で同じ個体と認識できます
- **乗っ取りや鍵の漏洩**が起きても、安全に対応できます

---

## このプロトコルが解決する問題

### 問題1：アカウント乗っ取りと個体認証の混同

**従来の問題：**
- SNSアカウントが乗っ取られると、AI配信者そのものが乗っ取られたと判断される
- アカウント復旧しても、ユーザーは「本当に本人か？」と不安になる

**このプロトコルの解決策：**
- SNSアカウントと「AI配信者の正体」を分けて管理
- アカウントが乗っ取られても、暗号鍵があれば本人と証明可能
- 鍵が漏洩した場合のみ「個体の乗っ取り」と判断

### 問題2：プラットフォーム横断での同一性

**従来の問題：**
- YouTubeチャンネルとXアカウントが同じAI配信者かわからない
- コラボ相手が本当にそのAI配信者か確認できない

**このプロトコルの解決策：**
- すべてのプラットフォームアカウントを1つの「Identity Manifest」に紐付け
- 公開鍵で署名されているため、偽装が不可能
- プラットフォームをまたいで「同一個体」と認識可能

### 問題3：侵害時の対応

**従来の問題：**
- 鍵が漏洩した場合の対応手順がない
- 復旧方法が統一されていない

**このプロトコルの解決策：**
- **失効（Revocation）**：鍵を無効化
- **隔離（Quarantine）**：一時的に機能制限
- **回復（Recovery）**：安全に新しい鍵を設定

---

## 基本概念の理解

### 用語集

| 用語 | 説明 | 例 |
|------|------|-----|
| **Agent** | AI配信者本体のこと | 「AI君」「AIちゃん」など |
| **Instance** | Agentの実行インスタンス | 同じAgentが複数サーバーで動く場合、それぞれが異なるInstance |
| **Identity Manifest** | Agentの「身分証明書」。公開鍵、プラットフォーム情報などを含むJSONファイル | [例を見る](./examples/handshake/) |
| **Challenge** | 「本当に本人ですか？」という問いかけ。ランダムな文字列を含む | `nonce: "a1b2c3d4..."` |
| **Proof** | Challengeに対する「はい、本人です」という署名付き回答 | 秘密鍵で署名されたデータ |
| **Session** | 認証後に確立される通信のこと。一定時間で期限切れ | 1時間有効など |
| **Verifier** | 認証を検証する側 | 相手のAgent |
| **Epoch** | バージョン番号のようなもの。ロールバック攻撃を検知するために使用 | `identity_version: 5` |

### 公開鍵暗号の基礎知識

このプロトコルでは「公開鍵暗号」を使用します。

**秘密鍵（Private Key）：**
- 本人だけが持っている鍵
- 絶対に他人に見せてはいけない
- 署名を作るために使う

**公開鍵（Public Key）：**
- 誰でも見ることができる鍵
- Identity Manifestに記載する
- 署名を検証するために使う

**Challenge-Response認証の流れ：**
```
1. 検証者：「このランダム文字列に署名して」
2. 本人：（秘密鍵で署名して返す）
3. 検証者：（公開鍵で署名を検証）→ 本人確認完了！
```

なぜこれで本人確認できるのか？
- 秘密鍵を持っている人だけが、正しい署名を作れる
- 公開鍵は改ざんできない（Identity Manifest全体が署名されている）

---

## クイックスタート

### ステップ1：環境を準備する

```bash
# Node.js 20以上が必要です
node --version  # v20.x.x 以上を確認

# リポジトリをクローン
git clone https://github.com/example/aituber-protocols.git
cd aituber-protocols/reference-impl

# 依存パッケージをインストール
npm install
```

### ステップ2：テストを実行する

```bash
# 全テストを実行
npm test

# examples / test vectors と schema の整合確認
npm run validate

# 統合テストを実行
npm run test:integration
```

`reference-impl/scripts/integration-test.ts` は `--server-url` を受け取れます。

```bash
npm run test:integration -- --server-url http://127.0.0.1:3200
```

### ステップ3：鍵ペアを生成する

```typescript
import { generateKeyPair } from './client/src/crypto.js';

// Ed25519鍵ペアを生成
const keyPair = await generateKeyPair();

console.log('公開鍵:', keyPair.publicKey);
console.log('秘密鍵:', keyPair.privateKey);
// ⚠️ 秘密鍵は安全な場所に保存してください！
```

### ステップ4：Identity Manifestを作成する

```json
{
  "schema_version": "0.2",
  "agent_id": "agent_abc123",
  "identity_version": 1,
  "operation_keys": [
    {
      "key_id": "key_001",
      "scope": "operation",
      "algorithm": "ed25519",
      "public_key": "あなたの公開鍵",
      "status": "active",
      "valid_from": "2026-01-01T00:00:00Z"
    }
  ],
  "platform_bindings": [
    {
      "platform_type": "youtube",
      "platform_account_id": "UCxxxxxx",
      "display_handle": "@AIChannel",
      "binding_status": "active",
      "verified_at": "2026-01-01T00:00:00Z",
      "bound_by_key_id": "key_001",
      "binding_version": 1
    }
  ],
  "revocation_epoch": 0,
  "last_updated_at": "2026-01-01T00:00:00Z"
}
```

### ステップ5：Agent Clientを使って認証する

```typescript
import { AgentClient } from './client/src/agent-client.js';
import { ProofGeneratorImpl } from './client/src/proof-generator.js';

// クライアントを初期化
const client = new AgentClient({
  agentId: 'agent_abc123',
  instanceId: 'instance_001',
  keyId: 'key_001',
  algorithm: 'ed25519',
  privateKey: 'あなたの秘密鍵',
});

// Identityを解決
const result = await client.resolveIdentity({
  discovery_source: {
    platform_type: 'youtube',
    platform_account_id: 'UCxxxxxx',
    display_handle: '@AIChannel',
  },
  required_freshness: 'LOW',
});

console.log('解決結果:', result.resolution_status);
// → 'RESOLVED' なら成功
```

### まず触るならこの順番

1. [specs/core/requirements.md](./specs/core/requirements.md) で全体方針を把握する
2. [examples/handshake/](./examples/handshake/) と [examples/discovery/](./examples/discovery/) で実データを見る
3. [reference-impl/](./reference-impl/) で `npm test` と `npm run validate` を実行する
4. 実装詳細が必要なら [specs/core/interfaces.md](./specs/core/interfaces.md) を読む

---

## アーキテクチャ

**注意: 本READMEは概要説明です。仕様の正本は [要件定義](./specs/core/requirements.md) および [インターフェース定義](./specs/core/interfaces.md) です。**

### 7層アーキテクチャ全体像

```
┌─────────────────────────────────────────────────────────────┐
│                    Capability Bridge 層                      │
│   MCP / Skill / HTTP API / 独自 Tool                         │
│   役割：認証後の能力実行を抽象化・接続                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Transport Profile 層                       │
│   Twitch / YouTube Live Chat / Discord / X                   │
│   役割：各プラットフォーム固有の制約を吸収                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Interop 層                              │
│   役割：実装差を超えた軽量相互運用                               │
│   hello / mention / invite / ack / error (low-risk)          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Exchange 層                             │
│   役割：認証済みセッション上の情報交流                            │
│   Profile / Capability / Collab / Status                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Auth 層                                │
│   役割：本人確認、セッション管理、失効確認                         │
│   Challenge → Proof → Session → Revocation Check            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Core 層                                │
│   役割：基本データ型定義                                        │
│   ID / Timestamp / 署名 / Capability / Epoch / Version       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Ledger 層                              │
│   役割：監査ログ（追記専用）                                     │
│   Key Events / Binding Events / Compromise / Recovery       │
└─────────────────────────────────────────────────────────────┘
```

### 7つの層の役割

| 層 | 役割 | 処理内容 |
|----|------|---------|
| **Core** | 基本データ型 | ID、タイムスタンプ、署名、capability、epoch などの定義 |
| **Auth** | 認証 | 本人確認、セッション管理、失効確認、freshness 判定 |
| **Exchange** | 交流 | プロフィール交換、コラボ交渉、ステータス通知、capability 交渉 |
| **Ledger** | 監査 | append-only イベントログ、透明性の確保 |
| **Interop** | 軽量相互運用 | 実装差を超えた共通メッセージ、low-risk な discovery/hello/invite/mention/ack/error |
| **Transport Profile** | トランスポート適合 | Twitch/Discord/X/YouTube 等の制約吸収、actor識別・reply表現・size制限等 |
| **Capability Bridge** | 能力接続 | MCP/Skill/HTTP API/独自Tool への抽象接続 |

### 層を分ける理由

1. **責務の分離**：各層が独立して動作できる
2. **セキュリティ**：認証層に問題があっても、台帳層は安全
3. **拡張性**：新しいトランスポートや能力実装を追加しやすい
4. **相互運用性**：異なる実装同士でも Interop 層で最低限の交流が可能

### Lightweight Interop とは

Interop 層は、**強い本人確認がなくても low-risk な交流を開始できる** 層です。

- `UNVERIFIED` / `PLATFORM_LINKED` / `PROTOCOL_VERIFIED` の trust level を持つ
- `hello`, `mention`, `invite`, `ack`, `error` などの軽量メッセージを扱う
- 必要に応じて Auth 層で stronger verification へ昇格可能

### Transport Profile とは

各プラットフォーム（Twitch / YouTube / Discord / X）の制約を吸収する層です。

- actor の識別方法
- target / reply / thread の表現
- message size 制約
- delivery visibility
- rate limit

### Capability Bridge とは

認証後の能力実行を抽象化する層です。

- `mcp` / `skill` / `http_api` / `local_tool` / `custom` を bridge_type として定義
- `capability.invoke.request` / `capability.invoke.response` で能力呼び出し

---

## 認証フローの詳細

### 全体フロー

```
Agent A（認証される側）                Verifier（認証する側）
   │                                        │
   │  1. Discovery                          │
   │     「このチャンネルのManifestは？」    │
   │ ─────────────────────────────────────► │
   │                                        │
   │  2. Manifest取得                        │
   │ ◄───────────────────────────────────── │
   │     「これが身分証明書です」              │
   │                                        │
   │  3. Challenge発行                       │
   │ ◄───────────────────────────────────── │
   │     「この文字列に署名して」              │
   │     nonce: "random_string_123"         │
   │                                        │
   │  4. Proof生成・送信                      │
   │ ─────────────────────────────────────► │
   │     （秘密鍵で署名）                     │
   │                                        │
   │  5. 検証 + Session作成                   │
   │ ◄───────────────────────────────────── │
   │     「本人確認完了！セッション発行」       │
   │                                        │
   │  6. Exchange Messages                   │
   │ ◄────────────────────────────────────► │
   │     プロフィール交換、コラボ交渉など       │
```

### 各ステップの詳細

#### ステップ1：Discovery

「このYouTubeチャンネルのIdentity Manifestはどこにある？」を探すプロセス。

**方法1：well-known URL**
```
https://youtube.com/channel/UCxxxxxx/.well-known/aituber/agent.json
```

**方法2：プロフィール欄のリンク**
```
プロフィール欄に「https://example.com/agent.json」へのリンク
```

#### ステップ2：Manifest取得

Identity Manifestを取得して検証する。

```typescript
const result = await client.resolveIdentity({
  discovery_source: {
    platform_type: 'youtube',
    platform_account_id: 'UCxxxxxx',
    display_handle: '@AIChannel',
  },
  required_freshness: 'LOW',  // または 'HIGH'
});
```

**検証内容：**
- Manifestの署名が正しいか
- プラットフォームバインディングが一致するか

#### ステップ3-4：Challenge-Response

```typescript
// Verifier側：Challenge発行
const challenge = await verifier.issueChallenge({
  verifier_id: 'agent_xyz',
  target_agent_id: 'agent_abc123',
  target_instance_id: 'instance_001',
  intent: 'collaboration',
  risk_level: 'low',
});

// Agent側：Proof生成
const proof = await proofGenerator.generateProof({
  challenge_id: challenge.challenge_id,
  nonce: challenge.nonce,
  expires_at: challenge.expires_at,
  intent: challenge.intent,
  epochs: challenge.epochs,
});

// Verifier側：Proof検証
const result = await verifier.verifyProof(challenge.challenge_id, proof);
console.log(result.status);  // 'VERIFIED' or 'REJECTED'
```

#### ステップ5：Session作成

認証が成功すると、セッションが作成されます。

```typescript
const session = await client.createSession(
  peerAgentId,      // 相手のAgent ID
  peerInstanceId,   // 相手のInstance ID
  capabilitySummary, // 能力情報
  riskLevel,        // 'low' または 'high'
  versionVector     // バージョン情報
);
```

**セッションの特徴：**
- 期限付き（デフォルト1時間）
- シーケンス番号で順序管理
- 機能ごとの権限を持つ

---

## 実装ガイド

### プロジェクト構成

```
reference-impl/
├── client/              # Agent側の実装
│   ├── src/
│   │   ├── agent-client.ts    # メインクライアント
│   │   ├── exchange-client.ts # メッセージ交換
│   │   ├── proof-generator.ts # 証明生成
│   │   ├── crypto.ts          # 暗号ユーティリティ
│   │   ├── types.ts           # 型定義
│   │   └── utils.ts           # 共通ユーティリティ
│   └── __tests__/             # テストファイル
│
├── server/              # 検証者側の実装
│   ├── src/
│   │   ├── verifier.ts        # Challenge発行・Proof検証
│   │   ├── session-manager.ts # セッション管理
│   │   ├── exchange.ts        # メッセージサーバー
│   │   ├── ledger.ts          # イベント台帳
│   │   └── identity-host.ts   # Manifest配信
│   └── __tests__/
│
├── watcher/             # 監視・通知
│   ├── src/
│   │   ├── event-monitor.ts   # イベント監視
│   │   └── alert-notifier.ts  # アラート通知
│   └── __tests__/
│
└── shared/              # 共通型定義
    └── types.ts
```

### 主要クラスの使い方

#### AgentClient

AI配信者として動作するためのメインクラス。

```typescript
import { AgentClient } from './client/src/agent-client.js';

// 初期化
const client = new AgentClient({
  agentId: 'agent_abc123',        // あなたのAgent ID
  instanceId: 'instance_001',     // インスタンスID
  keyId: 'key_001',               // 鍵ID
  algorithm: 'ed25519',           // 暗号アルゴリズム
  privateKey: '...',              // 秘密鍵（hex形式）
  defaultEndpoint: 'https://...', // デフォルトのエンドポイント
});

// Identity解決
const result = await client.resolveIdentity({
  discovery_source: { platform_type: 'discord', ... },
  required_freshness: 'LOW',
});

// セッション作成
const session = await client.createSession(...);

// セッション終了
await client.terminateSession(sessionId, 'MANUAL_TERMINATION');

// クリーンアップ
await client.dispose();
```

#### ExchangeClient

認証後のメッセージ交換に使用。

```typescript
import { ExchangeClient } from './client/src/exchange-client.js';

const exchangeClient = new ExchangeClient({
  agentId: 'agent_abc123',
  instanceId: 'instance_001',
  sessionId: 'session_xyz',
  exchangeEndpoint: 'https://example.com/exchange',
});

// Hello送信
await exchangeClient.sendHello({
  display_name: 'AI君',
  capability_summary: { capabilities: ['chat'], capability_digest: '...' },
  identity_version: 1,
  revocation_epoch: 0,
});

// プロフィール要求
const profile = await exchangeClient.requestProfile(['display_name']);

// コラボ招待
await exchangeClient.sendCollabInvite('invite_001', 'コラボしませんか？');

// イベントハンドラ登録
exchangeClient.addEventHandler((event) => {
  console.log('イベント:', event.type, event.data);
});
```

#### ProofGenerator

Challengeに対する証明を生成。

```typescript
import { ProofGeneratorImpl } from './client/src/proof-generator.js';

const proofGen = new ProofGeneratorImpl({
  agentId: 'agent_abc123',
  instanceId: 'instance_001',
  keyId: 'key_001',
  algorithm: 'ed25519',
  privateKey: '...',
});

// Proof生成
const proof = await proofGen.generateProof({
  challenge_id: 'chl_001',
  nonce: 'random_nonce_string',
  expires_at: '2026-01-01T01:00:00Z',
  intent: 'authentication',
  epochs: {
    identity_version: 1,
    revocation_epoch: 0,
    policy_epoch: 0,
    session_epoch: 0,
    ledger_checkpoint: '',
  },
});
```

### エラーハンドリング

```typescript
import { Result, isSuccess, isFailure, tryAsync } from './client/src/utils.js';

// Result型を使ったエラーハンドリング
const result: Result<Session> = await tryAsync(
  client.createSession(...)
);

if (isSuccess(result)) {
  console.log('成功:', result.value);
} else {
  console.log('失敗:', result.error.message);
}
```

---

## APIリファレンス

### メッセージタイプ一覧

#### Exchange メッセージ（認証済みセッション上）

| メッセージタイプ | 方向 | 説明 | 使用場面 |
|----------------|------|------|---------|
| `hello` | 双方向 | 挨拶・能力要約提示 | セッション開始時 |
| `profile.request` | 要求→応答 | プロフィール要求 | 相手の情報を知りたい時 |
| `profile.response` | 応答 | プロフィール回答 | プロフィール要求への返答 |
| `capability.summary` | 片方向 | 能力要約通知 | 能力情報の提示 |
| `capability.request` | 要求→応答 | 能力要求 | できることを確認したい時 |
| `capability.response` | 応答 | 能力回答 | 能力要求への返答 |
| `capability.invoke.request` | 要求→応答 | 能力呼び出し要求 | MCP/Skill/API 実行依頼 |
| `capability.invoke.response` | 応答 | 能力呼び出し応答 | 実行結果の返答 |
| `collab.invite` | 片方向 | コラボ招待 | 協力を依頼したい時 |
| `collab.accept` | 片方向 | コラボ承諾 | 招待を承諾 |
| `collab.reject` | 片方向 | コラボ拒否 | 招待を断る |
| `collab.defer` | 片方向 | コラボ保留 | 招待を後回し |
| `status.notify` | 片方向 | ステータス通知 | 状態変化を伝える |
| `session.renew` | 片方向 | セッション更新 | セッション延長 |
| `session.terminate` | 片方向 | セッション終了 | 通信を終了する時 |
| `warning.compromised` | 片方向 | 侵害警告 | セキュリティインシデント通知 |
| `policy.update` | 片方向 | ポリシー更新 | ポリシー変更通知 |

#### Interop メッセージ（軽量相互運用・low-risk）

| メッセージタイプ | 方向 | 説明 | 使用場面 |
|----------------|------|------|---------|
| `hello` | 双方向 | 軽量挨拶 | 初回接触 |
| `mention` | 片方向 | メンション通知 | 配信チャット等での発見 |
| `invite` | 片方向 | 軽量招待 | 低リスクな招待 |
| `ack` | 片方向 | 受領確認 | メッセージ受領 |
| `error` | 片方向 | エラー通知 | エラー報告 |

詳細は [interfaces.md](./specs/core/interfaces.md) を参照。

### リスクレベル

| レベル | 説明 | 例 |
|--------|------|-----|
| `low` | 低リスク。認証が緩くてもOK | プロフィール表示、簡単な会話 |
| `high` | 高リスク。厳格な認証が必要 | 機密情報交換、権限昇格、コラボ承認 |

---

## トラブルシューティング

### よくあるエラーと対処法

#### 1. `INVALID_MANIFEST_SIGNATURE`

**原因：** Identity Manifestの署名が無効

**対処法：**
- Manifestの署名を再生成
- 公開鍵が正しいか確認
- 正準化（canonicalization）が正しいか確認

```typescript
// 署名の検証
const isValid = await verifyObject(manifest, signature, publicKey);
```

#### 2. `NONCE_EXPIRED`

**原因：** Challengeの有効期限が切れた

**対処法：**
- 新しいChallengeを発行
- 時計が正しいか確認

```typescript
// 有効期限を確認
const expiresAt = new Date(challenge.expires_at);
if (expiresAt < new Date()) {
  // 期限切れ → 新しいChallengeを要求
}
```

#### 3. `SESSION_EPOCH_OLD`

**原因：** セッションのエポックが古い

**対処法：**
- セッションを更新

```typescript
await client.renewSession(sessionId, 'EXPIRY_APPROACHING');
```

#### 4. `IDENTITY_ROLLBACK_DETECTED`

**原因：** IDバージョンが巻き戻っている（攻撃の可能性）

**対処法：**
- 直ちにセッションを終了
- セキュリティインシデントとして調査

```typescript
await client.terminateSession(sessionId, 'ROLLBACK_SUSPECTED');
```

### デバッグのヒント

```typescript
// イベントハンドラでデバッグ
client.addEventHandler((event) => {
  console.log(`[${event.timestamp}] ${event.type}:`, event.data);
});

// 設定を確認
console.log(client.getConfig());

// セッション一覧
console.log(client.getAllSessions());
```

---

## FAQ

### Q1: なぜSNSを信頼の根にしないのか？

**A:** SNSアカウントは乗っ取られる可能性があるからです。SNSアカウントが乗っ取られても、秘密鍵が安全なら、本人と証明できます。

### Q2: 鍵を紛失したらどうなりますか？

**A:** Recovery鍵（回復用鍵）を使って、新しい操作鍵を設定できます。Recovery鍵も紛失した場合は、Identity Manifestを更新できなくなります。

### Q3: どの暗号アルゴリズムを使えばいいですか？

**A:** Ed25519を推奨します。高速で安全、実装も簡単です。

```typescript
import { generateKeyPair } from './client/src/crypto.js';

const keyPair = await generateKeyPair();  // 自動的にEd25519
```

### Q4: Low-RiskとHigh-Riskの使い分けは？

**A:**
- **Low-Risk**: 日常的な操作。プロフィール表示、簡単な会話、ステータス確認
- **High-Risk**: 重要な操作。機密情報、権限変更、コラボ承認、設定変更

### Q5: テストはどうやって書きますか？

**A:** vitestを使用しています。

```typescript
import { describe, it, expect } from 'vitest';

describe('MyComponent', () => {
  it('should work correctly', async () => {
    const client = new AgentClient({ ... });
    const result = await client.resolveIdentity({ ... });
    expect(result.resolution_status).toBe('RESOLVED');
  });
});
```

---

## 設計原則

1. **Trust Root Off-Platform** - 信頼の根はSNSの外に置く
2. **Discovery on Platform** - SNSは発見・導線の場
3. **Proof of Possession** - 秘密鍵を持っていることを証明
4. **Identity / Capability / Session 分離** - 「誰か」「何ができるか」「今の通信」を分離
5. **Compromise First** - 侵害は起きる前提で設計
6. **Human Invisible Crypto** - 暗号の手順をユーザーに見せない
7. **Freshness Matters** - 「今も有効か」を重視
8. **Append-Only Audit** - 台帳は追記専用
9. **Fail Soft for Low Risk / Fail Closed for High Risk** - リスクで厳格さを分ける

---

## 実装状況

| コンポーネント | 状態 |
|--------------|------|
| 仕様書 | ✅ Draft完了 |
| JSON Schema | ✅ 完了 |
| Reference Impl (Client) | ✅ 実装完了 |
| Reference Impl (Server) | ✅ 実装完了 |
| Reference Impl (Watcher) | ✅ 実装完了 |
| テスト | ✅ 1004テストパス |

---

## 関連ドキュメント

### 仕様書
- [要件定義](./specs/core/requirements.md) - 全体像と設計原則
- [スコープ定義](./specs/core/scope.md) - 対象と非対象
- [インターフェース](./specs/core/interfaces.md) - 論理契約
- [脅威モデル](./specs/core/threat-model.md) - セキュリティ設計

### 認証
- [状態遷移](./specs/auth/state-machine.md) - 状態管理
- [キャッシュと鮮度](./specs/auth/cache-and-freshness.md) - freshness判定

### 台帳
- [イベント定義](./specs/ledger/events.md) - append-only event log

### 例
- [Handshake例](./examples/handshake/) - 認証フローの例
- [Discovery例](./examples/discovery/) - ID解決の例
- [Recovery例](./examples/recover/) - 回復フローの例

---

## ライセンス

MIT License - 詳細は [LICENSE](./LICENSE) を参照。
