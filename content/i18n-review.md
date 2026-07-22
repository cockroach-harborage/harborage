# Translation review record

Rule (PRD §15): every ★ safety-critical string is human-translated and
human-reviewed, with a named reviewer. Machine translation is allowed only for
low-risk content and stays marked draft until a person confirms it.

## Status

| Catalog | Strings | Status | Reviewer |
|---|---|---|---|
| `apps/web/messages/en.json` | all | authored against the plain-language rules; safety strings pending second-person review | UNASSIGNED |
| `apps/web/messages/hi.json`: frozen strings from PRD §15 (heroes, tab labels, the four checking labels) | `hero_*`, `nav_*`, `label_team`, `label_nearby`, `label_unchecked`, `label_problem` | sourced verbatim from PRD §15 (human-authored) | PRD §15 |
| `apps/web/messages/hi.json`: everything else | remainder | DRAFT: needs a named human reviewer before M1 ships | UNASSIGNED |

## M1 blockers (P1, ARCHITECTURE §18.5)

The content pipeline needs named humans before M1 has anything to sign:
legal reviewer, medic reviewer, en/hi translators, m-of-n signers. Record them
here when appointed. Crisis-card text ships only after two-person review, and
each card has one canonical version, referenced everywhere, never copied.
