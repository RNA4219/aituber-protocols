# Revoke Examples

このディレクトリには、鍵失効とセッション停止に関連するサンプルJSONファイルが含まれています。

## ファイル一覧

### key-revocation-flow.json

operation keyの漏洩時における鍵失効フローの例です。

以下の内容を含みます:
- `key.revoked` イベントの完全なenvelope
- 失効の影響を受けるアクティブセッション一覧
- revocation_epochの増加
- Agent状態の遷移（ACTIVE -> QUARANTINED_HARD）

### session-termination.json

revocation_epoch増加に伴うセッション強制停止の例です。

以下の内容を含みます:
- 強制停止のトリガー情報
- 停止されるセッション一覧
- ピアへの通知
- ステートマシンの遷移

## 関連する仕様書

- `specs/core/requirements.md` - セッション要件、強制停止要件
- `specs/auth/state-machine.md` - Session State Machine
- `specs/ledger/events.md` - `key.revoked` イベント定義
- `schemas/ledger/key-revoked.schema.json` - key.revokedスキーマ

## イベントフロー

```
侵害検知
    |
    v
key.revoked イベント発行
    |
    v
revocation_epoch 増加 (14 -> 15)
    |
    v
アクティブセッション強制停止
    |
    v
Agent状態: ACTIVE -> QUARANTINED_HARD
```

## 使用上の注意

- これらは例示用のデータであり、実際の署名値はダミーです
- 本番運用では適切な署名アルゴリズムと鍵管理を行ってください
- セッション停止は fail-closed で実装することを推奨します