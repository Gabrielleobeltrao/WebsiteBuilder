---
name: project-runbook
description: Concise routing to this project's architecture map, canonical commands, and definition of done. Use when you need to know where a module lives, which command to run, or whether a change is finished — instead of browsing the repository or re-reading IMPLEMENTATION_PLAN.md.
---

# project-runbook

Read **one** reference file, chosen by the question. Do not read all three.

| Question | File |
|---|---|
| Where does this live? Which workspace owns it? What may import what? | `references/architecture-map.md` |
| How do I install, run, test, typecheck, build, or verify? | `references/commands.md` |
| Is this change finished? What must every task satisfy? | `references/definition-of-done.md` |

`IMPLEMENTATION_PLAN.md` stays authoritative. These summaries are navigation aids and never
override it. Regenerate them (`npm run docs:runbook`) when fixed architecture, root scripts, or the
definition of done materially change.
