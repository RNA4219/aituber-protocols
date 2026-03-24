日本語で記載する

このリポジトリで作業する場合は、まず [skills/aituber-protocols-maintainer/SKILL.md](C:/Users/ryo-n/Codex_dev/aituber-protocols/skills/aituber-protocols-maintainer/SKILL.md) を参照する。

## 優先方針

- 仕様の正本は `specs/`
- 機械検証の正本は `schemas/`
- 動作確認の正本は `reference-impl/`
- 例示の正本は `examples/` と `test-vectors/`

## 期待する進め方

- 仕様変更では docs / schema / examples / test-vectors / reference-impl の追従漏れを探す
- 実装変更では `reference-impl` の `npm test` と `npm run validate` を優先して確認する
- 検収値が変わったら `reference-impl/ACCEPTANCE_CHECKLIST.md` と `README.md` を更新する
