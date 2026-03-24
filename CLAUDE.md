日本語で記載する

Claude Code でこのリポジトリを扱うときは、最初に [skills/aituber-protocols-maintainer/SKILL.md](./skills/aituber-protocols-maintainer/SKILL.md) を読む。

## この repo の見方

- `specs/` が仕様の正本
- `schemas/` が検証契約
- `examples/` と `test-vectors/` が期待フロー
- `reference-impl/` が参照実装

## 推奨コマンド

`reference-impl/` で次を実行する。

```bash
npm test
npm run validate
npm run test:integration -- --server-url http://127.0.0.1:3200
```
