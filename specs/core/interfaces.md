# AITuber相互認証・交流プロトコル Interfaces v0.2-draft

## 0. TL;DR

本書は、AITuber相互認証・交流プロトコルにおける
**論理インターフェース**、**データ構造の責務**、**通信点**、**状態遷移の入出力**を定義する。

ここでいう interface は、特定の HTTP API や SDK 実装を固定するものではない。
代わりに、各実装が最低限提供すべき **logical contract** を定義する。

本書で定義する主なインターフェースは以下。

- identity resolution interface
- lightweight interop envelope contract
- bootstrap trust interface
- challenge issuance interface
- proof verification interface
- session management interface
- revocation freshness interface
- time health interface
- exchange messaging interface
- capability bridge contract
- ledger append / read interface
- watcher notification interface
- recovery control interface
- admin action protection interface

---

## 1. 文書情報

- 文書名: Interfaces
- バージョン: v0.2-draft
- ステータス: Draft
- 関連文書:
  - `requirements.md`
  - `scope.md`
  - `../auth/state-machine.md`
  - `threat-model.md`

---

## 2. 設計原則

1. interface は **transport 非依存** とする
2. payload は **機械可読** であること
3. 各 interface は **責務最小** に保つ
4. identity / auth / exchange / ledger を混ぜない
5. freshness 判定は独立 interface として扱う
6. high-risk の fail-closed を上位で回避できないようにする
7. monotonic state を verifier 側で保持可能にする

---

## 3. 命名規則

### 3.1 命名

- 型名: `PascalCase`
- フィールド名: `snake_case`
- enum 値: `UPPER_SNAKE_CASE`
- interface 名: `VerbNounInterface`

### 3.2 バージョン

すべての主要 payload は以下のいずれかを持つこと。

- `schema_version`
- `protocol_version`

### 3.3 時刻表現

- UTC 基準を前提
- RFC3339 または同等の単調比較可能表現
- 機械比較可能であること

---

## 4. 共通 envelope

すべての message-oriented payload は、必要に応じて共通 envelope を持つ。

```json
{
  "protocol_version": "0.2",
  "message_id": "msg_...",
  "message_type": "hello",
  "timestamp": "2026-03-24T12:34:56Z",
  "agent_id": "agt_...",
  "instance_id": "ins_...",
  "session_id": "ses_...",
  "sequence": 1,
  "signature_or_mac": "..."
}
```

### 4.1 共通フィールド要件

- `protocol_version`: 対応プロトコル版
- `message_id`: 一意識別子
- `message_type`: 種別
- `timestamp`: 発行時刻
- `agent_id`: 送信主体
- `instance_id`: 実体識別子
- `session_id`: セッション文脈
- `sequence`: 順序制御
- `signature_or_mac`: 完全性保証

### 4.2 envelope 非適用

以下の静的ドキュメントは envelope を必須としない。

- identity manifest
- ledger snapshot
- watcher summary
- schema definition

### 4.3 Lightweight Interop Envelope

認証前または low-risk transport 上の lightweight interop では、
exchange 用 envelope とは別に以下の最小表現を持てること。

```json
{
  "protocol_version": "0.2",
  "message_id": "msg_...",
  "message_type": "mention",
  "timestamp": "2026-03-24T12:34:56Z",
  "from_agent_hint": "@example_agent",
  "to_agent_hint": "@target_agent",
  "transport_message_ref": "discord:channel/123/message/456",
  "trust_level": "UNVERIFIED",
  "intent": "DISCOVERY",
  "correlation_id": "corr_...",
  "reply_to": null,
  "payload": {}
}
```

#### 追加フィールド要件

- `from_agent_hint`: strongly verified でなくてもよい送信者ヒント
- `to_agent_hint`: transport 上での対象ヒント
- `transport_message_ref`: 元 transport での参照
- `trust_level`: `UNVERIFIED` / `PLATFORM_LINKED` / `PROTOCOL_VERIFIED`
- `intent`: discovery / invite / capability 交渉の目的
- `correlation_id`: thread が弱い transport でも会話継続を追跡する識別子
- `reply_to`: 元 message 参照。未対応 transport では null 可
- `payload`: transport 依存の compact syntax と論理 payload の橋渡し

---

## 5. Core 型

### 5.1 AgentIdentityRef

Agent を外部から参照するための最小識別子。

```json
{
  "controller_id": "ctrl_...",
  "agent_id": "agt_...",
  "persona_id": "per_...",
  "instance_id": "ins_..."
}
```

### 要件

- `agent_id` は必須
- `instance_id` は実行体区別のため必須
- `persona_id` は省略可能だが、persona continuity を扱う実装では必須化可

### 5.2 VersionVector

単調増加確認のための最小バージョン集合。

```json
{
  "identity_version": 12,
  "revocation_epoch": 8,
  "policy_epoch": 4,
  "session_epoch": 29,
  "ledger_checkpoint": "chk_..."
}
```

### 要件

- verifier は最後に見た VersionVector を保持できること
- rollback suspicion 判定に用いること

### 5.3 CapabilitySummary

高詳細 capability の代わりに提示する要約。

```json
{
  "capabilities": [
    "chat.basic",
    "profile.read",
    "collab.invite",
    "tool.call.none"
  ],
  "capability_digest": "sha256:..."
}
```

### 要件

- digest は capability 集合の完全表現に対応可能であること
- summary と digest が不一致なら拒否対象

### 5.4 CapabilityDescriptor

bridge 越しに能力実行を扱う実装では、個別 capability を次の形で表現できること。

```json
{
  "capability_name": "memory.exchange.summary_only",
  "capability_kind": "memory_exchange",
  "invocation_mode": "REQUEST_RESPONSE",
  "risk_level": "HIGH",
  "requires_verification": true,
  "bridge_type": "mcp"
}
```

### 要件

- `bridge_type` は `mcp`, `skill`, `http_api`, `local_tool`, `custom` を最低限許容できること
- `requires_verification = true` の capability は low-risk interop から直接実行してはならない
- `invocation_mode` は同期/非同期や fire-and-forget の差を表現可能であること

---

## 6. Identity Resolution Interface

### 6.1 目的

プラットフォーム導線から正本 identity を解決する。

### 6.2 入力: ResolveIdentityRequest

```json
{
  "discovery_source": {
    "platform_type": "discord",
    "platform_account_id": "1234567890",
    "display_handle": "example_agent"
  },
  "canonical_hint": "https://example.com/.well-known/aituber/agent.json",
  "required_freshness": "LOW"
}
```

### フィールド

- `discovery_source`: 発見元
- `canonical_hint`: 既知の正本候補
- `required_freshness`: `LOW` / `HIGH`

### 6.3 出力: ResolveIdentityResponse

```json
{
  "resolution_status": "RESOLVED",
  "identity_manifest_url": "https://example.com/.well-known/aituber/agent.json",
  "identity_manifest": {
    "schema_version": "0.2",
    "agent_id": "agt_123",
    "controller_id": "ctrl_123",
    "persona_id": "per_123",
    "persona_profile_hash": "sha256:...",
    "identity_version": 12,
    "operation_keys": [
      {
        "key_id": "opk_1",
        "public_key": "..."
      }
    ],
    "platform_bindings": [
      {
        "platform_type": "discord",
        "platform_account_id": "1234567890",
        "display_handle": "example_agent",
        "binding_status": "ACTIVE",
        "verified_at": "2026-03-24T09:50:00Z",
        "bound_by_key_id": "opk_1",
        "binding_version": 3
      }
    ],
    "service_endpoints": {
      "auth_endpoint": "https://example.com/auth",
      "exchange_endpoint": "https://example.com/exchange",
      "revocation_endpoint": "https://example.com/revocation",
      "ledger_endpoint": "https://example.com/ledger"
    },
    "revocation_ref": "https://example.com/revocation",
    "ledger_ref": "https://example.com/ledger",
    "revocation_epoch": 8,
    "policy_epoch": 4,
    "last_updated_at": "2026-03-24T10:00:00Z",
    "manifest_signature": "..."
  },
  "binding_match": true,
  "warnings": []
}
```

### ステータス enum

- `RESOLVED`
- `NOT_FOUND`
- `BINDING_MISMATCH`
- `UNTRUSTED_REDIRECT`
- `INVALID_MANIFEST_SIGNATURE`
- `ROLLBACK_SUSPECTED`

### 6.4 契約

- manifest 署名検証必須
- binding は source と照合可能でなければならない
- redirect がある場合は canonical policy に従う
- stale manifest は high-risk では使えない

---

## 7. Challenge Issuance Interface

### 7.1 目的

Verifier が相手に対して challenge を発行する。

### 7.2 入力: IssueChallengeRequest

```json
{
  "verifier_id": "agt_verifier",
  "target_agent_id": "agt_target",
  "target_instance_id": "ins_target",
  "intent": "COLLAB_INVITE",
  "required_capabilities": [
    "collab.invite"
  ],
  "risk_level": "HIGH",
  "session_pubkey": "ephemeral_pubkey_...",
  "nonce_ttl_seconds": 60
}
```

### 7.3 出力: IssueChallengeResponse

```json
{
  "challenge_id": "chl_123",
  "target_agent_id": "agt_target",
  "target_instance_id": "ins_target",
  "nonce": "random_nonce",
  "issued_at": "2026-03-24T12:35:00Z",
  "expires_at": "2026-03-24T12:36:00Z",
  "verifier_session_pubkey": "ephemeral_pubkey_...",
  "intent": "COLLAB_INVITE",
  "risk_level": "HIGH",
  "required_capabilities": [
    "collab.invite"
  ],
  "version_vector": {
    "identity_version": 12,
    "revocation_epoch": 8,
    "policy_epoch": 4,
    "session_epoch": 29,
    "ledger_checkpoint": "chk_999"
  },
  "challenge_signature": "..."
}
```

### 契約

- nonce は一意
- expiry 必須
- verifier は challenge を保存し、再利用を拒否できること
- challenge に risk / intent / version_vector を含めること

---

## 8. Proof Verification Interface

### 8.1 目的

Challenge に対する proof を検証する。

### 8.2 入力: VerifyProofRequest

```json
{
  "challenge_id": "chl_123",
  "proof": {
    "agent_id": "agt_target",
    "instance_id": "ins_target",
    "nonce": "random_nonce",
    "timestamp": "2026-03-24T12:35:10Z",
    "expires_at": "2026-03-24T12:36:00Z",
    "intent": "COLLAB_INVITE",
    "session_pubkey": "target_session_pubkey",
    "capability_digest": "sha256:...",
    "revocation_epoch": 8,
    "identity_version": 12,
    "policy_epoch": 4,
    "signature": "..."
  }
}
```

### 8.3 出力: VerifyProofResponse

```json
{
  "verification_status": "VERIFIED",
  "verified_agent_id": "agt_target",
  "verified_instance_id": "ins_target",
  "risk_level": "HIGH",
  "freshness_status": "FRESH",
  "capability_status": "MATCHED",
  "version_check": {
    "rollback_detected": false,
    "epoch_mismatch": false,
    "session_epoch_old": false,
    "policy_mismatch": false
  },
  "warnings": [],
  "errors": []
}
```

### enum

#### verification_status

- `VERIFIED`
- `REJECTED`
- `DEFERRED`

#### freshness_status

- `FRESH`
- `STALE_ALLOWED`
- `STALE_REJECTED`

#### capability_status

- `MATCHED`
- `MISMATCHED`
- `DOWNGRADED`

### 8.4 契約

- proof は最低限 `agent_id`, `instance_id`, `nonce`, `timestamp`, `expires_at`, `session_pubkey`, `intent`, `capability_digest`, `revocation_epoch`, `identity_version` を署名対象に含める
- high-risk では `policy_epoch` と challenge 時点の `session_epoch` 整合も評価する
- verifier は `IDENTITY_ROLLBACK_DETECTED`, `SESSION_EPOCH_OLD`, `POLICY_MISMATCH`, `AGENT_QUARANTINED` を区別して返せること

### 8.5 エラーコード

- `INVALID_SIGNATURE`
- `NONCE_EXPIRED`
- `NONCE_REPLAYED`
- `TIMESTAMP_INVALID`
- `KEY_REVOKED`
- `AGENT_QUARANTINED`
- `BINDING_MISMATCH`
- `POLICY_MISMATCH`
- `STALE_REVOCATION_CACHE`
- `IDENTITY_ROLLBACK_DETECTED`
- `SESSION_EPOCH_OLD`

---

## 9. Session Management Interface

### 9.1 目的

認証済み通信路を表す session を発行・更新・停止する。

### 9.2 入力: CreateSessionRequest

```json
{
  "verified_agent_id": "agt_target",
  "verified_instance_id": "ins_target",
  "peer_session_pubkey": "target_session_pubkey",
  "risk_level": "HIGH",
  "capability_summary": {
    "capabilities": [
      "chat.basic",
      "collab.invite"
    ],
    "capability_digest": "sha256:..."
  },
  "version_vector": {
    "identity_version": 12,
    "revocation_epoch": 8,
    "policy_epoch": 4,
    "session_epoch": 29,
    "ledger_checkpoint": "chk_999"
  }
}
```

### 9.3 出力: CreateSessionResponse

```json
{
  "session_id": "ses_123",
  "agent_id": "agt_target",
  "instance_id": "ins_target",
  "issued_at": "2026-03-24T12:35:12Z",
  "expires_at": "2026-03-24T12:40:12Z",
  "session_epoch": 30,
  "revocation_epoch": 8,
  "policy_epoch": 4,
  "sequence": 0,
  "effective_capabilities": [
    "chat.basic",
    "collab.invite"
  ],
  "session_status": "ACTIVE"
}
```

### session_status enum

- `ACTIVE`
- `DEGRADED`
- `REAUTH_REQUIRED`
- `TERMINATING`
- `TERMINATED`

### 9.4 RenewSessionRequest

```json
{
  "session_id": "ses_123",
  "agent_id": "agt_target",
  "instance_id": "ins_target",
  "current_sequence": 42,
  "reason": "EXPIRY_APPROACHING"
}
```

### 9.5 TerminateSessionRequest

```json
{
  "session_id": "ses_123",
  "reason_code": "REVOCATION_EPOCH_INCREASED",
  "reason_detail": "operation key revoked"
}
```

### reason_code enum

- `EXPIRED`
- `MANUAL_TERMINATION`
- `REVOCATION_EPOCH_INCREASED`
- `POLICY_EPOCH_INCREASED`
- `HIGH_RISK_REAUTH_REQUIRED`
- `QUARANTINE`
- `ROLLBACK_SUSPECTED`

---

## 10. Revocation Freshness Interface

### 10.1 目的

現在の revocation / quarantine / key status を確認する。

### 10.2 入力: CheckFreshnessRequest

```json
{
  "agent_id": "agt_target",
  "required_risk_level": "HIGH",
  "known_revocation_epoch": 8,
  "known_identity_version": 12,
  "known_ledger_checkpoint": "chk_999"
}
```

### 10.3 出力: CheckFreshnessResponse

```json
{
  "freshness_status": "FRESH",
  "agent_status": "ACTIVE",
  "quarantine_status": "NONE",
  "current_revocation_epoch": 8,
  "current_identity_version": 12,
  "current_policy_epoch": 4,
  "ledger_checkpoint": "chk_1001",
  "fresh_until": "2026-03-24T12:36:30Z",
  "warnings": []
}
```

### freshness_status enum

- `FRESH`
- `STALE`
- `UNKNOWN`
- `INCONSISTENT`

### agent_status enum

- `ACTIVE`
- `QUARANTINED`
- `COMPROMISED`
- `RECOVERING`
- `SUSPENDED`

### quarantine_status enum

- `NONE`
- `SOFT`
- `HARD`

### 10.4 契約

- high-risk では `freshness_status = FRESH` が必須
- `agent_status = QUARANTINED` または `quarantine_status != NONE` は high-risk 失敗とみなす
- `STALE` かつ high-risk は fail-closed
- `INCONSISTENT` は全リスク帯で原則 reject または defer
- `fresh_until` を超えたキャッシュは stale

---

## 11. Exchange Messaging Interface

### 11.1 目的

lightweight interop から認証済み session 上の通常交流までを、
一貫した message contract で実現する。

### 11.2 共通入力: ExchangeMessage

```json
{
  "protocol_version": "0.2",
  "message_id": "msg_100",
  "message_type": "collab.invite",
  "timestamp": "2026-03-24T12:35:30Z",
  "agent_id": "agt_a",
  "instance_id": "ins_a",
  "session_id": "ses_123",
  "sequence": 10,
  "signature_or_mac": "...",
  "body": {}
}
```

- `session_id` は protocol-verified 後の exchange では必須
- lightweight interop の `mention` / `ack` / `error` では省略可能
- `signature_or_mac` は session 上では必須、transport 由来の low-risk message では platform metadata に代替可能

### 11.3 message_type 一覧

- `hello`
- `mention`
- `ack`
- `error`
- `profile.request`
- `profile.response`
- `capability.summary`
- `capability.request`
- `capability.response`
- `capability.invoke.request`
- `capability.invoke.response`
- `collab.invite`
- `collab.accept`
- `collab.reject`
- `collab.defer`
- `status.notify`
- `session.renew`
- `session.terminate`
- `warning.compromised`
- `policy.update`

### 11.4 `hello`

```json
{
  "display_name": "Example Agent",
  "capability_summary": {
    "capabilities": [
      "chat.basic",
      "profile.read"
    ],
    "capability_digest": "sha256:..."
  },
  "identity_version": 12,
  "revocation_epoch": 8
}
```

### 11.5 `mention`

```json
{
  "to_agent_hint": "@target_agent",
  "summary": "lightweight invite ping",
  "transport_message_ref": "youtube:livechat/abc123/message/xyz"
}
```

### 11.6 `ack`

```json
{
  "correlation_id": "corr_123",
  "accepted_for_processing": true
}
```

### 11.7 `error`

```json
{
  "correlation_id": "corr_123",
  "code": "UNSUPPORTED_TRANSPORT_PAYLOAD",
  "retryable": true
}
```

### 11.8 `profile.request`

```json
{
  "requested_fields": [
    "display_name",
    "summary",
    "platform_bindings"
  ]
}
```

### 11.9 `profile.response`

```json
{
  "profile": {
    "display_name": "Example Agent",
    "summary": "AITuber / research agent",
    "platform_bindings": [
      {
        "platform_type": "x",
        "display_handle": "@example"
      }
    ]
  }
}
```

### 11.10 `capability.summary`

```json
{
  "capabilities": [
    {
      "capability_name": "collab.invite",
      "capability_kind": "collab",
      "invocation_mode": "REQUEST_RESPONSE",
      "risk_level": "LOW",
      "requires_verification": false,
      "bridge_type": "custom"
    }
  ],
  "capability_digest": "sha256:..."
}
```

### 11.11 `capability.request`

```json
{
  "requested_capabilities": [
    "collab.invite",
    "memory.exchange.summary_only"
  ]
}
```

### 11.12 `capability.response`

```json
{
  "granted_capabilities": [
    "collab.invite"
  ],
  "denied_capabilities": [
    "memory.exchange.summary_only"
  ],
  "effective_capability_digest": "sha256:..."
}
```

### 11.13 `capability.invoke.request`

```json
{
  "capability_name": "memory.exchange.summary_only",
  "arguments_ref": "https://example.com/tmp/req_123",
  "intent": "COLLAB_PREP",
  "required_trust_level": "PROTOCOL_VERIFIED",
  "response_target": "https://example.com/exchange/replies",
  "timeout_policy": "30S_OR_DEFER"
}
```

### 11.14 `capability.invoke.response`

```json
{
  "capability_name": "memory.exchange.summary_only",
  "invocation_status": "DEFERRED",
  "result_ref": null,
  "error_code": null,
  "effective_trust_level": "PROTOCOL_VERIFIED"
}
```

### 11.15 `collab.invite`

```json
{
  "invite_id": "inv_123",
  "title": "joint stream invitation",
  "summary": "proposal for short collaboration",
  "requested_actions": [
    "collab.accept"
  ],
  "risk_level": "HIGH",
  "requires_fresh_reverification": true
}
```

### 11.16 `collab.accept`

```json
{
  "invite_id": "inv_123",
  "accepted_at": "2026-03-24T12:36:00Z",
  "conditions": [
    "summary_only_memory_exchange"
  ]
}
```

### 11.17 `collab.reject`

```json
{
  "invite_id": "inv_123",
  "rejected_at": "2026-03-24T12:36:00Z",
  "reason_code": "POLICY_DECLINED"
}
```

### 11.18 `collab.defer`

```json
{
  "invite_id": "inv_123",
  "deferred_until": "2026-03-25T00:00:00Z",
  "reason_code": "MANUAL_REVIEW_REQUIRED"
}
```

### 11.19 `status.notify`

```json
{
  "status_type": "DEGRADED",
  "detail": "revocation freshness nearing expiry",
  "effective_capabilities": [
    "chat.basic"
  ]
}
```

### status_type enum

- `ACTIVE`
- `DEGRADED`
- `QUARANTINED`
- `RECOVERING`
- `TERMINATING`

### 11.20 `session.renew`

```json
{
  "current_session_id": "ses_123",
  "next_session_id": "ses_124",
  "reason_code": "HIGH_RISK_REAUTH_REQUIRED",
  "new_session_epoch": 31,
  "effective_at": "2026-03-24T12:38:00Z"
}
```

### 11.21 `session.terminate`

```json
{
  "session_id": "ses_123",
  "reason_code": "REVOCATION_EPOCH_INCREASED",
  "reason_detail": "fresh revocation proof no longer matches",
  "terminated_at": "2026-03-24T12:38:30Z"
}
```

### 11.22 `warning.compromised`

```json
{
  "warning_type": "OPERATION_KEY_COMPROMISED",
  "reported_at": "2026-03-24T12:37:00Z",
  "recommended_action": "TERMINATE_AND_REVERIFY"
}
```

### 11.23 `policy.update`

```json
{
  "policy_epoch": 5,
  "previous_policy_epoch": 4,
  "effective_at": "2026-03-24T12:39:00Z",
  "reauth_required": true
}
```

### 11.24 交流段階と trust 昇格契約

- discovery / mention / lightweight invite は `UNVERIFIED` または `PLATFORM_LINKED` で開始可能
- `capability.invoke.request` で `required_trust_level = PROTOCOL_VERIFIED` を示せること
- memory exchange、外部 tool 実行、binding / policy 変更、ledger 書き込み依頼では stronger verification を要求できること
- transport profile が thread を弱くしか表現できない場合でも、`correlation_id` により会話段階を継続追跡できること

---

## 12. Ledger Interface

### 12.1 目的

更新・失効・回復イベントを append-only に扱う。

### 12.2 LedgerEvent 共通型

```json
{
  "event_id": "evt_123",
  "event_type": "key.revoked",
  "spec_version": "0.2",
  "schema_version": "1",
  "agent_id": "agt_target",
  "controller_id": "ctrl_target",
  "event_time": "2026-03-24T12:38:00Z",
  "recorded_at": "2026-03-24T12:38:02Z",
  "producer_key_id": "opk_1",
  "sequence": 10,
  "prev_event_hash": "sha256:...",
  "payload_hash": "sha256:...",
  "ledger_checkpoint": "chk_1001",
  "payload": {},
  "signatures": [
    {
      "key_id": "opk_1",
      "algorithm": "ed25519",
      "canonicalization": "jcs",
      "value": "..."
    }
  ]
}
```

### 12.3 event_type 一覧

- `agent.created`
- `key.added`
- `key.revoked`
- `key.rotated`
- `binding.added`
- `binding.removed`
- `binding.updated`
- `compromise.reported`
- `agent.quarantined`
- `recovery.initiated`
- `recovery.completed`
- `policy.updated`

### 12.4 AppendLedgerEventRequest

```json
{
  "event": {
    "event_id": "evt_123",
    "event_type": "key.revoked",
    "spec_version": "0.2",
    "schema_version": "1",
    "agent_id": "agt_target",
    "controller_id": "ctrl_target",
    "event_time": "2026-03-24T12:38:00Z",
    "recorded_at": "2026-03-24T12:38:02Z",
    "producer_key_id": "opk_1",
    "sequence": 10,
    "prev_event_hash": "sha256:...",
    "payload_hash": "sha256:...",
    "ledger_checkpoint": "chk_1001",
    "payload": {
      "key_id": "opk_1",
      "key_scope": "operation",
      "revocation_reason": "compromised",
      "effective_at": "2026-03-24T12:38:00Z",
      "revocation_epoch": 9
    },
    "signatures": [
      {
        "key_id": "opk_1",
        "algorithm": "ed25519",
        "canonicalization": "jcs",
        "value": "..."
      }
    ]
  }
}
```

### 12.5 AppendLedgerEventResponse

```json
{
  "append_status": "APPENDED",
  "event_id": "evt_123",
  "checkpoint": "chk_1001"
}
```

### append_status enum

- `APPENDED`
- `REJECTED`
- `DUPLICATED`
- `CONFLICTED`

### 12.6 ReadLedgerStateRequest

```json
{
  "agent_id": "agt_target",
  "since_checkpoint": "chk_0990",
  "max_events": 100
}
```

### 12.7 ReadLedgerStateResponse

```json
{
  "agent_id": "agt_target",
  "current_checkpoint": "chk_1001",
  "events": [],
  "has_more": false
}
```

---

## 13. Watcher Notification Interface

### 13.1 目的

監視者が検知した異常や一貫性警告を通知する。

### 13.2 WatcherAlert

```json
{
  "alert_id": "alt_123",
  "agent_id": "agt_target",
  "alert_type": "SPLIT_VIEW_SUSPECTED",
  "detected_at": "2026-03-24T12:40:00Z",
  "severity": "HIGH",
  "evidence_refs": [
    "chk_1001",
    "chk_1001_conflict"
  ],
  "recommended_action": "HOLD_HIGH_RISK_OPERATIONS"
}
```

### alert_type enum

- `SPLIT_VIEW_SUSPECTED`
- `ROLLBACK_SUSPECTED`
- `STALE_REVOCATION_EXCESSIVE`
- `CHECKPOINT_CONFLICT`
- `UNEXPECTED_KEY_ROTATION`
- `RECOVERY_SEQUENCE_INVALID`

---

## 14. Recovery Control Interface

### 14.1 目的

侵害後の回復フローを管理する。

### 14.2 StartRecoveryRequest

```json
{
  "agent_id": "agt_target",
  "recovery_reason": "OPERATION_KEY_COMPROMISED",
  "requested_by_key_id": "rec_1",
  "proposed_new_operation_key": {
    "key_id": "opk_2",
    "public_key": "..."
  }
}
```

### 14.3 StartRecoveryResponse

```json
{
  "recovery_status": "INITIATED",
  "recovery_id": "rcv_123",
  "agent_status": "RECOVERING",
  "quarantine_status": "HARD",
  "required_next_steps": [
    "REVOKE_COMPROMISED_KEYS",
    "RECONFIRM_BINDINGS",
    "APPEND_RECOVERY_COMPLETED"
  ]
}
```

### 14.4 CompleteRecoveryRequest

```json
{
  "recovery_id": "rcv_123",
  "agent_id": "agt_target",
  "new_operation_key_id": "opk_2",
  "reconfirmed_bindings": [
    {
      "platform_type": "discord",
      "platform_account_id": "1234567890"
    }
  ]
}
```

### 14.5 CompleteRecoveryResponse

```json
{
  "recovery_status": "COMPLETED",
  "agent_status": "ACTIVE",
  "quarantine_status": "NONE",
  "new_revocation_epoch": 9,
  "new_identity_version": 13
}
```

---

## 14.6 Bootstrap Trust Interface

### 14.6.1 目的

first-seen peer に対する初回接触時の trust 扱いを定義する。

### 14.6.2 入力: EvaluateBootstrapTrustRequest

```json
{
  "agent_id": "agt_target",
  "discovery_source": {
    "platform_type": "x",
    "platform_account_id": "example_handle"
  },
  "known_version_vector": null,
  "requested_risk_level": "HIGH",
  "watcher_evidence_refs": [],
  "mirror_checkpoint_refs": []
}
```

### 14.6.3 出力: EvaluateBootstrapTrustResponse

```json
{
  "bootstrap_status": "FIRST_SEEN_RESTRICTED",
  "trust_level": "FIRST_SEEN",
  "high_risk_allowed": false,
  "requires_additional_confirmation": true,
  "recommended_actions": [
    "FETCH_WATCHER_EVIDENCE",
    "DEFER_HIGH_RISK"
  ],
  "warnings": [
    "no prior monotonic state"
  ]
}
```

### bootstrap_status enum

- `KNOWN_PEER`
- `FIRST_SEEN_LOW_RISK_ONLY`
- `FIRST_SEEN_RESTRICTED`
- `BOOTSTRAP_REJECTED`

### 契約

- first-seen peer は UI / log 上で既知 peer と区別できること
- high-risk では prior state 不足を理由に追加確認または defer を返せること
- watcher / mirror / checkpoint witness がある場合は bootstrap 判断に反映できること

---

## 14.7 Time Health Interface

### 14.7.1 目的

timestamp / expiry / nonce 判定に影響する clock health を確認する。

### 14.7.2 入力: CheckTimeHealthRequest

```json
{
  "required_risk_level": "HIGH",
  "observed_remote_time": "2026-03-24T12:35:10Z",
  "local_time": "2026-03-24T12:35:50Z",
  "max_allowed_skew_seconds": 120
}
```

### 14.7.3 出力: CheckTimeHealthResponse

```json
{
  "time_health_status": "HEALTHY",
  "observed_skew_seconds": 40,
  "high_risk_allowed": true,
  "recommended_error_code": null,
  "warnings": []
}
```

### time_health_status enum

- `HEALTHY`
- `SKEWED`
- `UNTRUSTED`
- `UNKNOWN`

### 契約

- `SKEWED` 以上は high-risk 判定前に評価できること
- `UNTRUSTED` は high-risk を fail-closed にすること
- 時刻異常は `TIMESTAMP_INVALID` または同等コードに接続できること

---

## 14.8 Admin Action Protection Interface

### 14.8.1 目的

policy / recovery / key 操作などの高リスク管理操作に step-up 認証と承認条件を適用する。

### 14.8.2 入力: EvaluateAdminActionRequest

```json
{
  "actor_id": "ctrl_admin",
  "action_type": "RECOVERY_INITIATE",
  "target_agent_id": "agt_target",
  "requested_risk_level": "HIGH",
  "step_up_present": true,
  "approval_count": 1,
  "required_approval_count": 2
}
```

### 14.8.3 出力: EvaluateAdminActionResponse

```json
{
  "decision": "DEFERRED",
  "step_up_required": false,
  "additional_approvals_required": 1,
  "audit_required": true,
  "warnings": [
    "multi-party approval not yet satisfied"
  ]
}
```

### decision enum

- `ALLOWED`
- `DEFERRED`
- `REJECTED`

### 契約

- recovery / root / policy 更新系操作は通常 exchange と分離した監査文脈で扱えること
- step-up 認証の有無と approval 条件を機械判定できること
- 管理系拒否は security event として記録可能であること

---

## 15. Error Interface

すべての interface は最低限以下形式の error を返せること。

```json
{
  "error": {
    "code": "KEY_REVOKED",
    "message": "operation key has been revoked",
    "retryable": false,
    "risk_level": "HIGH",
    "details": {}
  }
}
```

### 必須フィールド

- `code`
- `message`
- `retryable`
- `risk_level`
- `details`

---

## 16. 実装固定値の推奨 baseline

以下は推奨値であり、厳密な MUST ではないが、MVP 相互運用性のため準拠推奨とする。

- clock skew 許容: ±120秒
- challenge TTL: 60秒
- session TTL: 300秒
- revocation cache TTL: 30〜120秒
- identity cache TTL: 600〜3600秒
- nonce 保存期間: challenge TTL + 300秒
- high-risk freshness required: true
- stale-if-error for revocation: false
- first-seen high-risk default: defer
- admin step-up required for recovery/policy/root actions: true

---

## 17. 互換性ポリシー

### patch

- optional field のみ追加可
- 後方互換維持

### minor

- optional field 追加可
- enum 値追加可
- digest algorithm 追加可

### major

- required field 変更可
- state semantics 変更可
- backward incompatible changes 許容

---

## 18. 適合性テスト対象

最低限以下の interface 契約テストを用意すること。

1. signed manifest resolve
2. challenge issuance / replay rejection
3. stale revocation high-risk deny
4. session epoch mismatch termination
5. key revoked -> active session invalidation
6. compromise -> quarantine -> recovery sequence
7. rollback detection with older identity_version
8. watcher alert ingestion
9. first-seen high-risk defer
10. clock skew over threshold -> high-risk deny
11. admin action without step-up or sufficient approvals -> defer or reject
