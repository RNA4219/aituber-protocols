# aituber-protocols 実装計画

## 1. 現状検収

### 1.1 完了しているもの

#### 仕様書 (specs/)
- `core/requirements.md` - 詳細な要件定義 (1121行)
- `core/scope.md` - スコープ定義 (628行)
- `core/interfaces.md` - インターフェース定義 (1259行)
- `core/threat-model.md` - 脅威モデル (754行)
- `auth/state-machine.md` - 状態遷移仕様 (681行)
- `auth/cache-and-freshness.md` - キャッシュと鮮度判定 (603行)
- `ledger/events.md` - 台帳イベント定義 (590行)

#### JSON Schema (schemas/)
- `core/common.schema.json` - 共通型定義
- `auth/identity-manifest.schema.json` - Identity Manifest
- `auth/challenge.schema.json` - Challenge
- `auth/proof.schema.json` - Proof
- `auth/session.schema.json` - Session
- `auth/revocation-status.schema.json` - Revocation Status
- `ledger/event-envelope.schema.json` - Event Envelope
- `ledger/key-revoked.schema.json` - Key Revoked Event
- `ledger/binding-updated.schema.json` - Binding Updated Event
- `ledger/compromise-reported.schema.json` - Compromise Reported Event
- `ledger/agent-quarantined.schema.json` - Agent Quarantined Event
- `ledger/recovery-initiated.schema.json` - Recovery Initiated Event
- `ledger/recovery-completed.schema.json` - Recovery Completed Event

### 1.2 未実装

- `README.md` - プロジェクト入口
- `examples/` - サンプルフロー
  - discovery/ - X/Discord/YouTubeからの発見フロー
  - handshake/ - 認証ハンドシェイク
  - revoke/ - 鍵失効フロー
  - recover/ - 回復フロー
- `test-vectors/` - テストベクター
  - auth/ - 認証テスト
  - replay/ - リプレイ攻撃テスト
  - rollback/ - ロールバック検知テスト
  - quarantine/ - 隔離テスト
- `reference-impl/` - 参照実装
  - server/ - サーバー実装
  - client/ - クライアント実装
  - watcher/ - Watcher実装

## 2. 実装方針

### 2.1 AgentsFlow MCP の活用
- CLAUDE.mdに従い、複数段階の実装フローではAgentsFlowを優先
- サブエージェントを多数呼び出し、並列実行を活用

### 2.2 shipyard-cp の活用
- Task管理、Run、Pipelineコマンドで進捗管理
- 複数Workerのオーケストレーション

### 2.3 Agent_tools の活用
- workflow-cookbook: ワークフロー規約
- agent-taskstate: タスク状態管理
- memx-resolver: メモリ・ドキュメント解決

## 3. 実装フェーズ

### Phase 1: 基盤整備
1. README.md作成
2. ディレクトリ構造の整備
3. CLAUDE.md / BLUEPRINT.md / RUNBOOK.md作成

### Phase 2: サンプル・テストベクター
1. examples/ の作成
   - discovery: X/Discord/YouTubeからの発見フロー
   - handshake: challenge-response認証フロー
   - revoke: 鍵失効とsession停止
   - recover: compromise → quarantine → recovery

2. test-vectors/ の作成
   - auth: 正常系・異常系の認証テスト
   - replay: nonce再利用拒否テスト
   - rollback: identity_version後退検知テスト
   - quarantine: high-risk拒否テスト

### Phase 3: 参照実装
1. reference-impl/server/
   - Identity Manifest Host
   - Challenge Issuance
   - Proof Verification
   - Session Management
   - Revocation Status
   - Ledger Append/Read

2. reference-impl/client/
   - Identity Resolution
   - Proof Generation
   - Session Handling
   - Exchange Messaging

3. reference-impl/watcher/
   - Event Monitoring
   - Split-view Detection
   - Alert Notification

## 4. 技術スタック

- Language: TypeScript (Node.js 20+)
- Schema Validation: ajv / json-schema
- Crypto: @noble/ed25519 or similar
- Testing: vitest
- HTTP: Hono or Express
- Storage: Redis (optional, for session/cache)

## 5. 成功条件

1. JSON Schema validation が全てのサンプルで通る
2. test-vectors が全て成功する
3. reference-impl が基本的な認証フローを完遂できる
4. 5秒以内の認証が達成できる

## 6. 次のアクション

1. AgentsFlow MCP の確認
2. README.mdの作成
3. ディレクトリ構造の整備
4. Phase 1の完了後、Phase 2以降をサブエージェントに委譲