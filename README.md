# Spire Advisor

A live build advisor for **Slay the Spire 2**. Enter the run you are actually
playing, then get ranked card picks, a real skip score, and removal advice
scored against *your* deck rather than a generic tier list.

Single page, vanilla JavaScript, no build step, no backend. Deploys to GitHub
Pages as-is.

> Unofficial community tool. Not affiliated with or endorsed by Mega Crit.

## What it does

- Seeds your starting deck, starter relic and HP the moment you pick a character
  — including Ascender's Bane at Ascension 5+ — so mid-run reconstruction means
  entering only what changed.
- Searchable card and relic album with real card art, filtered to your
  character's pool. Search matches names, rules text and mechanics, so
  `poison` or `discard` finds cards by what they do.
- Ranks a card reward with **Skip as a real candidate**, scored on the same
  0–100 scale.
- Explains every score as an exact decomposition — the breakdown sums to the
  number shown, it is not a plausible story told alongside it.
- Ranks removal targets, and refuses to suggest cards that are Eternal and
  therefore cannot leave your deck.
- Co-op aware: party tabs, a primary player being advised, teammate presets,
  multiplayer-only cards gated to co-op runs, and statistics segmented by party
  size.
- Keeps working when the API is down, and says so rather than pretending.

## Running it

Any static file server; ES modules will not load over `file://`.

```sh
python3 -m http.server 8777
# then open http://localhost:8777/
```

## Deploying to GitHub Pages

Push to `main` and enable Pages (Settings → Pages → *Deploy from a branch* →
`main` / `/root`). There is no build step. `.nojekyll` is present so the
`js/` and `data/` directories are served verbatim.

## Where the numbers come from

Everything is loaded in the browser from the [Spire Codex](https://spire-codex.com/)
public REST API — no key, no proxy, CORS open. Responses are cached in
IndexedDB for 12 hours.

The interface holds one rule throughout, and it carries meaning:

| | |
|---|---|
| **Jade (cool)** | *Measured.* Community run statistics. |
| **Ember (warm)** | *Inferred.* Mechanical fit to your build. |

Score bars, ledger rows and badges all obey it, so a glance tells you how much
of a recommendation is evidence and how much is inference.

### Measured components

`GET /api/runs/metrics/cards` supplies Codex Score, Elo, win rate, pick rate,
per-act pick rates and observation counts across ~1.27M submitted runs, in
brackets for solo, 2/3/4-player, A10+, daily and player-skill tiers.

- **Base strength** blends Codex Score, pick-rate-when-offered and win rate,
  then applies Bayesian shrinkage toward the field so a card with 40
  observations cannot outrank one with 40,000.
- **Skip** is grounded in the community's own skip rate: pick rate when offered,
  in the current act.
- **Upgrade value** uses the separate statistics that exist for upgraded copies.
- Baselines swing from 27% (solo) to 78% (4-player), so win rate is only ever
  used as a delta against the selected bracket's baseline.

Two traps in this data are handled explicitly:

- **Starter cards are excluded from statistical judgement.** Strike, Defend,
  Neutralize and friends appear in every run, so their win rate is just the
  global baseline and their "pick rate" comes from a handful of stray offers.
  Taken at face value the data brands Neutralize an F-tier card. They are scored
  on merit instead.
- **Pick rate is ignored below 200 offers**, and a bracket too thin for a given
  card widens to all-runs — visibly, with the badge saying so.

### Inferred components

The API exposes no pairwise card-synergy data, so synergy is **mechanistic**:
each card is read into `traits` (what it puts into your deck) and `wants` (what
pays it off), derived from structured fields and rules text. Synergy is then
`candidate.wants × deck.traits` + `candidate.traits × deck.wants` + archetype
concentration, with quantity on a `sqrt` curve so five Strikes do not drown out
the deck.

The extractor checks polarity, because "Gain 2 Strength" and "Enemy loses 9
Strength" mention the same word and mean opposite things — and `powers_applied`
stores magnitude without sign, so the text is the only reliable signal.

## Layout

```
index.html          shell
styles.css          design system
js/tags.js          mechanic extraction — traits / wants / role profile
js/data.js          provider adapter, cache, bracket fallback
js/album.js         card & relic pools, search
js/state.js         run state, mutations, starter seeding
js/scoring.js       pick / skip / removal engines
js/ui.js            rendering
js/app.js           bootstrap and event routing
js/storage.js       localStorage + IndexedDB
data/fallback.json  offline snapshot
tools/build-fallback.mjs   regenerates it: node tools/build-fallback.mjs
```

`js/data.js` exposes a `StatsProvider` base class; `SpireCodexProvider` is one
implementation. Nothing above that layer touches a URL, so a different dataset
can be swapped in without changing the UI or the scoring engine.

## Not implemented

- Personal run-history import (`.run` / `.save` parsing) and hybrid
  personal/community weighting.
- Potion tracking. The field exists in the run state; nothing reads it yet.
- Shop, event, relic-reward and route advice.

## Privacy

Your run never leaves the browser. It is saved to `localStorage`, and card data
is cached in IndexedDB. **Clear local data** in the Run panel erases both.
