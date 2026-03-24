# 検収フィードバック

対象: AITuber Protocols  
作成日: 2026-03-24  
目的: 検収で見つかった問題点を、修正意図と完了条件が伝わる形で整理し、手戻りを減らす

---

## 0. 結論

現状は「仕様・schema・参照実装の骨格はかなり整っており、テストも通る」が、
**検収資料と validation の厳密性がまだ不足している** 状態です。

特に優先度が高いのは次の 2 系統です。

1. **検収ドキュメントの事実整合**
2. **validation の見逃しを減らすこと**

この 2 点が残っていると、実態よりも「できているように見える」状態が続き、
次回の検収や外部共有で信頼性を落とします。

---

## 1. 今回の実施内容

今回の確認では以下を実施しました。

- `schemas/**/*.json` の JSON 構文確認
- `reference-impl` の `npm test`
- `reference-impl` の `npm run validate`
- requirements / interfaces / state-machine / events / README / acceptance checklist の整合確認

確認結果:

- `npm test`: 成功
  - 17 files
  - 812 tests passed
- `npm run validate`: 成功
  - Examples validation: PASSED
  - Test vectors validation: PASSED

ただし、後述の通り `validate` は現状かなり広く「未検証のまま通す」余地があります。

---

## 2. 優先修正事項

### P1. 検収チェックリストが未実施項目を残したまま「合格」になっている

対象:

- `reference-impl/ACCEPTANCE_CHECKLIST.md`

現状:

- 未実施項目が残っている
  - `PUT /v1/agents/:agentId/manifest`
  - `POST /v1/proofs/verify`
  - `POST /v1/sessions`
  - `DELETE /v1/sessions/:sessionId`
  - `Freshness status`
  - `GET /v1/ledger/events`
- それにもかかわらず総合判定が `合格` になっている

なぜ直す必要があるか:

- 検収資料は「何が実際に受け入れ済みか」の根拠です。
- 未実施を残したまま `合格` と書くと、後続の作業者が「API 一式は検収済み」と誤認します。
- 特に proof/session 系はプロトコルの中核なので、ここが未確認のまま合格扱いなのは危険です。

直し方の意図:

- 「合格/不合格」の二択ではなく、**実施済み / 未実施 / 要追加データ / 要自動化** を分けて書く
- 総合判定は、未実施の重要項目が残るなら `条件付き合格` または `継続確認が必要` に落とす
- 実施方法が手動なのか、自動テストで担保したのかも明記する

修正案:

- サマリーを次のような構造にする
  - 実施済み
  - 未実施
  - 自動テストで代替確認済み
  - 次回検収前の必須項目
- 総合判定を以下のいずれかに変更
  - `条件付き合格`
  - `一部未完了`

完了条件:

- 未実施項目が明示されている
- 総合判定が実態と一致している
- 次に誰が何を確認すべきか読めば分かる

---

### P1. examples validation が「未検証のまま通る」

対象:

- `reference-impl/scripts/validate-schemas.ts`
- `examples/**/*.json`

現状:

- flow 型 example の `request` / `response` をほとんど検証していない
- `message_type` を持つ exchange message は schema 対象外としてスキップしている
- 実行結果上も多くの example が:
  - `No validatable messages found`
  - `Could not determine schema`

なぜ直す必要があるか:

- `validate` が成功しても、「example が schema に適合している」とは今は言えません。
- 検収では examples も公開成果物なので、そこが機械検証されていないのは弱いです。
- 仕様変更時に example が古くなっても、今の validator では気づけません。

直し方の意図:

- `validate` の成功を「本当に example 群が追随している」というシグナルにしたい
- 取りこぼしを warning ではなく、原則 fail に寄せる

修正案:

1. `processExampleFile()` で `steps[].request` と `steps[].response` も検証対象に含める
2. exchange / interop message 用 schema を追加し、`message_type` がある object を検証できるようにする
3. schema を判定できなかった object は warning ではなく failure 扱いを検討する
4. file ごとに
   - 何件検証対象があったか
   - 何件スキップしたか
   を出す

最低ラインの完了条件:

- `examples/discovery/x-discovery.json` の各主要 step が検証対象に入る
- `No validatable messages found` が主要 example で出なくなる
- schema 未判定 object を一覧で追える

理想の完了条件:

- examples の主要 payload がすべて schema に結び付く
- validator が「何を検証したか」を明確に出力する

---

## 3. 中優先の修正事項

### P2. test vector validator が warning を出しつつ pass してしまう

対象:

- `reference-impl/scripts/validate-test-vectors.ts`
- `test-vectors/**/*.json`

現状:

- 入力/出力の必須に近い情報が欠けても、多くは warning のまま pass する
- 例:
  - `expected_output` に主要 status がない
  - session の重要 field がない
  - challenge / proof に推奨 field が足りない

なぜ直す必要があるか:

- test vector は「将来実装が仕様を守っているか」を固定する資産です。
- warning のまま pass すると、曖昧な vector が残り続けます。
- 実装差分比較や回帰検知に使いづらくなります。

直し方の意図:

- test vector を「読む資料」ではなく「機械的に比較できる契約」に近づける

修正案:

1. `warning` と `error` の基準を見直す
2. 少なくとも以下は fail 条件に引き上げる
   - expected output に判定結果がない
   - session/challenge/proof の中核 field が欠落している
3. vector 種別ごとに required fields を分ける
   - auth vector
   - quarantine vector
   - replay vector
   - rollback vector

完了条件:

- warning 件数が大きく減る
- pass した vector は、期待する判定結果を明示的に持つ

---

### P2. README が現行仕様と実績に追随していない

対象:

- `README.md`

現状:

- 4 層説明のままで、現行 requirements の 7 層構成に追随していない
- interop / transport / capability bridge の説明が足りない
- メッセージ一覧が古い
  - `mention`
  - `ack`
  - `error`
  - `capability.summary`
  - `capability.invoke.request`
  - `capability.invoke.response`
  が欠落
- テスト実績が現状とズレている
  - README: `768テスト`
  - 実測: `812 tests`

なぜ直す必要があるか:

- README は最初に読まれる入口なので、ここが古いと全体理解を誤らせます。
- 仕様書側で interop 中心に寄せた意味が README に出ていません。

直し方の意図:

- README を「古い入門記事」ではなく、現行 draft の正しいナビゲーションに戻す

修正案:

1. アーキテクチャ説明を 7 層相当に更新
2. lightweight interop / transport profile / capability bridge を追記
3. API / message 一覧を `interfaces.md` に合わせる
4. テスト件数や実装状況の数値を最新化
5. 可能なら README で「仕様の正本は requirements / interfaces」と明記

完了条件:

- README の説明が requirements / interfaces と矛盾しない
- 実績値が現行テスト結果と一致する

---

## 4. 低優先だが直すと強くなる点

### P3. `add_requirements.md` は作業メモとして残す前提を明確化した方がよい

対象:

- `specs/core/add_requirements.md`

現状:

- すでに反映済みの追補案が残っている
- 章番号参照は現行 `requirements.md` とずれていく可能性がある

意図:

- これは仕様本文ではなく、変更提案メモです。
- その位置づけをより明確にしておくと、後から読んだ人が「どちらが正本か」で迷いにくいです。

修正案:

- 冒頭に以下を追記
  - これは作業メモである
  - 正本は `requirements.md`
  - 反映済み項目は現行見出し番号を参照する

完了条件:

- 正本と提案メモの関係が明記されている

---

## 5. 推奨する修正順

実務上は次の順で直すのが効率的です。

1. `reference-impl/ACCEPTANCE_CHECKLIST.md`
2. `reference-impl/scripts/validate-schemas.ts`
3. `reference-impl/scripts/validate-test-vectors.ts`
4. `README.md`

理由:

- まず「何が未完了か」を正しく表現する
- 次に validation を厳しくして、今後の取りこぼしを減らす
- その後で README を最新の正しい入口にする

---

## 6. 次回検収で確認したいこと

次回の検収では、少なくとも以下を再確認したいです。

- `validate` 実行時に example の主要 payload が本当に検証されているか
- test vector の pass が warning だらけではないか
- checklist の未実施項目が減っているか
- README の説明が `requirements.md` / `interfaces.md` と一致しているか
- proof/session/freshness/ledger event list の API 受け入れが手動または自動で埋まったか

---

## 7. 受け入れ再判定の目安

以下を満たせば、かなり安心して再検収できます。

- checklist が実態に合っている
- `npm test` が通る
- `npm run validate` が「未検証スキップほぼなし」で通る
- 主要 example が schema 結び付き済み
- test vector warning が整理されている
- README が最新仕様に追随している

その段階での判定表現は、
`条件付き合格` ではなく `合格` に上げやすくなります。
