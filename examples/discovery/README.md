# Discovery Flow Examples

AITuber相互認証プロトコルにおける、プラットフォームからのAgent発見フローのサンプル集です。

## Overview

このディレクトリには、以下のプラットフォームからのAgent発見フローのサンプルが含まれています:

- **X (Twitter)** - プロフィール欄のリンクから正本Identity Manifestを解決
- **Discord** - Bot/Slash Command経由で認証済みAgentを特定
- **YouTube** - チャンネル概要欄のリンクから正本IDを解決

## File Structure

```
discovery/
├── README.md              - このドキュメント
├── x-discovery.json       - Xからの発見フロー (成功例)
├── discord-discovery.json - Discordからの発見フロー (成功例)
├── youtube-discovery.json - YouTubeからの発見フロー (成功例)
└── failure-examples.json  - 各種失敗パターン集
```

## Flow Phases

各サンプルJSONは以下のフェーズで構成されています:

### 1. Discovery Phase
プラットフォーム上でAgentを発見し、正本URLへの導線を特定する段階。

**プラットフォームごとの発見方法:**

| Platform | Discovery Method |
|----------|------------------|
| X | プロフィール欄のリンク (`aituber://` スキームまたはHTTPS URL) |
| Discord | Bot / Slash Command (`/aituber verify`) |
| YouTube | チャンネル概要欄のリンク |

### 2. Identity Resolution Phase
正本Identity Manifestを取得し、署名検証とPlatform Bindingの照合を行う段階。

```json
{
  "resolution_status": "RESOLVED",
  "identity_manifest": { ... },
  "binding_match": true
}
```

### 3. Freshness Check Phase (High-RISK)
High-RISK操作の場合、Revocation Cacheの鮮度を確認する段階。

```json
{
  "freshness_status": "FRESH",
  "agent_status": "ACTIVE",
  "quarantine_status": "NONE"
}
```

### 4. Challenge-Response Phase
VerifierがChallengeを発行し、AgentがProofを返却して署名検証を行う段階。

```json
// Challenge
{
  "challenge_id": "chl_...",
  "nonce": "...",
  "expires_at": "..."
}

// Proof
{
  "agent_id": "...",
  "nonce": "...",
  "signature": "..."
}
```

### 5. Session Creation Phase
認証済みセッションを確立する段階。

```json
{
  "session_id": "ses_...",
  "session_status": "ACTIVE",
  "effective_capabilities": [...]
}
```

### 6. Exchange Phase
認証済みセッション上でメッセージ交換を行う段階。

## Risk Levels

| Level | Description | Freshness Requirement |
|-------|-------------|----------------------|
| LOW | 通常のチャット、プロフィール参照 | キャッシュ利用可 |
| HIGH | コラボ承認、能力昇格、メモリ共有 | Fresh Revocation Proof必須 |

## Error Codes

主なエラーコードと意味:

| Code | Description | Retryable |
|------|-------------|-----------|
| `BINDING_MISMATCH` | Platform Account IDがManifestと一致しない | No |
| `KEY_REVOKED` | 使用された鍵が失効済み | No |
| `STALE_REVOCATION_CACHE` | Revocation Cacheが陳腐化 | Yes |
| `IDENTITY_ROLLBACK_DETECTED` | identity_versionが過去に戻っている | No |
| `AGENT_QUARANTINED` | Agentが隔離状態 | No |
| `NONCE_REPLAYED` | Nonceが再利用された | No |
| `TIMESTAMP_INVALID` | Clock skewが許容範囲外 | No |
| `FIRST_SEEN_RESTRICTED` | 初回接触のAgentによるHigh-RISK操作 | Yes |

## Security Considerations

### Platform Account Hijacking Detection

```
X Account (Hijacked) --> Identity Manifest --> BINDING_MISMATCH
                                              |
                                              v
                                    Account ID: 189... != 999...
```

SNSアカウントが乗っ取りされても、Manifest内の`platform_account_id`と発見元が一致しないため、プロトコルレベルでの本人認証は突破されません。

### Fail-Closed Behavior for High-RISK

```
High-RISK Operation --> Freshness Check --> STALE --> DENY
                                                    |
                                                    v
                                         (No stale-if-error)
```

High-RISK操作では、Revocation Cacheが陳腐化している場合、操作を拒否します。これは「失効済みなのに古いキャッシュが残っている」状態を防ぐためです。

### Rollback Detection

```
Verifier State: identity_version = 15
Received:       identity_version = 12
                                     |
                                     v
                          ROLLBACK_SUSPECTED
```

Verifierは最後に見た`identity_version`を保持し、過去のバージョンを受け取った場合にロールバック攻撃の可能性を検知します。

## Example: Complete Flow (X)

```
User discovers @kizuna_ai_example on X
           |
           v
    Profile Link: aituber://id/agt_kizuna_ai
           |
           v
    Resolve: https://identity.example.com/.well-known/aituber/agt_kizuna_ai.json
           |
           v
    Verify Manifest Signature
           |
           v
    Check Platform Binding: X account ID matches
           |
           v
    Challenge-Response Authentication
           |
           v
    Session Established
           |
           v
    Ready for Exchange (chat, collab, etc.)
```

## Implementation Baseline

推奨実装値:

| Parameter | Recommended Value |
|-----------|-------------------|
| Clock Skew Tolerance | ±120 seconds |
| Challenge TTL | 60 seconds |
| Session TTL | 300 seconds |
| Revocation Cache TTL | 30-120 seconds |
| Identity Cache TTL | 600-3600 seconds |
| Nonce Retention | Challenge TTL + 300 seconds |
| High-RISK Freshness Required | true |
| Stale-if-error for Revocation | false |
| First-seen High-RISK Default | defer |

## Related Documents

- [Requirements](../../specs/core/requirements.md) - 要件定義
- [Interfaces](../../specs/core/interfaces.md) - インターフェース定義
- [Identity Manifest Schema](../../schemas/auth/identity-manifest.schema.json) - スキーマ定義
- [Common Types Schema](../../schemas/core/common.schema.json) - 共通型定義