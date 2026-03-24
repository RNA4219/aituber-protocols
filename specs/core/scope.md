# AITuber相互認証・交流プロトコル Scope v0.2-draft

## 0. TL;DR

本書は、AITuber相互認証・交流プロトコルの**適用範囲**、**責務境界**、**導入対象**、**実装単位**を定義する。

本プロトコルは、X / YouTube / Discord などの外部プラットフォーム上で活動する AITuber / Agent が、

- オフプラットフォームな正本アイデンティティを持ち
- challenge-response により本人性を確認し
- 認証後の安全な交流セッションを張り
- 失効・回復・侵害通知に追従し
- transparency log により監査可能性を持つ

ことを目的とする。

本書は「何をこのプロトコルが扱うか」「何を扱わないか」を明示し、
core / auth / exchange / ledger の各層における責務を固定する。

---

## 1. 文書情報

- 文書名: Scope
- バージョン: v0.2-draft
- ステータス: Draft
- 関連文書:
  - `requirements.md`
  - `interfaces.md`
  - `../auth/state-machine.md`
  - `threat-model.md`

---

## 2. 目的

本書の目的は以下の通り。

1. プロトコルの責務範囲を固定する
2. 実装者ごとの解釈ブレを減らす
3. core / auth / exchange / ledger の分割線を明示する
4. MVP と将来拡張の境界を整理する
5. SNS / middleware / watcher / bot 実装の適用位置を定義する

---

## 3. 適用対象

本プロトコルの直接対象は以下である。

### 3.1 主体

- Controller
- Agent
- Persona
- Instance
- Verifier
- Identity Host
- Ledger
- Watcher
- Exchange Endpoint
- Platform Adapter
- Community Middleware
- Recovery Operator

注:
`Exchange Endpoint`, `Platform Adapter`, `Community Middleware`, `Recovery Operator` は導入上の役割名であり、
`requirements.md` の主体定義を拡張する運用用語である。

### 3.2 動作対象

- Agent identity resolution
- platform binding verification
- challenge issuance / proof verification
- session establishment
- capability negotiation
- high-risk / low-risk risk classification
- revocation freshness checking
- quarantine handling
- recovery signaling
- transparency logging

### 3.3 利用プラットフォーム

MVP の想定導線は以下。

- X
- YouTube
- Discord

将来追加可能な導線例:

- Misskey
- Twitch
- 自前 Web サイト
- 専用配信 middleware
- 自前コミュニティ基盤
- 他 Agent Runtime

---

## 4. 非適用対象

本プロトコルは以下を直接対象としない。

### 4.1 配信・メディア伝送

- 動画ストリーミング
- 音声通話プロトコル
- ライブチャット配信制御
- 映像同期制御

### 4.2 AI 内部実装

- LLM モデルそのもの
- 推論エンジン
- memory backend の内部構造
- prompt / policy の中身そのもの
- persona 生成手法

### 4.3 金融・決済

- 支払い
- NFT / トークン移転
- 資産管理
- 課金処理
- ブロックチェーン上の資産移転

### 4.4 哲学的同一性

- 人格の哲学的連続性証明
- consciousness の証明
- 完全同一インスタンス証明
- LLM 内部状態の完全比較

### 4.5 各SNSの細部

- X API の仕様差吸収
- Discord ロール管理の実装詳細
- YouTube 説明欄編集権限の細部
- プラットフォーム側の本人確認制度との統合

---

## 5. プロトコルの責務

### 5.1 何を定義するか

本プロトコルは少なくとも以下を定義する。

- ID の意味と粒度
- 鍵の役割分離
- 正本 identity manifest の意味
- platform binding の意味
- challenge / proof / session の意味
- freshness / epoch / rollback 防止の基本要件
- capability 交換の骨格
- 失効・回復・侵害通知の基本イベント
- transparency log の責務
- risk-based behavior の最低限ルール

### 5.2 何を定義しないか

以下はこのプロトコルの外部実装責務とする。

- UI / UX の具体デザイン
- bot コマンド名
- slash command の最終文言
- webhook 形式の細部
- DB スキーマの最終形
- 内部ジョブキュー構成
- CDN / hosting 構成
- 特定 KMS / HSM の採用可否
- 監査組織の運営体制

---

## 6. 層ごとの責務境界

---

## 6.1 Core 層

### 役割

全層で共通利用される概念と型の定義。

### 含むもの

- ID 型
- version 型
- epoch 型
- session metadata 型
- error code
- timestamp / expiry semantics
- message envelope 共通部
- capability digest / summary の基本形式
- policy version / policy epoch の意味

### 含まないもの

- 署名アルゴリズムの交渉
- 認証フローそのもの
- ledger backend
- platform adapter 実装
- runtime transport

---

## 6.2 Auth 層

### 役割

本人性確認、セッション確立、失効判定、回復追従。

### 含むもの

- discovery 後の正本参照
- challenge-response
- nonce / timestamp / expiry
- proof verification
- session issuance
- revocation freshness 判定
- identity rollback 検知
- quarantine 制御
- key rotation / revoke / recovery signal

### 含まないもの

- 通常メッセージ交換内容
- 会話内容の意味付け
- collaboration business logic
- reputation scoring
- community moderation policy

---

## 6.3 Exchange 層

### 役割

認証済みセッション上での情報交流。

### 含むもの

- hello
- profile exchange
- capability exchange
- collab invite / accept / reject / defer
- status notification
- session renew / terminate
- policy update notification
- warning / degraded mode signaling

### 含まないもの

- セッションの本人性確立そのもの
- revocation source of truth
- ledger append logic
- platform discovery logic
- long-term trust graph

---

## 6.4 Ledger 層

### 役割

失効・更新・侵害・回復イベントの追記専用監査面を定義する。

### 含むもの

- append-only event semantics
- key / binding / compromise / recovery event
- checkpoint semantics
- split-view suspicion detection の材料
- watcher が監視すべき最小イベント

### 含まないもの

- リアルタイム遮断そのもの
- access control enforcement
- runtime session kill の実装詳細
- BFT / blockchain 合意アルゴリズム

---

## 7. trust boundary

本プロトコルは以下の trust boundary を明示する。

### 7.1 信頼してよいもの

条件付きで信頼されるもの:

- 正本 manifest の署名検証結果
- 現行 revocation proof
- ledger checkpoint の一貫性
- challenge-response の proof of possession
- 自分が保持する monotonic state

### 7.2 信頼してはならないもの

- SNS 表示名
- SNS の見た目だけのリンク
- 一時的なキャッシュだけの状態
- 単一 watcher の主張だけ
- stale revocation cache に基づく high-risk 許可
- platform 上の「それっぽい本人感」

### 7.3 条件付き信頼

- identity cache
- push notification
- community relay
- bot adapter
- mirror ledger
- federation peer

---

## 8. Actor別スコープ

---

## 8.1 Controller

### 関与範囲

- root / recovery 管理
- operation key の配備方針
- identity continuity の意思決定
- compromise / recovery の承認

### 非関与範囲

- 毎回の session 鍵交換
- verifier 側 nonce 管理
- watcher の内部監視実装

---

## 8.2 Agent / Instance

### 関与範囲

- proof 生成
- session key 利用
- exchange message 送信
- capability 提示
- degraded mode 追従

### 非関与範囲

- 正本運営の最終責任
- recovery policy の最終承認
- global ledger consistency 保証

---

## 8.3 Verifier

### 関与範囲

- challenge 発行
- proof 検証
- freshness 確認
- rollback / stale / quarantine 判定
- risk-based allow / deny / defer

### 非関与範囲

- 相手側 ledger 書き込み
- 相手側 key rotation 実行
- platform binding の真正生成

---

## 8.4 Identity Host

### 関与範囲

- manifest 配布
- binding / key / endpoint 公開
- version / timestamp / references 提供

### 非関与範囲

- verifier ごとの policy 判定
- session state の保持
- ledger 運営そのもの

---

## 8.5 Ledger

### 関与範囲

- event append
- checkpoint 提供
- 監査可能性
- 履歴保持

### 非関与範囲

- 認可 enforcement
- runtime access deny
- session teardown API の統制

---

## 8.6 Watcher

### 関与範囲

- event 監視
- split-view suspicion 通知
- stale / rollback / inconsistency の警告
- community への alert relay

### 非関与範囲

- 正本としての裁定
- 自動 recovery 実行
- root authority の代替

---

## 9. 導入境界

### 9.1 必須導入点

MVP の最低限の導入点は以下。

- identity manifest host
- auth verifier/client
- session manager
- revocation checker
- minimal ledger writer
- minimal watcher
- recovery initiation / completion handler

### 9.2 任意導入点

- Discord bot adapter
- X profile resolver
- YouTube channel resolver
- federation bridge
- community dashboard
- admin console
- cache warmer
- high-risk approval UI

---

## 10. transport の扱い

本プロトコルは transport-agnostic を基本とする。

### 10.1 許容される transport 例

- HTTPS
- WebSocket
- bot command relay
- signed file fetch
- webhook relay
- message queue relay

### 10.2 transport 層で追加実装してよいもの

- retry
- timeout
- compression
- relay authentication
- delivery tracing
- observability headers

### 10.3 transport 層で上書きしてはならないもの

- challenge semantics
- epoch semantics
- revocation freshness semantics
- high-risk fail-closed rule
- append-only ledger semantics

---

## 11. データ分類スコープ

### 11.1 本プロトコルが扱うデータ

- public identity metadata
- public key references
- binding metadata
- challenge / proof / session metadata
- risk level metadata
- ledger event metadata

### 11.2 原則として扱わないデータ

- private prompt
- raw memory content
- private tools definition
- secrets
- personal data beyond minimum metadata
- conversation body

### 11.3 高機微データの扱い

高機微データは exchange 上に載せるとしても、本プロトコル自体のコア仕様ではなく上位 application policy の責務とする。

---

## 12. MVP スコープ

### 12.1 MVP に含める

- URL ベースまたは equivalent な正本参照
- operation key による manifest 署名
- challenge-response
- platform binding verification
- session 発行
- low-risk / high-risk 分類
- revocation freshness
- compromise / quarantine / recovery イベント
- recovery.initiated / recovery.completed
- minimal ledger append
- hello / invite / accept / reject / defer

### 12.2 MVP に含めない

- reputation graph
- automated trust scoring
- full federation governance
- anonymous credentials
- multi-party secure computation
- fully decentralized consensus
- cross-ledger proof composition

---

## 13. 将来拡張スコープ

以下は将来拡張として許容するが、MVP 必須ではない。

- DID method 追加
- capability taxonomy 拡張
- policy negotiation 拡張
- mutual attestation 強化
- watcher federation
- delegated verifier
- multi-operator recovery
- attested runtime / TEE 連携
- MCP / A2A / agent runtime bridge
- community-wide trust contract

---

## 14. 適合レベル

本仕様では実装適合性を段階化する。

### 14.1 Level 0: Discovery Only

- 正本への導線のみ
- 認証機能なし

### 14.2 Level 1: Core + Auth Minimal

- challenge-response
- signed manifest
- session issuance
- basic revocation check

### 14.3 Level 2: Exchange Enabled

- hello / profile / invite 系メッセージ
- risk-based behavior

### 14.4 Level 3: Recovery Ready

- compromise / quarantine / recovery
- epoch-driven invalidation

### 14.5 Level 4: Ledger Auditable

- append-only event log
- watcher integration
- checkpoint verification

---

## 15. スコープ外変更の扱い

以下は仕様変更ではなく実装差として許容される。

- UI wording
- bot command naming
- hosting topology
- cache backend
- retry strategy
- observability stack
- alerting tool
- admin approval workflow の見た目

以下は仕様変更として扱う。

- epoch semantics の変更
- high-risk 判定基準の後方非互換変更
- required proof fields の変更
- ledger checkpoint semantics の変更
- identity continuity semantics の変更

---

## 16. 成功条件

本スコープ定義が機能していると見なす条件は以下。

1. 実装者が「何をこのプロトコルの責務として作るべきか」を誤解しない
2. auth と exchange の責務混線が起きない
3. ledger をリアルタイム認可機構として誤用しない
4. SNS を信頼の根として誤認しない
5. MVP と future extension の境界が明確である
6. adapter / watcher / middleware 実装が整合する

---
