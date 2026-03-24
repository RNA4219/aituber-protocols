# Recover Examples

このディレクトリには、侵害対応と回復フローに関連するサンプルJSONファイルが含まれています。

## ファイル一覧

### compromise-to-recovery.json

侵害検知から回復完了までの完全なイベントシーケンスの例です。

以下のイベントフローを含みます:
1. `compromise.reported` - 侵害の報告
2. `agent.quarantined` - エージェントの隔離
3. `key.revoked` - 鍵の失効
4. `recovery.initiated` - 回復の開始
5. `recovery.completed` - 回復の完了

各イベントは以下を含みます:
- 完全なイベントenvelope
- 署名情報
- ステートマシンの状態遷移
- エポックの変化

### quarantine-flow.json

隔離レベル（soft/hard/full）の違いとそれぞれのフローの例です。

以下を含みます:
- ソフト隔離のシナリオ（platform binding偽装疑い）
- ハード隔離のシナリオ（operation key漏洩確定）
- 隔離レベルの比較表
- 出条件の要件

## 関連する仕様書

- `specs/core/requirements.md` - 侵害対応・回復要件（第20章）
- `specs/auth/state-machine.md` - Recovery State Machine、Agent State Machine
- `specs/ledger/events.md` - 各イベントの定義
- `schemas/ledger/compromise-reported.schema.json` - compromise.reportedスキーマ
- `schemas/ledger/agent-quarantined.schema.json` - agent.quarantinedスキーマ
- `schemas/ledger/recovery-initiated.schema.json` - recovery.initiatedスキーマ
- `schemas/ledger/recovery-completed.schema.json` - recovery.completedスキーマ

## イベントフロー

```
侵害検知
    |
    v
compromise.reported
    |
    v
agent.quarantined (soft/hard)
    |
    v
key.revoked
    |
    v
recovery.initiated
    |
    v
[鍵ローテーション]
    |
    v
[バインディング再確認]
    |
    v
recovery.completed
    |
    v
Agent: ACTIVE に復帰
```

## エポックの役割

| エポック | 役割 | 増加タイミング |
|---------|------|---------------|
| revocation_epoch | 鍵失効・侵害の履歴管理 | 失効イベント時 |
| policy_epoch | ポリシー変更の管理 | ポリシー更新時 |
| identity_version | アイデンティティの版数 | 回復完了時 |

## 回復完了条件

`recovery.completed` に遷移するには以下が必要:

1. relevant compromised keys が revoked または expired
2. new operation key が登録済み
3. required bindings が再確認済み
4. `revocation_epoch` が増加済み
5. `identity_version` が更新済み
6. ledger に `recovery.completed` が append 済み

## 使用上の注意

- これらは例示用のデータであり、実際の署名値はダミーです
- 回復フローでは root key または recovery key での署名を推奨します
- 回復後も侵害履歴は削除されません（透明性維持）
- 侵害の履歴は監査可能なまま残ります