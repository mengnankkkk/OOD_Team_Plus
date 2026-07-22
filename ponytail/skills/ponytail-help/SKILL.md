---
name: ponytail-help
description: >
  Quick-reference card for all ponytail modes, skills, and commands.
  One-shot display, not a persistent mode. Trigger: /ponytail-help,
  "ponytail help", "what ponytail commands", "how do I use ponytail".
---

# Ponytail Help

Display this reference card when invoked. One-shot, do NOT change mode,
write flag files, or persist anything.

## Levels

| Level | Trigger | What change |
|-------|---------|-------------|
| **Lite** | `$ponytail` + lite | Build what's asked, name the lazier alternative in one line. |
| **Full** | `$ponytail` | The ladder enforced: YAGNI → stdlib → native → one line → minimum. Default. |
| **Ultra** | `$ponytail` + ultra | YAGNI extremist. Deletion before addition. Challenges requirements before building. |

The selected level applies to the current Ponytail task unless the user changes it.

## Skills

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **ponytail** | `$ponytail` | Lazy mode itself. Simplest solution that works. |
| **ponytail-review** | `$ponytail-review` | Over-engineering review: `L42: yagni: factory, one product. Inline.` |
| **ponytail-audit** | `$ponytail-audit` | Whole-repo over-engineering audit: ranked list of what to delete. |
| **ponytail-debt** | `$ponytail-debt` | Harvest `ponytail:` shortcut comments into a tracked ledger. |
| **ponytail-gain** | `$ponytail-gain` | Measured-impact scoreboard: less code, less cost, more speed. |
| **ponytail-help** | `$ponytail-help` | This card. |

Invoke the matching `$ponytail-*` skill in Codex. Hosts with slash-command
support may use slash forms.

## Deactivate

Say "stop ponytail" or "normal mode". Resume with `$ponytail` on a later task.

This repository contains the skill-only installation. It does not install
lifecycle hooks, automatic session activation, persistent mode files, or
`PONYTAIL_*` environment-variable handling.

## More

Full docs + examples: https://github.com/DietrichGebert/ponytail
