# AITuber相互認証・交流プロトコル Threat Model v0.2-draft

## 0. TL;DR

本書は、AITuber相互認証・交流プロトコルに対する脅威、攻撃面、資産、信頼境界、防御方針を定義する。

本プロトコルの脅威モデルは次の考えを採る。

1. **SNSアカウントは侵害されうる**
2. **operation key は漏洩しうる**
3. **キャッシュは古くなる**
4. **監視者や relay も絶対には信用しない**
5. **高リスク操作は fresh proof 前提**
6. **台帳は監査のためであり、単独で遮断を担わない**
7. **rollback / freeze / split-view を一次脅威として扱う**

最重要防御対象は、単なる署名検証成功ではなく、
**「失効済み主体を有効と誤認しないこと」** である。

---

## 1. 文書情報

- 文書名: Threat Model
- バージョン: v0.2-draft
- ステータス: Draft
- 関連文書:
  - `requirements.md`
  - `scope.md`
  - `interfaces.md`
  - `../auth/state-machine.md`

---

## 2. 保護対象資産

### 2.1 Identity 資産

- `agent_id`
- `controller_id`
- `persona continuity`
- 正本 manifest
- platform binding 正当性
- key reference 正当性
- version / epoch の単調性

### 2.2 認証資産

- root key
- recovery key
- operation key
- session key
- nonce
- challenge state
- freshness proof
- verifier monotonic memory

### 2.3 運用資産

- active session
- capability grants
- quarantine status
- revocation cache
- session cache
- audit trail
- ledger checkpoint consistency

### 2.4 組織資産

- Controller の権限
- community trust
- official collaboration authority
- recovery legitimacy
- public reputation

---

## 3. 敵対者モデル

### 3.1 外部攻撃者

可能な能力:

- SNS アカウント乗っ取り
- phishing
- session token 窃取
- MITM
- stale cache を狙った timing 攻撃
- false binding 拡散
- replay
- credential stuffing

### 3.2 platform 内攻撃者

可能な能力:

- 表示名・プロフィール改ざん
- fake link 誘導
- account suspension / takeover
- bot 権限悪用
- role escalation

### 3.3 supply chain 攻撃者

可能な能力:

- dependency 汚染
- CI/CD 侵害
- update artifact 改ざん
- package typosquatting
- build pipeline 汚染

### 3.4 内部不正者

可能な能力:

- operation key 悪用
- recovery 流用
- 管理者認証の弱さを悪用した権限奪取
- binding 不正更新
- log 削除試行
- policy bypass

### 3.5 監視・台帳系攻撃者

可能な能力:

- split-view 提供
- partial withholding
- stale snapshot 配布
- checkpoint conflict 隠蔽
- watcher impersonation

---

## 4. セキュリティ目的

### 4.1 主要目的

1. SNS 侵害だけで protocol identity を奪取させない
2. key compromise 時に被害局所化できる
3. stale revocation による高リスク誤認可を防ぐ
4. recovery を identity continuity を保って実施できる
5. rollback / split-view を検知・阻止できる
6. 監査可能性を維持する

### 4.2 副次目的

- low-risk では過度に可用性を落とさない
- verifier 実装差で安全性が壊れにくい
- watcher / mirror を用いて不正可視化を高める

---

## 5. trust boundary

### 5.1 境界一覧

- platform boundary
- identity host boundary
- verifier boundary
- agent runtime boundary
- session boundary
- ledger boundary
- watcher boundary
- human operator boundary

### 5.2 各境界の前提

#### platform boundary
信頼しない。導線のみ。

#### identity host boundary
署名検証と monotonic check を通した場合のみ限定的に信頼。

#### verifier boundary
自身の local monotonic state を最も信頼する。

#### agent runtime boundary
侵害されうる。Instance と Agent を分離して考える。

#### ledger boundary
append-only と checkpoint を前提とするが、split-view 可能性は排除しない。

#### watcher boundary
警告源であって最終真実ではない。

#### human operator boundary
誤操作・内部不正を前提とする。

---

## 6. 攻撃面

### 6.1 discovery 面

- 偽プロフィールリンク
- typo URL
- mirror 詐称
- redirect 攻撃
- binding mismatch 誘導

### 6.2 auth 面

- replay
- forged proof
- nonce prediction
- clock skew abuse
- stale freshness 利用
- challenge substitution
- downgrade of risk
- session pubkey 差し替え

### 6.3 exchange 面

- message forgery
- sequence reordering
- replay on valid session
- capability escalation
- stale session reuse
- policy update spoofing

### 6.4 ledger 面

- omission
- split-view
- rollback snapshot
- fake checkpoint
- forged recovery completion
- selective delivery

### 6.5 recovery 面

- fake compromise report
- unauthorized recovery initiation
- malicious key rotation
- fraudulent binding reconfirm
- quarantine bypass

### 6.6 infrastructure 面

- host intrusion
- secret exfiltration
- CI tampering
- dependency poisoning
- DNS hijack
- CDN stale poisoning

---

## 7. 主要脅威一覧

---

## 7.1 SNSアカウント乗っ取り

### シナリオ

攻撃者が X / YouTube / Discord のアカウントを奪取し、本人を装う。

### 影響

- discovery 導線の改ざん
- 偽リンク配布
- 偽コラボ勧誘
- reputational damage

### 防御

- SNS を trust root にしない
- 正本 manifest を署名検証
- binding 単位で revoke 可能
- canonical URL / DID による確認
- high-risk では fresh revocation proof 必須

### 残余リスク

- discovery レベルの混乱
- 一時的な impersonation 成功
- ユーザー側 UX 依存の誤クリック

---

## 7.2 Operation Key 漏洩

### シナリオ

日常運用鍵が漏洩し、偽更新や偽署名に使われる。

### 影響

- manifest 改ざん
- binding 改ざん
- ledger event 偽発行
- identity continuity 毀損

### 防御

- root / recovery / operation 分離
- quarantine
- revocation epoch 増加
- key revoke / rotate
- watcher による unexpected rotation 検知
- short-lifetime sessions

### 残余リスク

- 漏洩から revoke までの短時間窓
- watcher 未配備環境での検知遅延

---

## 7.3 Session Key 奪取

### シナリオ

有効 session が窃取され再利用される。

### 影響

- session hijack
- message spoofing
- replay
- temporary unauthorized exchange

### 防御

- short-lived session
- sequence 管理
- session epoch
- terminate on revocation changes
- binding to proof context / intent
- reauth on high-risk

### 残余リスク

- セッション寿命内の悪用
- low-risk 操作の短期悪用

---

## 7.4 Replay Attack

### シナリオ

過去の proof / message / challenge を再送する。

### 影響

- 誤認証
- duplicate action
- invite / accept の不正再実行

### 防御

- nonce
- expiry
- seen-nonce storage
- message_id uniqueness
- sequence validation
- idempotency check

### 残余リスク

- verifier restart 時の state 喪失
- implementation bug による nonce table 欠損

---

## 7.5 Rollback Attack

### シナリオ

攻撃者が古い manifest / revocation state / checkpoint を見せる。

### 影響

- revoked key の再有効化誤認
- quarantined agent の通常運用化誤認
- 古い binding の再採用

### 防御

- monotonic state 保持
- max_seen identity_version / revocation_epoch
- ledger_checkpoint 比較
- old version reject
- high-risk fail-closed

### 残余リスク

- 初回接触時の prior knowledge 不足
- verifier local state 消失

---

## 7.6 Freeze Attack

### シナリオ

最新状態の取得を妨害し、相手に古いが一見正しい情報だけを使わせる。

### 影響

- stale revocation 利用
- recovery 未反映
- high-risk 誤認可

### 防御

- revocation cache 短TTL
- stale-if-error 禁止
- high-risk は fresh proof 必須
- pull 確認
- watchdog / alerting

### 残余リスク

- 可用性低下
- offline 環境での low-risk degrade 依存

---

## 7.7 Split-View on Ledger

### シナリオ

異なる verifier / watcher に異なる ledger view を見せる。

### 影響

- 一部コミュニティだけ誤状態認識
- recovery 完了の偽装
- revoke 隠蔽

### 防御

- checkpoint 比較
- 複数 watcher
- evidence refs
- conflict alert
- high severity で high-risk 停止

### 残余リスク

- watcher 単独運用時の検知不足
- 閉鎖コミュニティでの局所 split-view

---

## 7.8 Binding Impersonation

### シナリオ

攻撃者が platform binding を偽装、または偽 binding を配布する。

### 影響

- 別アカウントを正当個体に見せる
- 誤 discovery
- social engineering

### 防御

- binding status / version
- signed manifest
- source binding match
- binding revoke / disable
- high-risk で binding suspicious を拒否

### 残余リスク

- platform UI 上の混乱
- 人間が binding の意味を誤解するリスク

---

## 7.9 Compromised Recovery Flow

### シナリオ

攻撃者が recovery を悪用して identity を乗っ取る。

### 影響

- 正当 continuity の奪取
- 完全 hijack
- 永続的信頼崩壊

### 防御

- root / recovery の分離
- recovery event sequence strictness
- binding reconfirm
- mandatory ledger events
- watcher alert on invalid sequence
- manual approval / multi-party approval 推奨

### 残余リスク

- recovery key 自体の漏洩
- Controller 側運用ミス

---

## 7.10 Supply Chain Attack

### シナリオ

実装依存物が汚染される。

### 影響

- 鍵窃取
- log 削除
- silent bypass
- downgrade logic 差し替え

### 防御

- artifact signing
- dependency pinning
- CI hardening
- build provenance
- reproducible build 推奨
- isolated signing environment

### 残余リスク

- ゼロデイ
- signing pipeline 自体の侵害

---

## 7.11 Policy / Capability Mismatch Abuse

### シナリオ

攻撃者または不整合実装が、古い policy / capability digest を使って本来拒否される high-risk 操作を通そうとする。

### 影響

- capability 昇格の誤許可
- degraded 条件の回避
- policy 更新未反映のまま high-risk 継続

### 防御

- proof に対する `policy_epoch` と `capability_digest` の照合
- `POLICY_MISMATCH` の明示エラー
- policy 更新時の再認証要求
- high-risk で stale policy state を許容しない

### 残余リスク

- 実装間で capability taxonomy の解釈差が残る可能性
- policy 配布遅延による一時的 defer 増加

---

## 8. リスク分類

---

## 8.1 High-Risk 操作

- capability 昇格
- memory exchange
- platform binding 更新
- recovery initiation / completion
- root / recovery 系更新
- official collaboration acceptance
- ledger write 依頼
- identity transfer

### 要求防御

- fresh revocation proof
- non-stale identity state
- no quarantine
- no rollback suspicion
- policy match
- session valid + reauth as needed

---

## 8.2 Low-Risk 操作

- profile read
- hello
- capability inquiry
- public status notify
- low-impact chat

### 要求防御

- signature / MAC valid
- session not terminated
- stale state tolerated only if policy allows
- degraded mode allowed

---

## 9. 脅威ごとの対策マッピング

| 脅威 | 主対策 |
|---|---|
| SNS hijack | off-platform root, signed manifest, binding revoke |
| forged proof | challenge-response, signature validation |
| replay | nonce, expiry, sequence |
| rollback | monotonic state, version vector |
| freeze | short TTL, fail-closed on high-risk |
| split-view | checkpoint comparison, watchers |
| session hijack | short TTL, sequence, termination on epoch change |
| key compromise | key separation, revoke, rotate, quarantine |
| fake recovery | strict recovery sequence, ledger evidence |
| internal abuse | audit trail, multi-approval 推奨 |
| supply chain | signing, CI hardening, provenance |

---

## 10. 残余リスクと受容

本プロトコルは以下の残余リスクを完全には消せない。

### 10.1 discovery 混乱
SNS 上での一時的な誤導。

### 10.2 初回接触時の prior knowledge 不足
初見 verifier は rollback の比較基準が弱い。

### 10.3 local state loss
Verifier のローカル monotonic memory 消失時、rollback 検知力が落ちる。

### 10.4 human error
Controller / operator が誤回復、誤承認する可能性。

### 10.5 partial outage
high-risk を安全側に倒すことで可用性が落ちる。

これらは仕様でゼロにはできず、運用・UI・監査で補う。

---

## 11. 実装必須防御

以下は MVP でも MUST 相当とする。

1. signed manifest validation
2. challenge-response with nonce / timestamp / expiry
3. key separation
4. short-lived session
5. revocation freshness check
6. stale revocation high-risk deny
7. monotonic version tracking
8. compromise -> quarantine -> revoke -> recover sequence
9. append-only event log
10. error distinction for security-relevant failures
11. 管理者強固認証

---

## 12. 推奨追加防御

以下は SHOULD 相当。

- hardware-backed key storage
- multi-party recovery approval
- multiple watchers
- independent ledger mirror
- signed software release
- secure clock source
- anomaly detection on rotation frequency
- admin action audit review
- rate limit on recovery attempts
- bot permission minimization

---

## 13. 観測・監査要件

最低限以下の security event を監査対象とする。

- challenge issued
- proof rejected
- nonce replay detected
- key revoked
- unexpected key rotation
- binding changed
- quarantine entered / exited
- recovery initiated / completed / failed
- rollback suspected
- checkpoint conflict detected
- session force terminated

### 監査ログ要件

- tamper-evident であることが望ましい
- event type / actor / timestamp / outcome を残す
- high-risk 操作は必ず記録
- 個人情報や秘密を過剰に残さない

---

## 14. セキュリティ判定基準

### 良い実装の条件

- stale と revoked を混同しない
- ledger を auth の代替にしない
- freshness を first-class に扱う
- downgrade / degrade を明示的に管理する
- rollback 対策のため local monotonic state を保持する

### 悪い実装の例

- SNS handle 一致だけで本人扱いする
- identity cache を high-risk にそのまま使う
- revocation host 不達時に high-risk を継続する
- key revoke 後に既存 session を殺さない
- recovery.completed を単発イベントだけで信じる
- watcher alert を完全無視する

---

## 15. セキュリティレビューの観点

実装レビュー時は最低限以下を確認する。

1. nonce replay 防止は durable か
2. challenge / proof の fields は requirements 通りか
3. high-risk 判定経路で stale cache が混入しないか
4. revocation_epoch 増加で session が止まるか
5. rollback をどう検知するか
6. recovery sequence を飛ばせないか
7. binding 単位 revoke が効くか
8. platform adapter が trust root を上書きしていないか
9. internal admin API が bypass 経路になっていないか
10. watcher / ledger の異常が安全側に反映されるか

---

## 16. 今後深掘りすべき項目

- TEE / hardware attestation 連携
- privacy-preserving proofs
- federation trust contract
- distributed watcher quorum
- compromise severity taxonomy
- secure bootstrap for first-seen verifier
- safer human recovery ceremonies

---
