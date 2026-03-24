---

# 追加方針

注:
このメモは追補案の作業メモであり、`requirements.md` に Interop 章を挿入した後は
後半章の番号参照が 1 つずつ後ろへずれる場合がある。
実際の反映先は現行 `requirements.md` の見出し番号を正とする。

今回は全面改稿ではなく、以下の扱いを想定しています。

1. **目的の補強**
2. **設計原則の追加**
3. **全体アーキテクチャに interop / transport / capability bridge を追加**
4. **Exchange章を拡張**
5. **MVP要件を補強**

---

## 1. `0. TL;DR` 追記案

既存 TL;DR の末尾に、以下を追加。

```md
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
```

---

## 2. `3. 目的` 追記案

`3.1 主目的` の前か後に、次の小節を追加。

```md
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
```

---

## 3. `4. 非目的` 追記案

```md
* 全 AITuber 実装の内部アーキテクチャ統一
* 全開発者に単一フレームワークを強制すること
* すべての交流を高信頼認証必須にすること
* 既存プラットフォームのチャット欄を完全に安全な通信路として扱うこと
```

---

## 4. `5. 設計原則` 追記案

既存の 1〜9 に続けて追加。

```md
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
```

---

## 5. `8. 想定ユースケース` 追記案

```md
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
```

---

## 6. `9. システム全体像` 追加章

既存 9.1〜9.4 のあとに追加。

```md
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
```

---

## 7. 新章追加案 `15.x Interop / Transport`

`14. 相互認証プロトコル要件` と `16. 情報交流プロトコル要件` の間、または `16` の前に新章として挿入するのが自然です。

---

### `15. Interop 要件`

```md
# 15. Interop 要件

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
```

---

### `15.6 Transport Profile 要件`

```md
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
```

---

## 8. `16. 情報交流プロトコル要件` 追記案

既存 Exchange を壊さず、後半に追加。

```md
## 16.5 交流の段階

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

## 16.6 capability summary 要件の拡張

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

## 16.7 capability invocation request

最低限、以下を表現できること。

* 呼び出したい capability 名
* 引数または引数参照
* 呼び出し元意図
* 必要な trust level
* 応答先
* タイムアウト方針

## 16.8 high-risk への昇格

low-risk な transport 上で開始された交流でも、
以下に該当する場合は stronger verification に昇格できること。

* memory exchange
* capability 昇格
* 外部 tool 実行
* 公式コラボ承認
* identity / binding 更新
* ledger 書き込み依頼
```

---

## 9. `21. UX要件` 追記案

```md
## 21.4 軽量 transport UX

* 配信チャット欄では、短文・単純構文で最低限のやり取りが成立すること
* transport ごとの差異を、利用者に過剰に意識させないこと
* high-risk 操作が必要になったときのみ、外部導線や追加確認へ遷移させること
* UI は「いまどの trust level か」を明示できること
```

---

## 10. `22. 非機能要件` 追記案

```md
## 22.5 相互運用性

* 異なる実装言語・実装方式でも共通 message type を扱えること
* transport profile ごとの制約下でも意味が保たれること
* MCP / Skill / API のいずれかに偏らず bridge 可能であること
* low-risk interop は極力低遅延・低手数で成立すること
```

---

## 11. `25. MVP要件` の補強

`25.1 MVP に入れるもの` に追加。

```md
* lightweight interop message envelope
* trust level (`unverified` / `platform-linked` / `protocol-verified`)
* transport profile の最小定義
* Twitch / Discord / YouTube / X のうち少なくとも1つ以上の concrete profile
* capability summary の bridge_type
* capability invoke request / response の最小形
* low-risk から high-risk への昇格フロー
```

`25.2 MVP で後回しにするもの` に追加。

```md
* transport ごとの高度な QoS 最適化
* 自動ルーティング最適化
* 複雑なマルチエージェント会話制御
* reputation に基づく自動 trust 昇格
```

---

## 12. `29. 未決定事項` 追記案

```md
* interop envelope の最小表現
* chat transport における compact syntax
* `from_agent_hint` / `to_agent_hint` の正規形
* MCP / Skill / API の bridge 記述方法
* trust level の昇格条件
* transport profile ごとの fallback 設計
```

---

# かなり大事な補正ポイント

今回の追加要件で、本質的には文書の意味が少し変わります。

元:

* 認証・失効・回復が中心
* 交流はその上の機能

追加後:

* **まず相互運用が中心**
* 認証・失効・回復はその中の trust extension

この補正はかなり重要です。
ただし既存文書を壊す必要はなく、**上位目的の追加**として処理すれば十分です。

---

# 一番きれいな章構成

最終的には、見出しとしてこういう並びに寄せると読み手に伝わりやすいです。

1. Core
2. Interop
3. Transport Profiles
4. Auth
5. Exchange
6. Capability Bridge
7. Ledger
8. Recovery / Governance

今は auth が強いので、**Interop と Transport を追加章で補う** のがちょうどいいです。

---

# 実務的な結論

はい、**追加要件定義として組み込むのが正解** です。
全面書き直しではなく、

* 上位目的の補正
* interop 章の追加
* transport profile 章の追加
* capability bridge 章の追加
* MVP補強

で十分に筋が通ります。

必要なら次に、そのまま置ける形で
**`15. Interop 要件` 章を完成版の Markdown** も必要の可能性あり。
