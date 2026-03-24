# AITuber相互認証・交流プロトコル
# ledger/events.md
# v0.2-draft

## 0. 目的

本書は、AITuber 相互認証・交流プロトコルにおける透明性ログ / 台帳イベントの形式、意味、検証要件を定義する。

台帳の主目的は以下である。

- 改ざん検知
- rollback / freeze / split-view の検出補助
- 鍵更新・失効・侵害・回復の履歴監査
- コミュニティ横断の透明性確保

台帳は **検知と監査** を担う。
台帳単体はリアルタイム遮断の責務を持たない。

---

## 1. スコープ

本書が定義するもの:

- event envelope
- event type taxonomy
- event payload の最低意味
- ordering / checkpoint の扱い
- producer / verifier / watcher の責務
- 署名と canonicalization の要求
- event validation rules

本書が定義しないもの:

- ブロックチェーン合意
- 特定DB製品の採用
- gossip 配送実装
- 会話本文など高頻度アプリデータの記録
- lightweight interop message や transport profile そのものの配送仕様

---

## 2. 基本原則

### 2.1 Append-Only

台帳は追記専用とする。
過去イベントの削除・上書きを許容してはならない。

### 2.2 Signed Events

各イベントは正当な鍵で署名されなければならない。

### 2.3 Minimal but Sufficient

台帳には必要最小限のイベントメタデータのみを載せる。
通常会話本文や高機微データは原則載せない。

### 2.4 Detect, Not Necessarily Block

台帳は検知と監査を担う。
blocking は revocation / session / policy 層で行う。

### 2.5 Monotonic Checkpoint

verifier / watcher は checkpoint を単調増加的に扱う。
過去 checkpoint を現在正本として提示してはならない。

---

## 3. 台帳の論理モデル

最低限、台帳は以下を表現できること。

- どの agent に対するイベントか
- いつ起きたか
- 何が起きたか
- 誰が署名したか
- どの event version か
- どの checkpoint に属するか
- どの previous event を継承するか

---

## 4. イベント分類

### 4.1 ライフサイクル

- `agent.created`
- `recovery.initiated`
- `recovery.completed`

### 4.2 鍵管理

- `key.added`
- `key.revoked`
- `key.rotated`

### 4.3 platform binding

- `binding.added`
- `binding.updated`
- `binding.removed`

### 4.4 侵害・隔離

- `compromise.reported`
- `agent.quarantined`

### 4.5 ポリシー

- `policy.updated`

### 4.6 任意の将来拡張

- `watcher.alerted`
- `checkpoint.published`
- `agent.suspended`

MVP ではすべて必須ではないが、少なくとも以下は扱えるべきである。

- `key.revoked`
- `binding.updated`
- `compromise.reported`
- `agent.quarantined`
- `recovery.initiated`
- `recovery.completed`

---

## 5. Event Envelope

すべての ledger event は共通 envelope を持つ。

最低限必要な項目:

- `event_id`
- `event_type`
- `spec_version`
- `schema_version`
- `agent_id`
- `controller_id`
- `event_time`
- `recorded_at`
- `producer_key_id`
- `sequence`
- `prev_event_hash`
- `payload_hash`
- `ledger_checkpoint`
- `payload`
- `signatures`

### 5.1 `event_id`

イベント一意識別子。

### 5.2 `event_type`

例:

- `key.revoked`
- `compromise.reported`

### 5.3 `spec_version`

プロトコル仕様バージョン。

### 5.4 `schema_version`

そのイベント payload schema の版。

### 5.5 `agent_id`

イベント対象 agent。

### 5.6 `controller_id`

所有責任主体。
監査性のため原則保持する。

### 5.7 `event_time`

事象発生時刻。
署名対象。

### 5.8 `recorded_at`

台帳に格納・公開された時刻。
署名対象に含めることを推奨する。

### 5.9 `producer_key_id`

イベント署名に使った鍵ID。

### 5.10 `sequence`

同一 agent の event sequence。
単調増加を期待する。

### 5.11 `prev_event_hash`

前イベントの canonical hash。
単一チェーン表現が難しい実装では null を許容するが、MVP でも可能なら保持が望ましい。

### 5.12 `payload_hash`

canonicalized payload の hash。

### 5.13 `ledger_checkpoint`

その時点での ledger の checkpoint。
root hash、tree head、monotonic sequence head など実装依存だが、単調増加比較可能であることが望ましい。

### 5.14 `signatures`

1件以上の署名。
将来 multi-signature / witness に拡張可能。

---

## 6. Checkpoint

### 6.1 目的

checkpoint は以下に使う。

- rollback 検知
- freeze 検知
- split-view 疑いの観測
- verifier の monotonic 参照点

### 6.2 要件

checkpoint は最低限:

- 機械可読
- 比較可能
- 改ざん検知可能
- watcher が観測できる

### 6.3 許容実装例

- Merkle tree root
- signed tree head
- append-only log head number + hash
- monotonic journal offset + digest

### 6.4 verifier の扱い

verifier は各 peer について最後に観測した checkpoint を保存し、より古い checkpoint を観測した場合に次を行う。

- warning または拒否
- high-risk の停止
- watcher 通知推奨

---

## 7. Canonicalization と署名

### 7.1 canonicalization 必須

イベント署名対象は canonicalized representation でなければならない。

最低要求:

- field order が決まること
- whitespace 差分でハッシュが変わらないこと
- UTF-8 正規化方針が固定されること

### 7.2 署名対象

最低限、以下を署名対象に含めること。

- envelope の署名対象フィールド
- payload
- payload_hash
- sequence
- prev_event_hash
- ledger_checkpoint

### 7.3 許容署名者

イベント種別ごとに署名権限を制限する。

例:

- `key.revoked`: operation key 以上、または recovery 権限
- `compromise.reported`: operation key、recovery key、監査主体などポリシー依存
- `recovery.completed`: root key または recovery key 相当

---

## 8. Event Ordering Rules

### 8.1 同一 agent 内 ordering

同一 `agent_id` のイベントは `sequence` により順序付けされるべきである。

### 8.2 out-of-order 受信

配送は順不同で起こりうる。
verifier / watcher は以下を行えることが望ましい。

- 一時保留
- prev hash 解決待ち
- sequence gap の警告
- checkpoint による整合確認

### 8.3 duplicate event

同一 `event_id` は重複許容だが、同一内容として idempotent に処理する。

### 8.4 conflicting event

同じ `sequence` で異なる payload / hash を観測した場合は split-view または改ざん疑い。

---

## 9. Event Type Definitions

### 9.1 `key.revoked`

#### 目的

鍵失効を記録する。

#### 最低 payload

- `key_id`
- `key_scope`
- `revocation_reason`
- `effective_at`
- `revocation_epoch`
- `replacement_key_id` optional

#### 意味

このイベントを観測した verifier は、対象鍵を以後の新規 high-risk 認証に使ってはならない。

---

### 9.2 `compromise.reported`

#### 目的

侵害疑いまたは侵害確定を記録する。

#### 最低 payload

- `compromise_scope`
- `severity`
- `detected_at`
- `effective_at`
- `suspected_since` optional
- `reported_reason`
- `revocation_epoch`
- `recommended_actions`

#### 意味

このイベントは quarantine や key revoke など後続イベントの引き金になりうる。

---

### 9.3 `agent.quarantined`

#### 目的

agent を隔離状態に置く。

#### 最低 payload

- `quarantine_reason`
- `quarantine_level`
- `effective_at`
- `revocation_epoch`
- `policy_epoch`
- `high_risk_blocked`
- `capability_restrictions`
- `exchange_blocked_message_types`
- `exit_conditions`

#### 意味

新規 high-risk セッション禁止、既存 capability 縮退を促す。

---

### 9.4 `recovery.initiated`

#### 目的

回復フローの開始を監査可能にする。

#### 最低 payload

- `recovery_id`
- `initiated_at`
- `recovery_reason`
- `initiated_by_key_id`
- `revocation_epoch`
- `quarantine_required`

#### 意味

このイベントを起点として、quarantine、key revoke、binding 再確認、recovery completion が順序づけられる。

---

### 9.5 `recovery.completed`

#### 目的

回復完了を記録する。

#### 最低 payload

- `recovery_id`
- `completed_at`
- `new_operation_key_ids`
- `binding_reverified`
- `revocation_epoch`
- `identity_version`
- `policy_epoch`
- `quarantine_cleared`
- `recovery_summary`

#### 意味

回復完了後も履歴は消さない。
単に active に戻すのではなく、過去侵害履歴の上に continuity を維持して継続する。

---

### 9.6 `binding.updated`

#### 目的

platform binding の更新を記録する。

#### 最低 payload

- `platform_type`
- `platform_account_id`
- `display_handle`
- `binding_status`
- `bound_by_key_id`
- `binding_version`
- `effective_at`
- `verified_at` optional

#### 意味

platform account の追加・更新・削除を監査可能にする。

---

## 10. Authorization Matrix

イベント発行権限の最低例:

### `key.revoked`

- operation key: 可
- recovery key: 可
- root key: 可

### `compromise.reported`

- operation key: 可
- recovery key: 可
- watcher: 直接確定イベントとしてではなく external alert として扱う方が安全

### `agent.quarantined`

- operation key: 可
- recovery key: 可
- policy 上 watcher co-sign を要求してもよい

### `recovery.completed`

- root key: 強く推奨
- recovery key: 許容
- operation key 単独: 非推奨

### `binding.updated`

- operation key: 可
- root / recovery key: 可

---

## 11. Validation Rules

verifier / watcher は最低限以下を検証する。

1. envelope schema 妥当性
2. payload schema 妥当性
3. event_type と payload の整合
4. signature 妥当性
5. producer_key_id が当時有効だったか
6. sequence 単調性
7. prev_event_hash 整合性
8. payload_hash 整合性
9. agent_id / controller_id 整合性
10. checkpoint の rollback 疑い有無

---

## 12. Watcher の最低責務

watcher は少なくとも以下のいずれかを行えると望ましい。

- checkpoint 観測
- event sequence gap 検知
- conflicting event 検知
- old checkpoint 再配布検知
- quarantine / recovery の可視化

MVP では watcher は必須実装ではなくてもよいが、仕様上は存在を考慮する。

Push は高速通知、pull は最終確認の責務を持つ。
ledger event を push で観測した verifier は、revocation / manifest 側への pull 再確認を行い、最終状態を確定することが望ましい。

---

## 13. プライバシーとデータ最小化

台帳には原則として以下を載せない。

- 通常会話本文
- lightweight interop の hello / mention / invite 本文
- memory exchange 本文
- 個人情報
- 配信メタ以外の高機微情報
- 秘密鍵情報
- session secret

台帳に載せるのは、検証・監査に必要な最小イベントメタデータに留める。

---

## 14. Retention

- 過去イベント削除禁止
- tombstone ではなく event continuity で扱う
- recovery 後も compromise 記録は保持
- binding remove も削除ではなく removal event として扱う

---

## 15. エラーと異常状態

代表例:

- `INVALID_EVENT_SIGNATURE`
- `EVENT_SCHEMA_INVALID`
- `EVENT_SEQUENCE_GAP`
- `EVENT_SEQUENCE_CONFLICT`
- `EVENT_PREV_HASH_MISMATCH`
- `EVENT_CHECKPOINT_OLD`
- `EVENT_PRODUCER_KEY_REVOKED`
- `EVENT_AGENT_ID_MISMATCH`
- `EVENT_DUPLICATE_ID_CONFLICT`

---

## 16. MVP で必須にするもの

MVP では最低限、以下を必須とする。

1. signed event envelope
2. `event_id`, `event_type`, `agent_id`, `event_time`, `sequence`, `ledger_checkpoint`, `payload`, `signatures`
3. `key.revoked`
4. `compromise.reported`
5. `agent.quarantined`
6. `recovery.initiated`
7. `recovery.completed`
8. `binding.updated`
9. checkpoint の monotonic 監視

---

## 17. 今後の拡張論点

- multi-witness signature
- signed tree head の厳密仕様
- gossip federation
- community quorum model
- public transparency mirror
- immutable storage backend
