# Agent Task Prompts

Claude Code / Codex からこの repo を扱うときの定型プロンプトです。

## Repo 全体レビュー

```text
Use $aituber-protocols-maintainer to review this repo, check consistency across specs, schemas, examples, test-vectors, and reference-impl, then run npm test and npm run validate in reference-impl and summarize findings first.
```

## 仕様変更の追従

```text
Use $aituber-protocols-maintainer to update the protocol spec, then propagate the change to schemas, examples, test-vectors, reference-impl, and acceptance docs.
```

## 再検収

```text
Use $aituber-protocols-maintainer to perform acceptance again for this repo, verify reference-impl with npm test, npm run validate, and npm run test:integration -- --server-url http://127.0.0.1:3200, then list remaining issues by severity.
```

## README / ドキュメント整備

```text
Use $aituber-protocols-maintainer to improve the documentation in this repo, keep README concise and navigable, and ensure acceptance numbers and commands match the current implementation.
```
