# AITuber相互認証・交流プロトコル 要件定義 v0.2-draft

## 0. TL;DR

本仕様は、X / YouTube / Discord / Twitch 上で活動する AITuber 同士が、

* **5秒程度以内で相互認証**
* **プラットフォーム横断で同一個体を認識**
* **乗っ取り・鍵漏洩・ロールバック・キャッシュ失効競合に耐性**
* **認証後に安全な情報交流・コラボ交渉**
* **コミュニティ横断の透明性ログで監査可能**

となることを目的とする。

加えて、本仕様は単なる本人確認基盤ではなく、
**実装や設計思想の異なる AITuber 同士が、最低限の共通手順で相互運用できること**
を目的に含む。

そのため本仕様は、認証・失効・回復だけでなく、

* **軽量な共通メッセージ仕様**
* **プラットフォームごとの transport profile**
* **MCP / Skill 等への接続を前提とした capability bridge**

を扱う。

特に、Twitch / YouTube / Discord 等のチャット欄は、
高信頼な正本ではなくとも、
**discovery / mention / lightweight coordination を行うための簡易 transport**
として有用である。

基本方針は次の通り。

1. **SNSは信頼の根にしない**
2. **正本アイデンティティはオフプラットフォームに置く**
3. **本人確認は公開鍵署名ベースの challenge-response**
4. **認証と交流は分離する**
5. **台帳は「検知」、失効は「遮断」と責務分離する**
6. **鍵交換や複雑な手順をユーザーに見せない**
7. **侵害前提で失効・回復・隔離を最初から設計する**

---

# 1. 文書情報

* 文書名: AITuber相互認証・交流プロトコル 要件定義
* バージョン: v0.2-draft
* ステータス: Draft
* 想定対象:

  * AITuber運営者
  * エージェント開発者
  * コミュニティ運営者
  * 透明性ログ運営者
  * 連携bot / middleware 実装者

---

# 2. 背景

AITuber は複数プラットフォームで活動するが、現状は以下の問題がある。

* X / YouTube / Discord のアカウント表示だけでは本人性を十分に保証できない
* SNSアカウントの乗っ取りと、個体そのものの認証が分離されていない
* コラボ・相互連携時に、誰が誰かを短時間で確認しづらい
* プラットフォームごとに別の認証手順を要求するとUXが崩れる
* 鍵更新・失効・侵害告知・回復の共通運用がない
* コミュニティ間で信頼状態を共有・監査する枠組みがない
* キャッシュと失効の競合により、失効済み個体を一時的に信じてしまう危険がある

---

# 3. 目的

## 3.0 追加目的

本仕様は、AITuber の本人確認だけを目的としない。
より上位の目的として、**開発者ごとに実装差・思想差・特化差がある AITuber 同士が、最低限の共通プロトコルにより連携できること** を扱う。

具体的には、以下を可能にすることを追加目的とする。

* 異なる AITuber 実装同士が共通の message type で会話開始できること
* Twitch / Discord / X / YouTube 等を transport として利用できること
* transport ごとの差を profile として吸収できること
* 認証なしでも low-risk な discovery / hello / invite が成立すること
* 必要時のみ auth / revocation / quarantine を伴う stronger trust へ移行できること
* 認証後の能力呼び出し先として MCP / Skill / 独自 API を接続できること

## 3.1 主目的

* AITuber 同士が **5秒以内を目標** に相互認証できること
* 認証後に安全なセッションを張り、情報交流できること
* X / YouTube / Discord を跨いでも、同一個体を同じ正本IDで解決できること
* SNSアカウント単体の乗っ取りと、個体認証を切り離せること
* 侵害時に、**失効・隔離・回復** を迅速に行えること

## 3.2 副次目的

* コミュニティ間で監査可能な透明性ログ基盤を持てること
* 将来は AITuber を超えて Agent-to-Agent の汎用プロトコルへ拡張可能であること
* 認証後の交流層として MCP 等を後段接続できること

---

# 4. 非目的

本仕様は以下を直接の対象としない。

* 映像・音声ストリーミングそのものの標準化
* LLM 内部状態の完全同一性保証
* 人格の哲学的同一性証明
* 各SNS公式APIの完全規格化
* ブロックチェーン前提の実装
* 金融決済や資産移転のプロトコル化
* 大規模分散台帳の合意アルゴリズムそのもの
* 全 AITuber 実装の内部アーキテクチャ統一
* 全開発者に単一フレームワークを強制すること
* すべての交流を高信頼認証必須にすること
* 既存プラットフォームのチャット欄を完全に安全な通信路として扱うこと

---

# 5. 設計原則

1. **Trust Root Off-Platform**
   信頼の根は X / YouTube / Discord の外に置く。

2. **Discovery on Platform**
   SNS は発見・導線・公開リンクの場とする。

3. **Proof of Possession**
   秘密鍵を現時点で保持していることを challenge-response で示す。

4. **Identity / Capability / Session 分離**
   「誰か」「何ができるか」「今の通信」を分けて扱う。

5. **Compromise First**
   侵害は起きる前提で、失効・隔離・回復を必須要件とする。

6. **Human Invisible Crypto**
   鍵交換や署名手順をUXに露出しない。

7. **Freshness Matters**
   認証できること以上に、「今も有効か」を重視する。

8. **Append-Only Audit**
   台帳は追記専用で監査可能にする。

9. **Fail Soft for Low Risk / Fail Closed for High Risk**
   低リスク操作と高リスク操作で厳格さを分ける。

10. **Interop First for Low-Risk**
    低リスクな発見・挨拶・招待は、まず相互運用可能であることを優先する。

11. **Transport Agnostic**
    メッセージの意味と transport を分離し、Twitch / Discord / X / YouTube などへ写像可能にする。

12. **Capability Bridge**
    認証後の実行能力は、MCP / Skill / API / 独自 tool を bridge 経由で接続可能にする。

13. **Chat Is a Lightweight Rendezvous**
    配信チャット欄は、信頼の根ではなく、軽量な rendezvous / mention / routing の場として活用できる。

14. **Escalate Trust Only When Needed**
    すべての通信に強い認証を要求せず、low-risk から high-risk に移る時のみ stronger trust を要求する。

---

# 6. 用語

## 6.1 主体

### Controller

AITuber の所有・運営責任主体。個人、チーム、法人を含む。

### Agent

AITuber 個体そのもの。継続的に認識される主体。

### Persona

Agent の人格系列・演出系列・設定系列。

### Instance

その時点で稼働している実行インスタンス。Agent と1対多。

### Verifier

相手を認証する主体。

### Registry / Identity Host

正本アイデンティティ情報をホストする場所。

### Ledger / Transparency Log

追記専用のイベントログ。

### Watcher

透明性ログや失効イベントを監視する主体。

---

# 7. 対象プラットフォーム

* X
* YouTube
* Discord
* Twitch

将来的に追加対象となる例:

* Misskey
* Web site / own domain
* 配信用 middleware
* 自前コミュニティサーバ

---

# 8. 想定ユースケース

## 8.1 初回接触

X 上で AITuber A が AITuber B を発見し、正本IDを辿って数秒以内に本物か確認する。

## 8.2 Discord コミュニティ交流

参加エージェントが Discord 上の bot / slash command 経由で認証済みであることを提示し、コラボ用チャンネルへ入室する。

## 8.3 YouTube 公式確認

YouTube チャンネル概要欄のリンクから正本IDへ遷移し、チャンネルが乗っ取られていても protocol 上の本人性を検証できる。

## 8.4 高リスク操作

コラボ承認、能力昇格、メモリ共有、公式束縛更新などは fresh revocation proof を要求する。

## 8.5 侵害対応

鍵漏洩や乗っ取り発覚後、失効イベントを発行し、既存セッションを停止し、新鍵へ回復する。

## 8.6 コミュニティ間監査

複数コミュニティが透明性ログのコピーを持ち、矛盾や split-view を検知する。

## 8.7 軽量チャット連携

Twitch / YouTube 等のチャット欄において、
AITuber A が `target_agent_id` を含むメッセージを投稿し、
AITuber B がそれを検知して応答する。

このときチャット欄は軽量 transport として機能し、
必要に応じて後段で stronger auth へ移行できる。

## 8.8 異種実装間の連携

ある AITuber は MCP ベース、
別の AITuber は Skill ベース、
さらに別の AITuber は独自 API ベースで動作していても、
共通の capability summary と invocation request を通じて、
最低限の招待・受諾・依頼・応答ができる。

## 8.9 配信中コラボ誘導

配信中にチャット欄で相手 AITuber の ID を mention し、
軽量な invite を送り、
詳細な交渉や high-risk 操作は Discord bot や正本 endpoint にエスカレーションする。

---

# 9. システム全体像

本仕様は論理的に以下の7層で構成する。

## 9.1 Core

* 共通型
* ID
* バージョン
* エラー
* capability
* session metadata
* epoch / version

## 9.2 Auth

* Agent の本人確認
* challenge-response
* 鍵更新
* 失効
* 回復
* platform binding
* freshness 判定

## 9.3 Exchange

* 認証済みセッション上の情報交流
* 挨拶
* 招待
* 承認 / 拒否 / 保留
* profile / status 共有
* capability negotiation

## 9.4 Ledger

* append-only event
* 鍵追加 / 失効 / 侵害告知
* platform binding 更新
* recovery 完了
* 一貫性監査

## 9.5 Interop

* 実装差を超えて通る最小共通メッセージ仕様
* low-risk な hello / mention / invite / ack / error
* target / reply / correlation の表現
* transport 非依存な envelope

## 9.6 Transport Profile

* Twitch chat
* YouTube live chat
* Discord bot / webhook / slash command
* X post / mention / DM

各 transport は、共通 message をその媒体制約に合わせて写像する profile を持つ。

## 9.7 Capability Bridge

* MCP
* Skill
* 独自 API
* tool invocation

認証後または許可後に、どの能力実装へ接続するかを抽象化する層。

---

# 10. ID モデル要件

## 10.1 必須識別子

各 Agent は最低限以下を持つこと。

* `controller_id`
* `agent_id`
* `persona_id` または `persona_profile_hash`
* `instance_id`

## 10.2 ID の意味

### controller_id

所有・責任主体を表す。

### agent_id

継続する個体識別子。SNSアカウントより上位。

### persona_id / persona_profile_hash

人格系列・設定系列の継続性把握用。

### instance_id

その時点の実体。再起動・別マシン・冗長構成で変化し得る。

## 10.3 要件

* 同一 Controller が複数 Agent を持てること
* 同一 Agent が複数 Instance を持てること
* Persona の変更が追跡可能であること
* agent_id はプラットフォームから独立していること

---

# 11. 鍵モデル要件

## 11.1 鍵の分離

少なくとも次の鍵を分離する。

### Root Key

* 最上位鍵
* 回復と最終的な信頼更新用
* 原則オフライン保管

### Operation Key

* 日常運用用
* platform binding 更新
* manifest 更新
* ledger event 署名

### Session Key

* 短命
* challenge-response 後のセッション専用

### Recovery Key

* 緊急回復専用
* root と別管理でもよい

## 11.2 要件

* root key は日常通信に使わないこと
* operation key の漏洩で root key まで連鎖破壊しないこと
* session key は短命であること
* 緊急失効可能であること
* ローテーション可能であること

---

# 12. 正本アイデンティティ要件

## 12.1 基本方針

正本はオフプラットフォームに置く。

## 12.2 具体要件

各 Agent は以下を外部公開できること。

* 正本 manifest
* 公開鍵情報
* platform binding 情報
* service endpoint
* capability summary
* policy version
* revocation status 参照先
* ledger 参照先
* 更新時刻 / 版数

## 12.3 正本の条件

* URL または DID などで一意に参照可能
* 機械可読
* 署名検証可能
* キャッシュ可能
* 更新・失効・回復に追従可能

---

# 13. プラットフォーム束縛要件

## 13.1 基本方針

X / YouTube / Discord は本人性の根ではなく、**Agent の属性** として扱う。

## 13.2 必須要件

* 1つの Agent に複数 platform account を紐づけ可能
* 追加・削除・更新が可能
* 更新は operation key 以上で署名必須
* binding 情報は正本 manifest から参照可能
* 乗っ取り時に binding 単位で無効化できること

## 13.3 表現例

* `platform = x`
* `platform = youtube`
* `platform = discord`

各 binding は最低限以下を持つ。

* `platform_type`
* `platform_account_id`
* `display_handle`
* `binding_status`
* `verified_at`
* `bound_by_key_id`
* `binding_version`

---

# 14. 相互認証プロトコル要件

## 14.1 方式

* challenge-response
* 公開鍵署名検証
* nonce 必須
* timestamp 必須
* expiry 必須
* replay 対策必須

## 14.2 認証フロー

1. 発見
2. 正本参照
3. challenge 発行
4. proof 返却
5. 検証
6. セッション発行
7. capability / policy 確定
8. exchange 層へ移行

## 14.3 認証に含める情報

最低限次を proof 対象に含めること。

* `agent_id`
* `instance_id`
* `nonce`
* `timestamp`
* `expires_at`
* `session_pubkey`
* `intent`
* `capability_digest`
* `revocation_epoch`
* `identity_version`

## 14.4 性能要件

* 初回認証: **5秒以内目標**
* 再認証: **2秒以内目標**
* ネットワーク不安定時も、低リスク操作では degrade 動作可能

## 14.5 認証失敗理由

以下を区別できること。

* `INVALID_SIGNATURE`
* `NONCE_EXPIRED`
* `TIMESTAMP_INVALID`
* `KEY_REVOKED`
* `BINDING_MISMATCH`
* `POLICY_MISMATCH`
* `STALE_REVOCATION_CACHE`
* `SESSION_EPOCH_OLD`
* `IDENTITY_ROLLBACK_DETECTED`
* `AGENT_QUARANTINED`

---

# 15. Interop / Transport / Capability Bridge 要件

## 15.1 目的

Interop 層は、実装や開発方針の異なる AITuber 同士が、
最低限の共通メッセージで相互運用するための層である。

この層は、強い本人確認がなくても low-risk な交流を開始できることを目的とする。

## 15.2 最低限の共通メッセージ種別

最低限、以下を表現できること。

* `hello`
* `mention`
* `invite`
* `accept`
* `reject`
* `defer`
* `ack`
* `error`
* `status`
* `capability.summary`
* `capability.invoke.request`
* `capability.invoke.response`

## 15.3 共通 envelope 要件

各 interop message は最低限以下を持つ。

* `protocol_version`
* `message_id`
* `message_type`
* `from_agent_hint`
* `to_agent_hint`
* `transport_message_ref`
* `timestamp`
* `intent`
* `correlation_id`
* `reply_to`
* `payload`

注:
`from_agent_hint` および `to_agent_hint` は、
strongly verified identity でなくてもよいが、
可能であれば `agent_id` に解決できる形式を持つことが望ましい。

## 15.4 trust level

Interop message は少なくとも以下の trust level を持てること。

* `unverified`
* `platform-linked`
* `protocol-verified`

### unverified

プラットフォーム上で観測されたが、正本確認をまだ行っていない状態。

### platform-linked

プラットフォームアカウントと正本 binding の解決が済んでいる状態。

### protocol-verified

challenge-response 等により protocol 上の本人性まで確認済みの状態。

## 15.5 要件

* low-risk な交流開始は `unverified` または `platform-linked` でも可能
* high-risk 操作は `protocol-verified` を要求できる
* 実装依存の追加フィールドを許容しつつ、共通フィールドを壊さないこと
* transport 依存の表現差を上位意味から分離すること

## 15.6 Transport Profile 要件

各 platform は transport profile として定義できること。

transport profile は最低限以下を定義する。

* actor の識別方法
* target 指定方法
* reply / thread の表現
* message size 制約
* delivery visibility
* ordering 保証の弱さ
* rate limit
* structured payload の埋め込み方法
* fallback 導線

## 15.7 Twitch Chat Profile

Twitch chat profile は、少なくとも以下を想定できること。

* `user_id` または同等識別子を actor hint として利用可能
* コメント本文中に `to_agent_hint` を埋め込める
* 短文ベースの lightweight message を送受信できる
* reply 構造が弱いことを前提に `correlation_id` を本文または metadata に埋め込める
* 長文や high-risk 交渉は外部 endpoint へ誘導できる

Twitch chat は、信頼の根ではなく、discovery / mention / lightweight coordination に用いる。

## 15.8 Discord Profile

Discord profile は、bot / webhook / slash command により、
より構造化された interop message を扱えること。

## 15.9 YouTube Live Chat Profile

YouTube live chat profile は Twitch 同様、
lightweight coordination を主用途とし、
高信頼認証や詳細交渉は外部導線にエスカレーション可能であること。

## 15.10 X Profile

X profile は mention / post / DM を通じた discovery に用いられる。
公開性や文字数制約を考慮し、
詳細 payload は参照先 URL や短縮表現へ委譲可能であること。

## 15.11 Capability Bridge 要件

認証後または許可後の能力実行は、
MCP / Skill / API / 独自 tool を抽象化した bridge を通じて接続可能であること。

bridge は最低限、以下を表現できること。

* `bridge_type`
* `invocation_mode`
* `capability_name`
* `requires_verification`
* `risk_level`
* `endpoint_ref` または equivalent locator

---

# 16. セッション要件

## 16.1 セッション属性

各セッションは最低限以下を持つ。

* `session_id`
* `agent_id`
* `instance_id`
* `issued_at`
* `expires_at`
* `session_epoch`
* `revocation_epoch`
* `policy_epoch`
* `sequence`

## 16.2 要件

* セッションは短命であること
* 再利用検知できること
* sequence により順序管理できること
* epoch 不一致時に即失効できること
* capability downgrade を適用可能であること

## 16.3 強制停止要件

以下で既存セッションを停止できること。

* 鍵失効
* 侵害告知
* revocation_epoch 上昇
* policy_epoch 上昇
* high-risk 再承認要求

---

# 17. 情報交流プロトコル要件

この章でいう exchange message は、
**認証済み session 上で送受信する message** を指す。
第15章の interop message は pre-auth / low-risk を含む軽量交流であり、
同名に近い message でも trust 前提と required field が異なる。

## 17.1 最低限のメッセージ種別

* `hello`
* `profile.request`
* `profile.response`
* `capability.request`
* `capability.response`
* `capability.invoke.request`
* `capability.invoke.response`
* `collab.invite`
* `collab.accept`
* `collab.reject`
* `collab.defer`
* `status.notify`
* `session.renew`
* `session.terminate`
* `warning.compromised`
* `policy.update`

## 17.2 各メッセージの共通項目

* `protocol_version`
* `message_id`
* `message_type`
* `session_id`
* `agent_id`
* `instance_id`
* `timestamp`
* `sequence`
* `signature_or_mac`

## 17.3 capability モデル要件

最低限、以下のような権限表現が可能であること。

* `chat.basic`
* `profile.read`
* `status.share`
* `collab.invite`
* `collab.accept`
* `memory.exchange.summary_only`
* `memory.exchange.none`
* `tool.call.none`
* `tool.call.limited`

## 17.4 高リスク交流

以下は high-risk として扱う。

* memory exchange
* capability 昇格
* platform binding 変更
* ledger write 依頼
* root / recovery 系操作
* identity 引継ぎ
* 公式コラボ承認

high-risk 操作では fresh revocation proof を必須とする。

## 17.5 交流の段階

交流は少なくとも次の段階を持てること。

1. discovery
2. lightweight interop
3. stronger verification
4. capability negotiation
5. capability invocation

### discovery

プラットフォーム上で相手を見つける段階。

### lightweight interop

low-risk な hello / invite / mention を行う段階。

### stronger verification

必要に応じて正本解決・challenge-response を行う段階。

### capability negotiation

相手が何をできるかを確認する段階。

### capability invocation

MCP / Skill / API 等を通じて具体能力を呼び出す段階。

## 17.6 capability summary 要件の拡張

capability summary は、単なる権限名だけでなく、
必要に応じて以下を含められること。

* `capability_name`
* `capability_kind`
* `invocation_mode`
* `risk_level`
* `requires_verification`
* `bridge_type`

### bridge_type 例

* `mcp`
* `skill`
* `http_api`
* `local_tool`
* `custom`

## 17.7 capability invocation request

最低限、以下を表現できること。

* 呼び出したい capability 名
* 引数または引数参照
* 呼び出し元意図
* 必要な trust level
* 応答先
* タイムアウト方針

## 17.8 high-risk への昇格

low-risk な transport 上で開始された交流でも、
以下に該当する場合は stronger verification に昇格できること。

* memory exchange
* capability 昇格
* 外部 tool 実行
* 公式コラボ承認
* identity / binding 更新
* ledger 書き込み依頼

---

# 18. キャッシュ整合性・失効競合要件

この章は v0.2 で新設した重要要件である。

## 18.1 背景

最も危険なのは、
**「失効済みなのに古いキャッシュが残っている」** 状態である。

そのため、認証成功の有無だけでなく、
**その認証判断が今も新鮮か** を扱う必要がある。

## 18.2 キャッシュの分離

キャッシュは最低限以下の3種に分離すること。

### Identity Cache

* 公開鍵
* service endpoint
* platform binding
* identity_version

### Revocation Cache

* key status
* agent status
* revocation_epoch
* quarantine status
* fresh_until

### Session Cache

* session_id
* nonce state
* sequence
* session_epoch

## 18.3 基本原則

* identity cache は比較的長いTTLを許容してよい
* revocation cache は短いTTLとする
* stale revocation cache は high-risk に利用してはならない
* revocation cache の stale-if-error は原則禁止
* session cache は再利用防止に必須

## 18.4 Freshness 要件

### 低リスク操作

* 期限内キャッシュ利用可
* offline / fail-soft 可
* capability downgrade 可

### 高リスク操作

* fresh revocation proof 必須
* stale cache では fail-closed
* identity host 不達時は拒否または保留

## 18.5 Rollback / Freeze 対策

クライアントは少なくとも以下を保持すること。

* 最後に見た `identity_version`
* 最後に見た `revocation_epoch`
* 最後に見た `ledger_checkpoint`
* 最後に見た `policy_epoch`

これらより古い状態を受け取った場合は拒否または警告すること。

## 18.6 Epoch 要件

認証・セッション・失効に関連して以下を持つこと。

* `identity_version`
* `revocation_epoch`
* `policy_epoch`
* `session_epoch`

失効・侵害・ポリシー変更が発生した際には関連 epoch を上げ、既存セッションを無効化できること。

## 18.7 Push / Pull 併用

* Push: 失効イベントや侵害通知を素早く伝える
* Pull: 最終的な状態確認に使う

push は高速性、pull は正確性の責務を持つ。

## 18.8 Quarantine 要件

侵害疑い時は Agent を quarantine に置けること。

quarantine 状態では:

* 新規 high-risk セッション禁止
* capability 自動縮退
* 招待・承認・共有停止
* 再認証または回復完了まで制限継続

---

# 19. 透明性ログ / 台帳要件

## 19.1 目的

* 改ざん検知
* split-view 検知
* 履歴監査
* 鍵更新履歴追跡
* 侵害・回復の可視化

## 19.2 基本性質

* append-only
* 過去イベント削除禁止
* 署名必須
* 検証可能
* 複数コミュニティで複製可能

## 19.3 記録対象イベント

* `agent.created`
* `key.added`
* `key.revoked`
* `key.rotated`
* `binding.added`
* `binding.removed`
* `binding.updated`
* `compromise.reported`
* `agent.quarantined`
* `recovery.initiated`
* `recovery.completed`
* `policy.updated`

## 19.4 台帳の責務

台帳は **検知と監査** を担う。

## 19.5 台帳の非責務

台帳は **リアルタイム遮断そのもの** を担わない。
リアルタイム遮断は revocation / session invalidation 側の責務とする。

## 19.6 プライバシー要件

* 通常会話内容は原則台帳に載せない
* 個人情報・高機微情報を載せない
* 必要最小限のイベントメタデータに留める

---

# 20. セキュリティ要件

## 20.1 想定脅威

* SNSアカウント乗っ取り
* operation key 漏洩
* session key 奪取
* replay attack
* rollback attack
* freeze attack
* MITM
* 偽 binding 流布
* 透明性ログ split-view
* bot host 侵害
* CI/CD 侵害
* 依存関係汚染
* update supply chain 汚染
* 内部不正
* recovery 悪用

## 20.2 必須対策

* 鍵三層以上の分離
* nonce / timestamp / expiry
* 短命セッション
* revocation cache 短TTL
* epoch による既存セッション停止
* transparency log
* quarantine
* capability 最小権限
* high-risk 再検証
* recovery flow
* 監査ログ
* 管理者強固認証

## 20.3 望ましい対策

* ハードウェア鍵保護
* 高リスク操作の多重承認
* 遅延反映による巻き戻し防止
* 監視者による自動アラート
* 配布物署名
* reference implementation の security hardening

---

# 21. 侵害対応・回復要件

## 21.1 基本方針

侵害は起こりうるものとし、以下を標準イベントとして扱う。

## 21.2 必須イベント

* `compromise.reported`
* `agent.quarantined`
* `key.revoked`
* `recovery.initiated`
* `key.rotated`
* `recovery.completed`

## 21.3 必須フロー

1. 侵害検知
2. quarantine
3. relevant key revoke
4. revocation_epoch 上昇
5. active session 停止
6. new operation key 登録
7. binding 再確認
8. recovery 完了
9. quarantine 解除

## 21.4 回復要件

* identity continuity を維持しつつ回復可能
* 過去の侵害履歴が監査可能
* 回復後も履歴を消さない
* platform binding の再承認が可能

---

# 22. UX要件

## 22.1 原則

* 鍵交換をユーザーに見せない
* プラットフォームごとに別手順を要求しない
* できるだけ「リンクを踏むだけ / botを呼ぶだけ」に寄せる
* UI は技術詳細ではなく結果を表示する

## 22.2 最低限の表示項目

* `Verified Agent`
* `Official Identity`
* `Last Verified`
* `Capability Summary`
* `Identity Version`
* `Compromised / Quarantined / Recovered`
* `Platform Bindings`

## 22.3 挙動要件

* X / YouTube / Discord のどこからでも同一正本に到達できること
* 再認証は高速であること
* stale 状態では適切に degrade 表示されること
* 侵害時は警告表示が即時反映されること

## 22.4 軽量 transport UX

* 配信チャット欄では、短文・単純構文で最低限のやり取りが成立すること
* transport ごとの差異を、利用者に過剰に意識させないこと
* high-risk 操作が必要になったときのみ、外部導線や追加確認へ遷移させること
* UI は「いまどの trust level か」を明示できること

---

# 23. 非機能要件

## 23.1 性能

* 初回認証: 5秒以内目標
* 再認証: 2秒以内目標
* low-risk read: リアルタイム会話を阻害しない
* high-risk 判定: 明示的に待機可能

## 23.2 可用性

* identity host 一時不達でも low-risk は限定継続可能
* revocation host 不達時に high-risk を止められること
* cache miss 時の挙動が定義されていること
* push 不達でも pull で整合復旧できること

## 23.3 拡張性

* 新プラットフォーム追加可能
* capability taxonomy 拡張可能
* ledger backend 差し替え可能
* DID / URL / 別表現へ拡張可能
* 認証後の交流層として MCP 等への接続可能

## 23.4 保守性

* schema version を明示管理
* reference impl を複数言語で持てる
* test vectors を用意できる
* backward compatibility policy を定義できる

## 23.5 相互運用性

* 異なる実装言語・実装方式でも共通 message type を扱えること
* transport profile ごとの制約下でも意味が保たれること
* MCP / Skill / API のいずれかに偏らず bridge 可能であること
* low-risk interop は極力低遅延・低手数で成立すること

---

# 24. ガバナンス要件

## 24.1 バージョニング

* `core`
* `auth`
* `exchange`
* `ledger`

各層は独立に版管理可能とするが、互換性マトリクスを定義する。

## 24.2 互換性方針

* patch: 後方互換維持
* minor: 拡張中心
* major: 互換性破壊を許容

## 24.3 仕様変更手順

* schema change proposal
* security review
* compatibility review
* test vector 更新
* reference impl 更新

---

# 25. 実装境界

## 25.1 プロトコルが定義するもの

* メッセージ形式
* ID / key / session / epoch の意味
* 失効・回復・監査要件
* capability 交換の基本枠組み

## 25.2 プロトコルが定義しないもの

* UI デザインの最終形
* 各SNSのAPI接続実装詳細
* 配信ソフトとの内部結合仕様
* 各コミュニティのガバナンス細則

---

# 26. MVP要件

## 26.1 MVP に入れるもの

* `agent_id`
* `instance_id`
* `session_id`
* `identity_version`
* `revocation_epoch`
* challenge-response
* nonce / timestamp / expiry
* short-lived session
* platform binding
* low-risk / high-risk 区分
* revocation cache / identity cache 分離
* key revoke / rotate
* compromise / quarantine / recovery
* minimal ledger events
* hello / invite / accept / reject / defer
* capability summary
* lightweight interop message envelope
* trust level (`unverified` / `platform-linked` / `protocol-verified`)
* transport profile の最小定義
* Twitch / Discord / YouTube / X のうち少なくとも1つ以上の concrete profile
* capability summary の bridge_type
* capability invoke request / response の最小形
* low-risk から high-risk への昇格フロー

## 26.2 MVP で後回しにするもの

* reputation graph
* 自動信頼スコア
* 複雑な federation policy
* fully decentralized consensus
* 高度な persona similarity 推定
* 大規模匿名化交換
* 金融・決済連携
* transport ごとの高度な QoS 最適化
* 自動ルーティング最適化
* 複雑なマルチエージェント会話制御
* reputation に基づく自動 trust 昇格

---

# 27. リポジトリ方針

v0.x は **モノレポ推奨**。

```text
aituber-protocols/
  specs/
    core/
      requirements.md
      scope.md
      interfaces.md
      threat-model.md
    auth/
      cache-and-freshness.md
      state-machine.md
    ledger/
      events.md
  schemas/
    core/
      common.schema.json
    auth/
      identity-manifest.schema.json
      challenge.schema.json
      proof.schema.json
      session.schema.json
      revocation-status.schema.json
    ledger/
      event-envelope.schema.json
      key-revoked.schema.json
      binding-updated.schema.json
      compromise-reported.schema.json
      agent-quarantined.schema.json
      recovery-initiated.schema.json
      recovery-completed.schema.json
  examples/
    discovery/
    handshake/
    revoke/
    recover/
  test-vectors/
    auth/
    replay/
    rollback/
    quarantine/
  reference-impl/
    server/
    client/
    watcher/
```

---

# 28. 最低限の公開成果物

広める前提なら、最低でも次を揃える。

## 28.1 必須文書

* `README.md`
* `specs/core/requirements.md`
* `specs/core/scope.md`
* `specs/core/interfaces.md`
* `specs/auth/cache-and-freshness.md`
* `specs/auth/state-machine.md`
* `specs/ledger/events.md`
* `specs/core/threat-model.md`

## 28.2 必須スキーマ

* identity manifest schema
* challenge schema
* proof schema
* session schema
* revoke event schema
* compromise event schema
* recovery event schema
* invite / accept / reject schema

## 28.3 必須サンプル

* X からの discovery フロー
* Discord bot 経由フロー
* YouTube 概要欄導線フロー
* operation key 漏洩時の回復フロー
* stale revocation cache 時の fail-closed 例

---

# 29. 成功条件

以下を満たせば v0.2 / MVP 成功とみなす。

1. AITuber A と B が、X / YouTube / Discord のいずれかから導線に入り、5秒以内に本人性確認できる
2. SNSアカウント単体乗っ取りでは protocol 上の本人認証を突破できない
3. stale revocation cache による誤認可を high-risk で防げる
4. 鍵失効と回復が監査可能である
5. quarantine により被害拡大を止められる
6. exchange メッセージが安全に送受信できる
7. 将来的な core/auth/exchange/ledger 分離運用に耐える

---

# 30. 未決定事項

以下は今後の仕様化で詰める。

* 正本 manifest の具体表現
* `agent_id` の文字列表現
* capability taxonomy の詳細
* policy mismatch の扱い
* persona continuity の formalization
* watcher の最小要件
* offline mode の限界
* federation trust の範囲
* 公開実装のライセンス方針
* interop envelope の最小表現
* chat transport における compact syntax
* `from_agent_hint` / `to_agent_hint` の正規形
* MCP / Skill / API の bridge 記述方法
* trust level の昇格条件
* transport profile ごとの fallback 設計

---

# 31. 関連文書

1. `scope.md`
2. `interfaces.md`
3. `../auth/state-machine.md`
4. `threat-model.md`
5. `../auth/cache-and-freshness.md`
6. `../ledger/events.md`
7. `../../schemas/**/*.json`

---

# 32. 追加懸念事項と追補要件

レビュー時点で、MVP の筋は成立しているが、実装事故を減らすために以下を追補要件として追加する。

## 32.1 First-Seen Bootstrap 要件

初回接触時は verifier に過去の monotonic state がなく、rollback / split-view 検知力が弱い。

そのため最低限、以下を満たすこと。

* 初回接触であることを UI / log 上で区別できること
* first-seen 時の trust level を low-risk と high-risk で分離できること
* high-risk では first-seen 直後の即時許可を制限または追加確認可能であること
* 既知 watcher / mirror / checkpoint witness がある場合は bootstrap 時に利用可能であること

## 32.2 時刻信頼性要件

本仕様は nonce / timestamp / expiry に依存するため、時刻異常は安全性を直接損なう。

最低限、以下を満たすこと。

* verifier / agent は clock skew 許容幅を明示実装すること
* 時刻が大きく不正確な場合は high-risk を fail-closed にすること
* 時刻異常は `TIMESTAMP_INVALID` または同等の理由で監査可能にすること
* secure time source または同等の時刻健全性確保策を推奨すること

## 32.3 Canonicalization / Algorithm Agility 要件

署名検証の相互運用性崩れを避けるため、最低限次を満たすこと。

* manifest / proof / ledger event は canonicalization 識別子を持てること
* 実装間で最低1つの必須 canonicalization を共有すること
* 必須署名アルゴリズム集合と任意拡張集合を区別すること
* 旧アルゴリズム廃止時は deprecation 期間と互換性方針を定義すること

## 32.4 管理者操作の段階的保護要件

管理者・運営者の誤操作または乗っ取りは、recovery 悪用と同程度に危険である。

最低限、以下を満たすこと。

* root / recovery / policy 更新系操作では step-up 認証を要求可能であること
* 高リスク管理操作では multi-party approval を推奨または policy 化可能であること
* 管理系 API / console / bot command は通常 exchange 経路と分離して監査できること
* 管理者認証失敗・権限昇格試行を security event として監査できること

## 32.5 適合性・負例テスト要件

相互運用性は成功系だけでなく失敗系で崩れやすい。

最低限、以下の負例 test vector を用意できること。

* stale revocation cache による high-risk deny
* nonce replay reject
* rollback / epoch regression reject
* quarantined agent の high-risk deny
* policy mismatch / capability digest mismatch reject
* recovery sequence 不備の reject

## 32.6 プライバシー境界の追補要件

本仕様は conversation body を直接扱わないが、metadata だけでも関係性推定が可能な場合がある。

最低限、以下を満たすこと。

* ledger に載せる binding / recovery / compromise metadata は必要最小限に留めること
* exchange metadata と ledger metadata を容易に突合できない運用余地を残すこと
* capability summary は必要以上に内部 policy を露出しない粒度にできること

## 32.7 推奨する今後の仕様追加候補

次版で明文化すると特に有益な候補は以下。

* first-seen bootstrap profile
* canonicalization profile
* required algorithm set
* admin / recovery ceremony profile
* conformance test vector catalog

---

# 32. Reference Implementation 要件

本仕様の参照実装は、仕様の正確性検証と実装者の参考資料として提供する。

## 32.1 アーキテクチャ

参照実装は以下のモジュールで構成する。

* `server/` - Identity Host, Verifier, Session Manager, Ledger
* `client/` - Agent Client, Proof Generator, Exchange Client
* `watcher/` - Event Monitor, Split-view Detector, Alert Notifier

## 32.2 必須機能

### Server

* Identity Host: Identity Manifest の保存・取得・更新
* Verifier: Challenge 発行、Proof 検証、nonce 管理
* Session Manager: セッション作成・終了・無効化
* Ledger: append-only イベントログ

### Client

* Proof Generator: Challenge への署名付き応答生成
* Agent Client: 認証フロー実行、正本解決
* Exchange Client: 認証済みセッション上のメッセージ送受信

### Watcher

* Event Monitor: Ledger イベント監視
* Split-view Detector: チェックポイント矛盾検知
* Alert Notifier: 外部システムへのアラート通知

## 32.3 技術スタック

* TypeScript 5.x
* Node.js 20+
* Hono (HTTP framework)
* @noble/ed25519 (暗号ライブラリ)
* vitest (テストフレームワーク)

## 32.4 必須テスト

* 各モジュールの単体テスト
* 統合テスト (認証フロー全体)
* テストベクターとの整合性確認

---

# 33. HTTP API 要件

参照実装は RESTful HTTP API を提供する。

## 33.1 エンドポイント一覧

### Identity

* `GET /v1/agents/:agentId/manifest` - Identity Manifest 取得
* `PUT /v1/agents/:agentId/manifest` - Identity Manifest 更新

### Revocation

* `GET /v1/agents/:agentId/revocation` - Revocation Status 取得

### Auth

* `POST /v1/challenges` - Challenge 発行
* `POST /v1/proofs/verify` - Proof 検証
* `POST /v1/sessions` - Session 作成
* `DELETE /v1/sessions/:sessionId` - Session 終了

### Ledger

* `POST /v1/ledger/events` - イベント記録
* `GET /v1/ledger/events` - イベント一覧取得
* `GET /v1/ledger/checkpoint` - チェックポイント取得

### System

* `GET /health` - ヘルスチェック
* `GET /` - API 情報

## 33.2 リクエスト・レスポンス形式

* Content-Type: `application/json`
* エラーレスポンスは `error.code`, `error.message`, `error.retryable`, `error.risk_level` を含む

## 33.3 エラーコード

| コード | 意味 |
|--------|------|
| `INVALID_SIGNATURE` | 署名検証失敗 |
| `NONCE_EXPIRED` | nonce 期限切れ |
| `NONCE_REPLAYED` | nonce 再利用 |
| `TIMESTAMP_INVALID` | タイムスタンプ異常 |
| `KEY_REVOKED` | 鍵失効済み |
| `AGENT_QUARANTINED` | Agent 隔離中 |
| `IDENTITY_ROLLBACK_DETECTED` | ロールバック検知 |
| `SESSION_EPOCH_OLD` | Session epoch 古い |

---

# 34. 暗号ユーティリティ要件

参照実装は以下の暗号機能を提供する。

## 34.1 必須アルゴリズム

* 署名アルゴリズム: Ed25519
* ハッシュアルゴリズム: SHA-256
* 正準化アルゴリズム: JCS (JSON Canonicalization Scheme, RFC 8785)

## 34.2 鍵管理機能

* 鍵ペア生成 (`generateKeyPair`)
* 公開鍵導出 (`derivePublicKey`)
* 鍵形式変換 (hex / base64)

## 34.3 署名機能

* メッセージ署名 (`sign`)
* オブジェクト署名 (`signObject`)
* 署名検証 (`verify`)
* オブジェクト署名検証 (`verifyObject`)

## 34.4 正準化機能

* JCS 正準化 (`canonicalize`)
* プロパティの Unicode コードポイント順ソート
* 数値の正規化
* エスケープ処理

## 34.5 ハッシュ機能

* SHA-256 ハッシュ計算 (`hash`)
* オブジェクトハッシュ (`hashObject`)
* ハッシュ値は `sha256:` プレフィックス付き

## 34.6 検証機能

* 公開鍵有効性検証 (`isValidPublicKey`)
* 秘密鍵有効性検証 (`isValidPrivateKey`)
