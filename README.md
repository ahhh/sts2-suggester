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
- **Other characters' cards** are one toggle away in the album, for the runs
  where Kaleidoscope or Prismatic Shard hands you somebody else's colour. Off by
  default, because the rest of the time those cards cannot appear; borrowed
  cards are labelled with whose they are.
- **Hover any card or relic** — in your deck, in the offer, in the ranking, in
  the album — for the full card: art, rules text, what upgrading it would do,
  and its community numbers.
- Ranks a card reward with **Skip as a real candidate**, scored on the same
  0–100 scale.
- **Rank a card up or down yourself** before evaluating it. Each click moves it
  one Codex tier (D → C, and so on), the weighting sticks to the card across
  runs, and it shows up in the breakdown as your call rather than being folded
  invisibly into the score.
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
| **Iris (cold)** | *Yours.* Tiers you pushed a card by hand. |

Score bars, ledger rows and badges all obey it, so a glance tells you how much
of a recommendation is evidence, how much is inference, and how much is you.

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

### Your own judgement

The up/down control on each offered card is a third provenance, kept separate
from the other two rather than blended into them. One step is worth exactly
`TIER_STEP` points — the width of a Codex tier band — and it is applied
unweighted and last, so the promise the control makes ("one click, one tier") is
the promise the number keeps. It appears as its own ledger row, its own colour
on the score bar, and its own legend entry.

Weightings are keyed to the card, not the offer, and live in preferences rather
than in the run: they survive a new run, they are *not* written into a run
export, and they also steer the removal advisor — a card you ranked down becomes
a better cut, one you ranked up is protected from the chop.

## Layout

```
index.html          shell
styles.css          design system
js/tags.js          mechanic extraction — traits / wants / role profile
js/data.js          provider adapter, cache, bracket fallback
js/album.js         card & relic pools, cross-colour toggle, search
js/state.js         run state, mutations, starter seeding
js/bias.js          your own per-card weighting, and the tier ladder
js/scoring.js       pick / skip / removal engines
js/ui.js            rendering
js/tooltip.js       the hover card
js/format.js        rules-text escaping, keyword colouring, clamping
js/app.js           bootstrap and event routing
js/storage.js       localStorage + IndexedDB
data/fallback.json  offline snapshot
tools/build-fallback.mjs   regenerates it: node tools/build-fallback.mjs
```

`js/data.js` exposes a `StatsProvider` base class; `SpireCodexProvider` is one
implementation. Nothing above that layer touches a URL, so a different dataset
can be swapped in without changing the UI or the scoring engine.

## Not implemented

- Personal run-history import (`.run` / `.save` parsing), so weighting could be
  learned from your own results rather than only set by hand.
- Potion tracking. The field exists in the run state; nothing reads it yet.
- Shop, event, relic-reward and route advice.

## Privacy

Your run never leaves the browser. It is saved to `localStorage`, and card data
is cached in IndexedDB. **Clear local data** in the Run panel erases both.
