# AITuber相互認証・交流プロトコル
# auth/cache-and-freshness.md
# v0.2-draft

## 0. 目的

本書は、認証・失効・回復に関する **キャッシュの扱い** と **freshness 判定** を定義する。

本プロトコルにおいて重要なのは、単に署名が検証できることではない。
最も危険なのは、**過去には正しかったが、現在は失効済みの状態を古いキャッシュで信じてしまうこと** である。

したがって本仕様は、以下を扱う。

- identity 情報のキャッシュ
- revocation 情報のキャッシュ
- session / nonce 関連キャッシュ
- freshness の判定基準
- stale 時の fail-soft / fail-closed
- rollback / freeze / split-view の検出補助
- push / pull による整合性回復

---

## 1. スコープ

本書が定義するもの:

- cache category
- freshness policy
- TTL / soft TTL / hard TTL の概念
- risk level ごとの判定
- stale / missing / conflicting 状態での既定挙動
- epoch / version / checkpoint の整合ルール

本書が定義しないもの:

- 具体的な CDN / DB / Redis 実装
- 各言語のキャッシュライブラリ実装
- 使用暗号アルゴリズムの最終固定
- 監視通知システムの配送実装

---

## 2. 基本原則

### 2.1 Identity と Revocation を分離する

identity は比較的長くキャッシュしてよいが、revocation は短く扱う。
両者を同一 TTL で扱ってはならない。

### 2.2 Freshness は署名検証とは別軸で判定する

署名が正しいことは、現在も有効であることを保証しない。
有効性判定には freshness と epoch の確認が必要である。

### 2.3 stale-if-error は限定的にしか使わない

identity cache については低リスク操作でのみ stale-if-error を許容しうる。
revocation cache に対して stale-if-error を high-risk に適用してはならない。

### 2.4 monotonic に見る

verifier は少なくとも以下を単調増加的に記録し、より古い情報を受け取った場合に警告または拒否する。

- `identity_version`
- `revocation_epoch`
- `policy_epoch`
- `ledger_checkpoint`

### 2.5 高リスクでは fail-closed

high-risk 操作では fresh revocation proof が取れない限り拒否する。
「たぶん大丈夫」は許容しない。

---

## 3. 用語

### Identity Cache

正本 identity manifest 由来のキャッシュ。
公開鍵、platform binding、service endpoint、capability summary などを含む。

### Revocation Cache

失効・侵害・隔離状態を表すキャッシュ。
`revocation_epoch`、agent status、key status、quarantine state などを含む。

### Session Cache

セッションおよび replay 対策用キャッシュ。
`session_id`、nonce 使用状態、sequence、`session_epoch` などを含む。

### Fresh

検証時点で利用許容範囲内にある状態。

### Stale

過去情報としては有効かもしれないが、現在判定にそのまま使うには古すぎる状態。

### Missing

必要なキャッシュまたは外部状態が取得できない状態。

### Conflicting

異なるソースから矛盾する状態を観測した状態。

### Soft TTL

再取得を試みるべき閾値。失敗時に限定利用可。

### Hard TTL

それを超えたら利用禁止とする閾値。

### Fresh Revocation Proof

高リスク操作時に必要な、十分に新しい revocation 状態確認結果。

---

## 4. キャッシュ分類

最低限、キャッシュは次の3種に分離すること。

## 4.1 Identity Cache

最低限保持対象:

- `agent_id`
- `controller_id`
- `identity_version`
- `manifest_url` または equivalent locator
- `public_keys`
- `platform_bindings`
- `service_endpoints`
- `capability_summary`
- `policy_ref`
- `updated_at`
- `manifest_signature`
- `ledger_ref`

性質:

- 比較的長TTL
- 再検証可能
- stale-if-error を低リスクで限定許容

## 4.2 Revocation Cache

最低限保持対象:

- `agent_id`
- `revocation_epoch`
- `agent_status`
- `quarantine_status`
- `key_states`
- `fresh_until`
- `checked_at`
- `source`
- `ledger_checkpoint`
- `recovery_state`
- `compromise_state`

性質:

- 短TTL
- high-risk では hard TTL 超過を許容しない
- stale-if-error 原則禁止

## 4.3 Session Cache

最低限保持対象:

- `session_id`
- `agent_id`
- `instance_id`
- `session_epoch`
- `revocation_epoch_at_issue`
- `policy_epoch_at_issue`
- `sequence_last_seen`
- `nonces_seen`
- `expires_at`
- `terminated_at`
- `termination_reason`

性質:

- 短命
- replay 検知に必須
- verifier 再起動時の扱いを定義する必要がある

---

## 5. Risk Level

本仕様では少なくとも 2 段階の risk level を定義する。

## 5.1 Low-Risk

例:

- profile 表示
- status 照会
- basic hello
- capability summary の閲覧
- 軽微な交流可否の確認

要件:

- identity cache が fresh または soft stale なら限定利用可
- revocation cache が soft stale なら degrade 動作可
- capability downgrade を適用可能

## 5.2 High-Risk

例:

- memory exchange
- capability 昇格
- platform binding 更新
- 公式コラボ承認
- ledger write 依頼
- recovery 関連承認
- identity 引継ぎ

要件:

- fresh revocation proof 必須
- stale revocation cache では fail-closed
- conflicting state では fail-closed
- identity rollback 疑い時は fail-closed

---

## 6. Freshness モデル

## 6.1 判定対象

freshness は最低限、次に対して判定する。

- identity manifest
- revocation status
- policy state
- session state
- nonce state

## 6.2 基本フィールド

各 freshness 判定対象は、可能な限り次を持つこと。

- `checked_at`
- `fresh_until`
- `soft_ttl`
- `hard_ttl`
- `identity_version`
- `revocation_epoch`
- `policy_epoch`
- `ledger_checkpoint`

## 6.3 推奨ベースライン

MVP では以下を推奨値とする。

### Identity Cache
- soft TTL: 300 秒
- hard TTL: 3600 秒

### Revocation Cache
- soft TTL: 15 秒
- hard TTL: 120 秒

### Session Cache
- session TTL: 300 秒以下推奨
- nonce retention: challenge expiry + 120 秒以上推奨

注:
これらは実装環境に応じて変更可能だが、high-risk で revocation を identity と同等TTLで扱ってはならない。

---

## 7. 判定ルール

## 7.1 Identity Cache 判定

identity cache は次の状態を取りうる。

- `FRESH`
- `SOFT_STALE`
- `HARD_STALE`
- `MISSING`
- `CONFLICTING`
- `ROLLBACK_SUSPECTED`

### 利用ルール

- `FRESH`: 利用可
- `SOFT_STALE`: 再取得試行後、低リスクのみ限定利用可
- `HARD_STALE`: high-risk 不可、low-risk も原則再取得優先
- `MISSING`: 再取得試行
- `CONFLICTING`: fail-closed または warning + limited mode
- `ROLLBACK_SUSPECTED`: fail-closed

## 7.2 Revocation Cache 判定

revocation cache は次の状態を取りうる。

- `FRESH`
- `SOFT_STALE`
- `HARD_STALE`
- `MISSING`
- `CONFLICTING`
- `CHECKPOINT_OLD`
- `EPOCH_REGRESSION`
- `QUARANTINED`

### 利用ルール

- `FRESH`: 利用可
- `SOFT_STALE`: low-risk のみ capability downgrade で利用可
- `HARD_STALE`: high-risk 不可
- `MISSING`: high-risk 不可
- `CONFLICTING`: fail-closed
- `CHECKPOINT_OLD`: fail-closed
- `EPOCH_REGRESSION`: fail-closed
- `QUARANTINED`: 新規 high-risk 不可、既存権限縮退

## 7.3 Session Cache 判定

session cache は次の状態を取りうる。

- `ACTIVE`
- `EXPIRED`
- `TERMINATED`
- `EPOCH_OLD`
- `SEQUENCE_REPLAY`
- `NONCE_REPLAY`

### 利用ルール

- `ACTIVE`: 利用可
- `EXPIRED`: 更新要求
- `TERMINATED`: 即拒否
- `EPOCH_OLD`: 即拒否
- `SEQUENCE_REPLAY`: 即拒否 + 監査記録
- `NONCE_REPLAY`: 即拒否 + 監査記録

---

## 8. Monotonic State Rules

verifier は各 peer ごとに、最後に観測した以下の値を保存することが望ましい。

- `last_identity_version`
- `last_revocation_epoch`
- `last_policy_epoch`
- `last_ledger_checkpoint`

以下を観測した場合は異常とみなす。

### 8.1 Identity Rollback

受信した `identity_version` が `last_identity_version` より小さい場合。

扱い:
- `IDENTITY_ROLLBACK_DETECTED`
- fail-closed
- watcher 通知推奨

### 8.2 Revocation Epoch Regression

受信した `revocation_epoch` が `last_revocation_epoch` より小さい場合。

扱い:
- `REVOCATION_EPOCH_REGRESSION`
- fail-closed
- session 強制再評価

### 8.3 Policy Epoch Regression

受信した `policy_epoch` が `last_policy_epoch` より小さい場合。

扱い:
- policy rollback 疑い
- high-risk 拒否

### 8.4 Ledger Checkpoint Regression

受信した `ledger_checkpoint` が既知 checkpoint より古い場合。

扱い:
- split-view / freeze / rollback 疑い
- fail-closed

---

## 9. Push / Pull 整合

## 9.1 基本責務

- Push: 高速通知
- Pull: 最終確認

push のみで最終状態を確定してはならない。
pull のみでは反応が遅すぎる可能性がある。

## 9.2 Push Event 例

- `key.revoked`
- `compromise.reported`
- `agent.quarantined`
- `recovery.completed`
- `policy.updated`

## 9.3 Pull Target 例

- revocation status endpoint
- identity manifest endpoint
- ledger checkpoint endpoint

## 9.4 Push 受信時の動作

push を受信した verifier は少なくとも以下を行う。

1. 対象 agent の revocation cache を dirty にする
2. active session を provisional restricted に落とせるようにする
3. pull 再確認を試行する
4. 確認後に epoch / status を更新する

---

## 10. Quarantine

## 10.1 Quarantine の意味

quarantine は、「完全失効ではないが、通常どおり信頼してはならない」中間状態である。

## 10.2 quarantine 中の最低制限

- 新規 high-risk セッション禁止
- capability 自動 downgrade
- memory exchange 禁止
- 招待 / 承認 / binding 更新停止
- recovery 完了まで制限継続

## 10.3 quarantine 解除条件

最低限以下を満たすこと。

- relevant compromise 対応完了
- `revocation_epoch` 更新済み
- 新鍵または再承認済み binding が反映済み
- `recovery.completed` または equivalent 状態が観測済み

---

## 11. 既定の失敗時動作

## 11.1 identity host 不達

### low-risk
- 既存 identity cache が soft stale 以内なら degrade 利用可

### high-risk
- revocation も fresh に取れないなら拒否

## 11.2 revocation host 不達

### low-risk
- soft stale 以内なら capability downgrade 可

### high-risk
- fail-closed

## 11.3 ledger endpoint 不達

- 直前 checkpoint と矛盾しない限り low-risk 継続可
- high-risk は revocation / identity の fresh 状態があっても、checkpoint 検証ポリシーにより拒否しうる

## 11.4 conflicting result

例:
- manifest 上は active
- revocation status 上は quarantined

扱い:
- fail-closed
- watcher 通知推奨
- audit event 記録推奨

---

## 12. 認証時アルゴリズム

以下は verifier 側の推奨疑似手順である。

1. `agent_id` を解決する
2. identity cache を確認
3. 必要なら manifest を再取得
4. manifest 署名を検証
5. monotonic check を行う
6. revocation cache を確認
7. high-risk なら fresh revocation proof を要求
8. challenge を発行
9. proof を受け取る
10. signature / nonce / timestamp / expiry を検証
11. proof 内 `revocation_epoch` / `identity_version` を照合
12. session を発行
13. session cache を作成
14. active session に現在 epoch を束縛する

---

## 13. 再認証・セッション更新

## 13.1 session renew 条件

以下のいずれかで session renew を行う。

- `expires_at` 接近
- `policy_epoch` 上昇
- `revocation_epoch` 上昇
- capability 変更
- high-risk 移行

## 13.2 更新時の要件

- 新 session_id を発行してもよい
- 旧 session は overlap 期間を短くする
- overlap 中も sequence 分離が必要
- `session_epoch` が上がるなら旧 session は即停止可

---

## 14. Error Mapping

本書に関連する代表エラー:

- `STALE_IDENTITY_CACHE`
- `STALE_REVOCATION_CACHE`
- `REVOCATION_CHECK_REQUIRED`
- `IDENTITY_ROLLBACK_DETECTED`
- `REVOCATION_EPOCH_REGRESSION`
- `LEDGER_CHECKPOINT_OLD`
- `CONFLICTING_REVOCATION_STATE`
- `AGENT_QUARANTINED`
- `SESSION_EPOCH_OLD`
- `NONCE_REPLAY`
- `SEQUENCE_REPLAY`
- `HIGH_RISK_REQUIRES_FRESH_PROOF`

---

## 15. 監視・観測性

最低限、以下を計測できることが望ましい。

- identity cache hit / miss / stale rate
- revocation cache hit / miss / stale rate
- fresh revocation proof latency
- rollback detection count
- quarantine transition count
- conflicting state count
- replay rejection count
- high-risk refusal count
- push-to-pull reconciliation latency

---

## 16. セキュリティ考慮事項

- identity cache と revocation cache を同一オブジェクトで上書きしない
- stale revocation を暗黙許容しない
- epoch 比較を文字列辞書順で実装しない
- nonce replay 検知を process memory のみで完結させる場合、再起動窓を明確化する
- quarantined 状態で既存 capability を温存しない
- watcher 不在時でも最低限 rollback 検知が機能するよう、local monotonic record を持つ

---

## 17. 今後の拡張論点

- freshness attestation の署名化
- signed checkpoint witness
- watcher quorum による split-view 検出
- multi-region cache 一貫性
- offline verifier の上限挙動
- trust tier ごとの TTL 差分

---

## 18. MVP固定ルール

MVP では最低限、以下を必須とする。

1. identity / revocation / session cache を分離すること
2. high-risk で fresh revocation proof を要求すること
3. `identity_version` と `revocation_epoch` を monotonic に扱うこと
4. stale revocation cache で high-risk を通さないこと
5. quarantine 状態で capability downgrade すること
6. session / nonce replay を検出できること