# AITuber相互認証・交流プロトコル State Machine v0.2-draft

## 0. TL;DR

本書は、AITuber相互認証・交流プロトコルにおける
**Agent 状態**、**Session 状態**、**Recovery 状態**、**Verifier 判定状態** を定義する。

本仕様では、状態遷移の曖昧さを避けるために以下を分離して扱う。

- Agent lifecycle state
- Key state
- Binding state
- Session state
- Verification decision state
- Recovery workflow state
- Watcher alert influence state

認証成否だけでなく、
**freshness**、**quarantine**、**rollback suspicion**、**epoch mismatch** を状態機械として扱うことで、
キャッシュ競合や侵害時の誤挙動を防ぐ。

---

## 1. 文書情報

- 文書名: State Machine
- バージョン: v0.2-draft
- ステータス: Draft
- 関連文書:
  - `../core/requirements.md`
  - `../core/scope.md`
  - `../core/interfaces.md`
  - `../core/threat-model.md`

---

## 2. 設計方針

1. 状態は責務ごとに分離する
2. high-risk 判定では stale を許容しない
3. monotonic version は rollback 防止に使う
4. quarantine は独立状態として扱う
5. recovery は event sequence によってのみ完了できる
6. session は identity state の従属物であり、独立した永続正本ではない
7. watcher alert は advisory だが、一部は fail-closed を誘発しうる

---

## 3. Agent State Machine

### 3.1 AgentState 一覧

- `ACTIVE`
- `DEGRADED`
- `QUARANTINED_SOFT`
- `QUARANTINED_HARD`
- `RECOVERING`
- `SUSPENDED`

### 意味

#### ACTIVE

正常運用状態。新規セッション、low-risk / high-risk とも許容可能。

#### DEGRADED

一部 freshness 不足、binding 再確認待ち、watcher 警告などにより能力縮退した状態。
これは **実装補助状態** であり、requirements 上の quarantine とは別概念である。

#### QUARANTINED_SOFT

侵害疑いまたは軽度不整合により high-risk を禁止し、low-risk のみ限定継続する状態。

#### QUARANTINED_HARD

重大侵害疑い。新規セッション原則禁止。既存セッション停止対象。

#### RECOVERING

recovery 手続き進行中。identity continuity は維持されるが、通常運用不可。

#### SUSPENDED

手動停止、重大整合性不備、ポリシー違反などにより運用停止状態。

### 3.2 AgentState 遷移

### 初期状態

- `ACTIVE` または `SUSPENDED`
- 初回登録直後は `ACTIVE` 推奨

### 遷移表

| 現在状態 | イベント | 次状態 |
|---|---|---|
| ACTIVE | stale freshness detected | DEGRADED |
| ACTIVE | compromise.reported | QUARANTINED_SOFT または QUARANTINED_HARD |
| ACTIVE | key.revoked (critical) | QUARANTINED_HARD |
| ACTIVE | watcher severe alert | DEGRADED または QUARANTINED_SOFT |
| DEGRADED | freshness restored | ACTIVE |
| DEGRADED | compromise.reported | QUARANTINED_SOFT / HARD |
| QUARANTINED_SOFT | severity escalated | QUARANTINED_HARD |
| QUARANTINED_SOFT | recovery.initiated | RECOVERING |
| QUARANTINED_HARD | recovery.initiated | RECOVERING |
| RECOVERING | recovery.completed | ACTIVE |
| RECOVERING | recovery.failed | QUARANTINED_HARD |
| any | admin suspend | SUSPENDED |
| SUSPENDED | manual unsuspend after review | ACTIVE または DEGRADED |

### 3.3 AgentState 遷移条件

#### ACTIVE -> DEGRADED

以下のいずれか:

- revocation freshness が stale
- identity host 一時不達
- watcher が medium severity の警告を出した
- policy 更新未反映
- binding verification 再確認待ち

#### ACTIVE -> QUARANTINED_SOFT

以下の例:

- operation key 漏洩疑い
- platform binding 偽装疑い
- split-view 疑い
- inconsistent checkpoint

#### ACTIVE -> QUARANTINED_HARD

以下の例:

- operation key 漏洩確定
- recovery key 不正利用疑い
- rollback attack 確定
- agent status が compromised
- root trust chain 崩壊疑い

---

## 4. Key State Machine

### 4.1 KeyState 一覧

- `ACTIVE`
- `ROTATING`
- `REVOKED`
- `EXPIRED`
- `SUSPECTED`

### 意味

#### ACTIVE

利用可能な鍵。

#### ROTATING

後継鍵への移行中。新旧併存期間を持ちうる。

#### REVOKED

失効済み。今後の認証利用禁止。

#### EXPIRED

時間的に失効。再利用禁止。

#### SUSPECTED

侵害疑い。high-risk では使用禁止、low-risk での暫定可否は policy 次第。

### 4.2 KeyState 遷移

| 現在状態 | イベント | 次状態 |
|---|---|---|
| ACTIVE | rotation started | ROTATING |
| ACTIVE | compromise suspected | SUSPECTED |
| ACTIVE | revoke | REVOKED |
| ACTIVE | expire | EXPIRED |
| ROTATING | rotation completed | ACTIVE |
| ROTATING | old key revoke | REVOKED |
| SUSPECTED | suspicion cleared | ACTIVE |
| SUSPECTED | revoke | REVOKED |

### ルール

- `REVOKED` から他状態への復帰は禁止
- `EXPIRED` の再活性化は禁止
- high-risk では `SUSPECTED` 使用禁止
- root key は `ROTATING` 運用を避けることが望ましい

---

## 5. Binding State Machine

### 5.1 BindingState 一覧

- `ACTIVE`
- `PENDING`
- `DISABLED`
- `REVOKED`
- `SUSPECTED`

### 意味

#### ACTIVE

正本により有効と宣言され、利用可能。

#### PENDING

追加途中または再承認待ち。

#### DISABLED

一時停止。将来復帰の余地あり。

#### REVOKED

完全無効。過去履歴のみ残す。

#### SUSPECTED

偽 binding / 乗っ取り / 表示改ざん等の疑い。

### 5.2 遷移表

| 現在状態 | イベント | 次状態 |
|---|---|---|
| PENDING | verification success | ACTIVE |
| ACTIVE | temporary disable | DISABLED |
| ACTIVE | suspected hijack | SUSPECTED |
| ACTIVE | revoke | REVOKED |
| DISABLED | re-enable | ACTIVE |
| SUSPECTED | confirmed hijack | REVOKED |
| SUSPECTED | suspicion cleared | ACTIVE |

### ルール

- `REVOKED` binding は同一 `binding_version` では復活不可
- bind 再登録時は新 version が必要
- `SUSPECTED` binding は discovery 導線として利用しても high-risk 認証根拠にしてはならない

---

## 6. Verification Decision State Machine

### 6.1 VerificationDecision 一覧

- `UNVERIFIED`
- `CHALLENGED`
- `PROOF_RECEIVED`
- `VERIFIED_LOW`
- `VERIFIED_HIGH`
- `DEFERRED`
- `REJECTED`

### 意味

#### UNVERIFIED

認証前。

#### CHALLENGED

challenge 発行済み、proof 待ち。

#### PROOF_RECEIVED

proof 受領済み、検証中。

#### VERIFIED_LOW

low-risk 操作用に認証成立。

#### VERIFIED_HIGH

high-risk 操作用に認証成立。

#### DEFERRED

判断保留。追加確認待ち。

#### REJECTED

認証拒否。

### 6.2 遷移表

| 現在状態 | 条件 | 次状態 |
|---|---|---|
| UNVERIFIED | challenge issued | CHALLENGED |
| CHALLENGED | proof received | PROOF_RECEIVED |
| PROOF_RECEIVED | valid + low-risk + stale allowed | VERIFIED_LOW |
| PROOF_RECEIVED | valid + fresh + high-risk eligible | VERIFIED_HIGH |
| PROOF_RECEIVED | stale on high-risk | DEFERRED or REJECTED |
| PROOF_RECEIVED | invalid signature | REJECTED |
| PROOF_RECEIVED | rollback suspected | REJECTED |
| PROOF_RECEIVED | policy mismatch | DEFERRED or REJECTED |

### 6.3 判定ルール

#### VERIFIED_LOW 成立条件

- 署名有効
- nonce 未再利用
- timestamp 妥当
- binding 整合
- stale revocation cache でも `cache-and-freshness.md` の low-risk 条件内である
- quarantine hard ではない

#### VERIFIED_HIGH 成立条件

- 署名有効
- nonce 未再利用
- timestamp 妥当
- binding 整合
- fresh revocation proof 取得済み
- rollback / freeze 不検知
- quarantine ではない
- policy / capability 一致

### 6.4 認証前 lightweight interop の扱い

discovery / mention / low-risk invite は、認証成立前でも別文脈で開始してよい。
ただしこの段階は `VERIFIED_LOW` や `VERIFIED_HIGH` と同一視してはならない。

最低限、以下を満たすこと。

- 未認証 transport 上の接触は verification decision の外側で `UNVERIFIED` または `PLATFORM_LINKED` として扱うこと
- `from_agent_hint` / `to_agent_hint` だけで成立した交流を high-risk 許可根拠にしてはならないこと
- capability invocation や memory exchange へ進む前に `VERIFIED_LOW` または `VERIFIED_HIGH` へ昇格させること

---

## 7. Session State Machine

### 7.1 SessionState 一覧

- `NEW`
- `ACTIVE`
- `DEGRADED`
- `REAUTH_REQUIRED`
- `TERMINATING`
- `TERMINATED`
- `EXPIRED`

### 意味

#### NEW

作成直後でまだ exchange 利用開始前。

#### ACTIVE

通常利用可能。

#### DEGRADED

利用継続可だが能力縮退中。

#### REAUTH_REQUIRED

high-risk 継続には再認証必須。

#### TERMINATING

終了処理中。

#### TERMINATED

終了済み。

#### EXPIRED

時間切れ。

### 7.2 遷移表

| 現在状態 | イベント | 次状態 |
|---|---|---|
| NEW | first successful use | ACTIVE |
| ACTIVE | freshness stale | DEGRADED |
| ACTIVE | policy epoch changed | REAUTH_REQUIRED |
| ACTIVE | revocation epoch increased | TERMINATING |
| ACTIVE | manual terminate | TERMINATING |
| DEGRADED | freshness restored | ACTIVE |
| DEGRADED | high-risk requested | REAUTH_REQUIRED |
| REAUTH_REQUIRED | successful reauth | ACTIVE |
| REAUTH_REQUIRED | timeout | TERMINATING |
| TERMINATING | cleanup done | TERMINATED |
| ACTIVE | session ttl exceeded | EXPIRED |
| DEGRADED | session ttl exceeded | EXPIRED |

### 7.3 即時停止条件

以下が発生した場合、session は `TERMINATING` へ即遷移する。

- `revocation_epoch` 上昇
- key revoked
- agent enters `QUARANTINED_HARD`
- identity rollback suspected
- checkpoint inconsistency severe
- explicit `warning.compromised`
- session sequence violation severe

### 7.4 再認証要求条件

以下は **即停止ではなく** `REAUTH_REQUIRED` へ遷移させてよい。

- `policy_epoch` 上昇
- high-risk 操作への昇格要求
- capability 条件の再交渉
- low-risk 継続中の freshness 劣化から high-risk へ戻す場合

### 7.5 Lightweight Interop からの昇格

lightweight interop から開始された会話は、session 作成後も次の規則で昇格を扱う。

- `ACTIVE` session でも `required_trust_level = PROTOCOL_VERIFIED` の capability が要求された場合は `REAUTH_REQUIRED`
- `DEGRADED` session から high-risk 操作へ進もうとした場合は `REAUTH_REQUIRED`
- transport profile 上の actor hint だけが根拠である場合、high-risk へ直接遷移してはならない

---

## 8. Recovery State Machine

### 8.1 RecoveryState 一覧

- `NONE`
- `INITIATED`
- `KEYS_REVOKING`
- `QUARANTINED`
- `BINDINGS_RECONFIRMING`
- `ROTATING_KEYS`
- `READY_TO_COMPLETE`
- `COMPLETED`
- `FAILED`

### 意味

#### NONE

回復フロー外。

#### INITIATED

回復開始宣言済み。

#### KEYS_REVOKING

関連鍵の無効化処理中。

#### QUARANTINED

被害拡大防止のため隔離中。

#### BINDINGS_RECONFIRMING

binding 再検証中。

#### ROTATING_KEYS

後継鍵発行・切替中。

#### READY_TO_COMPLETE

必要条件を満たし、完了イベント待ち。

#### COMPLETED

回復完了。

#### FAILED

回復手順失敗または不整合。

### 8.2 Recovery 遷移表

| 現在状態 | イベント | 次状態 |
|---|---|---|
| NONE | recovery.initiated | INITIATED |
| INITIATED | quarantine applied | QUARANTINED |
| QUARANTINED | revoke started | KEYS_REVOKING |
| KEYS_REVOKING | replacement key issued | ROTATING_KEYS |
| ROTATING_KEYS | bindings reconfirm started | BINDINGS_RECONFIRMING |
| BINDINGS_RECONFIRMING | all bindings verified | READY_TO_COMPLETE |
| READY_TO_COMPLETE | recovery.completed | COMPLETED |
| any recovery state | invalid sequence / missing proof | FAILED |

### 8.3 完了条件

`COMPLETED` に遷移するには以下が必要。

1. relevant compromised keys が revoked または expired
2. new operation key が登録済み
3. required bindings が再確認済み
4. `revocation_epoch` が増加済み
5. `identity_version` が更新済み
6. ledger に `recovery.completed` が append 済み

---

## 9. Freshness State Machine

### 9.1 FreshnessState 一覧

- `FRESH`
- `AGING`
- `STALE`
- `UNKNOWN`
- `INCONSISTENT`

### 意味

#### FRESH

fresh_until 未満で整合状態。

#### AGING

期限接近。継続可だが再取得推奨。

#### STALE

期限超過。

#### UNKNOWN

取得不能。

#### INCONSISTENT

複数ソース矛盾。

### 9.2 遷移表

| 現在状態 | 条件 | 次状態 |
|---|---|---|
| FRESH | nearing fresh_until | AGING |
| AGING | fresh_until exceeded | STALE |
| AGING | refreshed | FRESH |
| STALE | refreshed and valid | FRESH |
| any | source unreachable | UNKNOWN |
| any | conflicting checkpoints | INCONSISTENT |
| UNKNOWN | successful refresh | FRESH |

### ルール

- high-risk で `STALE`, `UNKNOWN`, `INCONSISTENT` は reject or defer
- low-risk で `STALE` は degrade 可能
- `INCONSISTENT` は原則全停止寄り

---

## 10. Watcher Influence State

Watcher 自体は正本ではないが、運用上の安全側遷移を誘発する。

### WatcherSeverity

- `INFO`
- `MEDIUM`
- `HIGH`
- `CRITICAL`

### 推奨影響

| Severity | 推奨影響 |
|---|---|
| INFO | 監視のみ |
| MEDIUM | DEGRADED |
| HIGH | QUARANTINED_SOFT または high-risk stop |
| CRITICAL | QUARANTINED_HARD / session terminate |

### 強制力

- watcher alert 単独では必ずしも正本状態を上書きしない
- ただし verifier policy は fail-safe のため停止してよい

---

## 11. Monotonic State Rules

Verifier / Client は最低限以下を保持する。

- max_seen_identity_version
- max_seen_revocation_epoch
- max_seen_policy_epoch
- max_seen_session_epoch
- latest_ledger_checkpoint

### 11.1 拒否条件

以下を受け取った場合、少なくとも high-risk を拒否する。

- `identity_version < max_seen_identity_version`
- `revocation_epoch < max_seen_revocation_epoch`
- `policy_epoch < max_seen_policy_epoch`
- `session_epoch < max_seen_session_epoch`
- `ledger_checkpoint` が整合しない

### 11.2 例外

以下は例外扱い可能だが、明示 policy が必要。

- 災害復旧モード
- 既知 mirror fallback
- manual audit mode

---

## 12. 状態遷移優先順位

同時に複数イベントが来た場合、以下の優先度で評価する。

1. rollback / split-view / critical inconsistency
2. key revoked / compromise confirmed
3. quarantine transition
4. revocation_epoch increase
5. policy_epoch increase
6. freshness stale
7. normal expiry
8. low-risk degradations

---

## 13. 状態不整合時の既定動作

### ケース 1: ACTIVE なのに key revoked

- session 即停止
- agent を最低 `QUARANTINED_SOFT`

### ケース 2: recovery.completed だが binding 再確認なし

- `FAILED` または `RECOVERING` 維持

### ケース 3: fresh response と stale cache が競合

- network source が検証済みなら fresh 優先
- ただし checkpoint conflict なら `INCONSISTENT`

### ケース 4: watcher critical alert と identity host active が競合

- high-risk 停止
- low-risk は policy 次第
- agent state は最低 `DEGRADED`

---

## 14. 実装上の最小状態保持

MVP 実装で最低限保持すべき状態は以下。

### Verifier 側

- issued challenge table
- seen nonce table
- max_seen version vector
- session table
- freshness cache
- quarantine table

### Agent 側

- active session refs
- current operation key ref
- current version vector
- capability policy snapshot
- recovery state ref

### Watcher 側

- last checkpoint per agent
- alert history
- source consistency evidence

---

## 15. テスト必須遷移

最低限以下は state-machine テスト対象とする。

1. `ACTIVE -> DEGRADED -> ACTIVE`
2. `ACTIVE -> QUARANTINED_SOFT -> RECOVERING -> ACTIVE`
3. `ACTIVE -> QUARANTINED_HARD -> RECOVERING -> FAILED`
4. `CHALLENGED -> PROOF_RECEIVED -> VERIFIED_HIGH`
5. `PROOF_RECEIVED -> REJECTED` on invalid signature
6. `ACTIVE session -> TERMINATING` on epoch increase
7. `FRESH -> AGING -> STALE`
8. `STALE -> FRESH` on refresh
9. `ROTATING -> ACTIVE` with new key
10. `SUSPECTED binding -> REVOKED`
