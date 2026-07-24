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
| `apps/web/messages/{en,hi}.json`: incident-type taxonomy | `inc_type_*` (14) | frozen closed set (PRD §2); EN authored to the plain-language rules, HI DRAFT, needs a named reviewer before `incidents_publish` flips | UNASSIGNED |
| `apps/web/messages/{en,hi}.json`: official-notice strings | `notices_stale`, `notice_directive_warning`, `notice_unverified`, `notice_superseded`, `notices_verify_channel`, `verify_channel_*` | ★ safety-critical (the directive interstitial and the unverified warning). EN authored to the plain-language rules; HI DRAFT, needs a named reviewer before `notices_publish` flips | UNASSIGNED |
| `content/crisis-cards/cards.json` | teargas, detained, blackout, peaceful, rights (en+hi) | DRAFT, `review_state=draft`. Shows a prominent draft banner in-app. The legal cards (detained, rights) are counsel-gated; teargas is medic-gated. Both EN and HI need named counsel/medic + translator review, and an m-of-n-signed pack, before the banner drops | UNASSIGNED |

## M1 blockers (P1, ARCHITECTURE §18.5)

The content pipeline needs named humans before M1 has anything to sign:
legal reviewer, medic reviewer, en/hi translators, m-of-n signers. Record them
here when appointed. Crisis-card text ships only after two-person review, and
each card has one canonical version, referenced everywhere, never copied.
