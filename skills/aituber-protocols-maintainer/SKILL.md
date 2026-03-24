---
name: aituber-protocols-maintainer
description: Use when working in the aituber-protocols repository on protocol requirements, schemas, examples, test vectors, reference implementation, acceptance checks, README updates, or cross-file consistency between specs and code.
---

# AITuber Protocols Maintainer

`aituber-protocols` 専用のメンテナンス Skill。

## 使う場面

- `specs/` の要件・インターフェース・状態遷移・脅威モデルを更新するとき
- `schemas/` と `examples/` と `test-vectors/` の整合を取るとき
- `reference-impl/` の実装・テスト・validator・検収資料を直すとき
- README や acceptance 文書を、実装と実測値に合わせて更新するとき

## 最初に押さえる地図

- `specs/`: 人間向けの正本
- `schemas/`: 機械検証用の契約
- `examples/`: フロー例
- `test-vectors/`: 正例・負例・境界条件
- `reference-impl/`: 参照実装と検収対象

## 推奨の進め方

1. 変更対象が `spec / schema / example / vector / reference-impl` のどこに属するか先に切り分ける。
2. プロトコル意味論を変える場合は、少なくとも `requirements.md`、必要に応じて `interfaces.md`、`state-machine.md`、`events.md` を追従させる。
3. schema を変える場合は、対応する `examples/` と `test-vectors/` と validator も確認する。
4. 実装や fixture を変える場合は、`reference-impl` 配下のテストと統合フローを確認する。
5. 実績値が変わったら `reference-impl/ACCEPTANCE_CHECKLIST.md` と `README.md` を更新する。

## 実行コマンド

`reference-impl` で次を使う。

```bash
npm test
npm run validate
npm run test:integration -- --server-url http://127.0.0.1:3200
```

## 編集時の注意

- docs だけでなく、実装・schema・examples・test vectors のズレを優先的に疑う。
- `README.md` は概要、正本は `specs/core/requirements.md` と `specs/core/interfaces.md`。
- 検収では「コマンドが成功したか」と「資料の数値や説明が現状と一致するか」を別々に確認する。
