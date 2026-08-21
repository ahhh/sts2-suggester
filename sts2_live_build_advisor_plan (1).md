# Slay the Spire 2 Live Build Advisor
## Single-Page HTML/JavaScript Application — Initial Product & Technical Plan

**Plan date:** August 20, 2026  
**Revision:** Starter-state presets added for all five characters  
**Primary goal:** Build a browser-based Slay the Spire 2 advisor that lets a player manually enter their live run state, then ranks card picks and card removals using community statistics, synergy data, daily-run data, and optionally the player's own imported history.

---

# 1. Product Vision

Create a fast, single-page companion for **Slay the Spire 2** that can be used while a run is in progress.

The player should be able to:

1. Select Singleplayer or Multiplayer.
2. Select their character.
3. Enter the current run state manually from searchable menus.
4. Add every card currently in their deck, including quantities and upgrade state.
5. Add current relics.
6. Optionally enter potions, current HP, gold, Act, floor, Ascension, boss, and other context.
7. Enter a card reward or shop choice.
8. Receive a ranked recommendation for which card to take — or whether to skip.
9. Receive an explanation showing *why* the recommendation fits the current build.
10. Receive a ranked list of cards that are currently good removal targets.
11. Switch the statistical basis between global/community data, Daily-run data, strong-player data, personal data, or a hybrid.
12. In multiplayer, select a **primary player** whose build is being optimized while optionally entering teammate information so party synergies can influence the recommendation.

The application should remain useful even if the user never imports a save file. **Manual live-run entry is a core requirement, not a fallback.**

---

# 2. Design Principle: Optimize One Player, Understand the Party

Slay the Spire 2 multiplayer supports up to four players.

Multiplayer does **not** combine every player's cards and relics into one inventory. Each player maintains their own character, deck, relics, gold, potions, and most rewards, while the party shares the route and combat context.

Therefore, the recommendation engine should operate like this:

```text
PRIMARY PLAYER BUILD
        ↓
Solo/Card Quality Model
        +
Primary Player Deck Synergy
        +
Primary Player Relic Synergy
        +
Run Context
        +
Optional Party Synergy
        ↓
FINAL RECOMMENDATION
```

The app should never treat all multiplayer cards as though they were part of one giant deck.

The user's own build remains the center of the recommendation.

---

# 3. Application Modes

## 3.1 Singleplayer

This is the primary and simplest experience.

Required state:

- Character
- Ascension
- Current deck
- Upgraded cards
- Relics
- Current Act/floor where available
- Candidate cards

Optional state:

- HP / Max HP
- Gold
- Potions
- Current boss
- Ancient / major run modifier information
- Shop context
- Path context
- Current patch/game version

Singleplayer should receive the most polished recommendation model first.

---

## 3.2 Multiplayer

Multiplayer should be supported from the beginning in the application's data model, even if advanced party scoring is added incrementally.

Required multiplayer information:

- Party size: 2–4
- Primary player
- Primary player's character
- Primary player's deck
- Primary player's relics
- Multiplayer Ascension
- Current Act/floor
- Candidate reward for the primary player

Optional teammate information:

- Teammate character
- Teammate deck
- Teammate relics
- Teammate HP
- Teammate role tags
- Key multiplayer cards
- Full teammate build

The UI should allow:

```text
Party
[ You — Silent ★ ] [ Player 2 — Ironclad ] [ + Add Player ]
```

The star marks the player currently being advised.

Selecting another player can make that player the primary recommendation target.

### Why teammate input is optional

The advisor should still work if the player only knows:

```text
Me: Silent
Partner: Ironclad
```

But the recommendation becomes stronger if the partner's important cards/relics are entered.

This creates three multiplayer confidence levels:

```text
Party Context: LOW
Characters only

Party Context: MEDIUM
Characters + key cards/relics

Party Context: HIGH
Full teammate builds entered
```

---

# 4. Multiplayer-Specific Recommendation Logic

Multiplayer should not simply reuse singleplayer card rankings.

The game contains multiplayer-specific cards and team interactions, and multiplayer run outcomes differ significantly by party size.

A multiplayer recommendation should therefore be:

```text
MultiplayerScore =
    SoloCoreScore
  + MultiplayerCardAdjustment
  + PartyCompositionAdjustment
  + CrossPlayerSynergy
  + PartySurvivalAdjustment
  + MultiplayerStatAdjustment
```

## 4.1 Multiplayer-only cards

The card database needs fields such as:

```js
{
  id: "CARD_ID",
  name: "Card Name",
  character: "silent",
  multiplayerOnly: true,
  singleplayerAvailable: false
}
```

These cards should:

- be hidden from Singleplayer reward entry;
- become searchable in Multiplayer;
- receive statistics from multiplayer runs only;
- receive extra scoring based on teammate interaction.

---

## 4.2 Cross-player synergy

Examples of party-aware reasoning:

- A card that gives Block to allies becomes more valuable with fragile teammates.
- A card that amplifies damage for another player gains value when the party contains a strong damage-focused build.
- A card that benefits summons, debuffs, draw, or resource generation may receive a larger score when teammates exploit those effects.
- A powerful solo card should not automatically become bad simply because a party synergy exists.

Use a separate score:

```text
Party Synergy: +0 to +20
```

rather than allowing multiplayer synergy to completely replace intrinsic card strength.

---

## 4.3 Multiplayer statistics must be segmented

Do not mix these blindly:

```text
Solo
2-player
3-player
4-player
```

The statistics layer should eventually support:

```js
statsFilters = {
  mode: "multiplayer",
  partySize: 2,
  ascension: 8,
  patch: "current",
  character: "silent"
}
```

If sample size is too small, progressively widen the filter:

```text
Exact party size + current patch + ascension
        ↓ insufficient sample
Party size + current patch
        ↓ insufficient sample
All multiplayer + current patch
        ↓ insufficient sample
Recent multiplayer
```

The UI should display when fallback data is being used.

---

# 5. Manual Live Run Entry — Core UX

This is one of the most important parts of the application.

A player in the middle of a run must be able to reconstruct their build quickly without editing text or JSON.

## 5.1 Starting a live session

First screen:

```text
SLAY THE SPIRE 2 BUILD ADVISOR

Run Mode
[ Singleplayer ] [ Multiplayer ]

Character
[ Ironclad ]
[ Silent ]
[ Defect ]
[ Necrobinder ]
[ Regent ]

Ascension
[ 0 ▼ ]

Starter State
[ ✓ Preload starting deck + relic + HP ]

[ Start Run ]
```

For Multiplayer:

```text
Party Size
[ 2 ] [ 3 ] [ 4 ]

YOU
Character: [ Silent ▼ ]

Player 2
Character: [ Ironclad ▼ ]

[ Start Multiplayer Run ]
```

---

# 6. Main Single-Page Layout

Recommended desktop layout:

```text
┌──────────────────────────────────────────────────────────────────┐
│ STS2 BUILD ADVISOR    Silent • A8 • Act 2 • Floor 24 • SOLO    │
├───────────────────┬────────────────────────┬─────────────────────┤
│ RUN               │ YOUR BUILD             │ ADVISOR             │
│                   │                        │                     │
│ Character         │ Cards                  │ CARD REWARD         │
│ Mode              │ [ Search / Add ]       │                     │
│ Ascension         │                        │ [ Card A ]  91      │
│ Act / Floor       │ Acrobatics +      x2   │ [ Card B ]  74      │
│ HP                │ Prepared          x1   │ [ Card C ]  48      │
│ Gold              │ Strike            x4   │ [ Skip ]    51      │
│                   │ ...                    │                     │
│ Relics            │                        │ WHY?                │
│ [ Search / Add ]  │                        │ + deck synergy      │
│                   │                        │ + relic synergy     │
│ [Multiplayer]     │                        │ + strong base stats │
│ Party             │                        │                     │
│                   │                        │ REMOVE              │
│                   │                        │ Strike        94     │
│                   │                        │ Defend        72     │
└───────────────────┴────────────────────────┴─────────────────────┘
```

Mobile should collapse this into vertically stacked panels.

---

# 7. Card Selection UX

The application should behave more like a visual card album than a form.

Clicking **Add Card** opens:

```text
Search cards...
[____________________________]

Filters:
[ All ] [ Attack ] [ Skill ] [ Power ]
[ Common ] [ Uncommon ] [ Rare ]

┌──────────┐ ┌──────────┐ ┌──────────┐
│ Card Art │ │ Card Art │ │ Card Art │
│ Name     │ │ Name     │ │ Name     │
│ Cost     │ │ Cost     │ │ Cost     │
└──────────┘ └──────────┘ └──────────┘
```

Selecting a card adds it to the deck.

Cards in the deck should support:

```text
Acrobatics       [-] 2 [+]    [Normal | Upgraded]    [×]
```

If the deck has both upgraded and unupgraded copies:

```text
Acrobatics
Normal:    1
Upgraded:  2
```

Internally:

```js
deck = [
  {
    cardId: "ACROBATICS",
    normal: 1,
    upgraded: 2
  }
];
```

---

# 8. Relic Selection UX

Use exactly the same searchable album approach.

```text
ADD RELIC

Search relics...
[____________________________]

[ image ] Ring of the Snake
[ image ] Kunai
[ image ] ...
```

Selected relics appear as compact chips or image tiles.

The app should prevent accidental duplicate relics unless the game explicitly permits the relevant duplication.

---

# 9. Multiplayer Party Entry UX

When Multiplayer is active, show party tabs:

```text
PARTY

[ You • Silent ★ ]
[ Alex • Ironclad ]
[ Sam • Defect ]
```

For each teammate, provide two input levels.

### Quick Entry

```text
Character: Ironclad

Party Role:
[ Damage ]
[ Block ]
[ Debuff ]
[ Support ]
[ Scaling ]

Key Cards:
[ Add ]

Key Relics:
[ Add ]
```

### Full Build

```text
[ Enter Full Deck ]
[ Enter All Relics ]
```

This lets users choose between speed and precision.

The primary player's build should always use Full Build mode.

---

# 10. Live Card Reward Workflow

This should be the fastest repeated action in the entire application.

When the player reaches a reward:

```text
WHAT WERE YOU OFFERED?

[ + Select Card 1 ]
[ + Select Card 2 ]
[ + Select Card 3 ]

[ Include Skip ✓ ]

[ Rank Choices ]
```

Then:

```text
1. Adrenaline          91 / 100
   ★ Recommended

2. Backflip            78 / 100

3. Dagger Throw        57 / 100

4. Skip                43 / 100
```

Selecting a result can optionally show:

```text
[ I Picked This ]
```

That automatically adds the chosen card to the live deck.

This means the website can remain open throughout the run.

Flow:

```text
Enter starting build
      ↓
Enter reward
      ↓
Receive recommendation
      ↓
Click "I Picked This"
      ↓
Deck automatically updates
      ↓
Continue playing
      ↓
Repeat
```

This is the core "live run" experience.

---

# 11. Other Live Run Actions

The user should not need to manually rebuild their deck after every event.

Provide quick actions:

```text
+ Add Card
- Remove Card
↑ Upgrade Card
+ Add Relic
- Remove Relic
+ Add Potion
Use Potion
Change HP
Change Gold
Next Floor
Next Act
```

All updates happen entirely in JavaScript state.

---

# 12. Recommendation Output

Never show only a mysterious score.

Every recommendation should explain its main contributors.

Example:

```text
ADRENALINE
Recommendation: 91 / 100
Confidence: HIGH

WHY IT RANKS HIGH

Base card strength                +18
Synergy with Acrobatics           +12
Synergy with Calculated Gamble     +9
Synergy with Kunai                 +7
Current Act suitability            +4
Duplicate impact                   +1

COMMUNITY CONTEXT

Relevant runs: 18,421
Current patch: Yes
Ascension match: A8–A10
Mode: Singleplayer
```

For multiplayer:

```text
TANK
Recommendation: 88 / 100
Confidence: MEDIUM

Solo/card value                   +14
Your deck synergy                 +16
Multiplayer baseline              +18
Ironclad teammate synergy         +11
Party survival need                +7
```

---

# 13. Statistical Sources

The application should be designed around multiple interchangeable data sources.

## Source A — Community / Global

Use large public STS2 run datasets and/or APIs.

Potential source already researched:

**Spire Codex**
- cards
- characters
- relics
- run metrics
- pairings
- draft advice
- deck advisor
- multiplayer data
- patch/version segmentation

The plan should not hard-code the entire application around one provider.

Create an adapter layer:

```js
class StatsProvider {
  async getCards(filters) {}
  async getRelics(filters) {}
  async getCardMetrics(filters) {}
  async getPairings(itemId, filters) {}
  async getDraftAdvice(state, candidates) {}
}
```

Then implement:

```js
class SpireCodexProvider extends StatsProvider {}
```

A future backend or different dataset can replace it without rewriting the UI.

---

# 14. Daily Run Statistics

Support a data-source selector:

```text
Statistics
[ Community ]
[ Daily ]
[ Strong Players ]
[ My Runs ]
[ Hybrid ]
```

Daily mode should attempt to match:

```text
Date / Daily identifier
Character
Modifiers
Game version
Mode
```

Daily samples may be substantially smaller.

Therefore display:

```text
Daily sample: 184 runs
Confidence: Medium
```

If the sample is too small, the model can blend it with broader data:

```text
70% Today's Daily
30% Current-patch community
```

or automatically reduce the weight of Daily data.

---

# 15. Personal Statistics

Personal history can be added after the manual MVP.

The browser can allow the user to select `.run`, `.save`, or compatible JSON files using a normal file input.

All parsing can happen locally in the browser.

The application can maintain an IndexedDB database containing:

```text
Runs
Card choices
Skipped cards
Removals
Wins/losses
Character
Ascension
Patch
Mode
Party size
Final deck
Relics
```

Personal data never needs to leave the browser.

---

# 16. Hybrid Recommendations

Personal statistics are valuable but usually have a tiny sample compared with community statistics.

Do not let 3 personal observations overpower 30,000 community observations.

Use Bayesian-style weighting.

Example:

```text
Personal weight =
personalSample / (personalSample + 100)
```

If the user has:

```text
10 observations
```

personal influence is small.

If the user has:

```text
500 observations
```

personal results become much more important.

Example Hybrid score:

```text
Community score     76
Personal score      91
Personal sample     238

Final hybrid        84
```

---

# 17. Initial Card Recommendation Model

Start with a transparent weighted scoring model.

Example:

```text
CardScore =
    0.25 × BaseStrength
  + 0.35 × DeckSynergy
  + 0.15 × RelicSynergy
  + 0.10 × RunContext
  + 0.05 × DuplicateValue
  + 0.05 × UpgradeValue
  + 0.05 × PersonalAdjustment
```

These weights should be configurable later.

Normalize each component to approximately 0–100 before combining.

---

# 18. Base Strength

Base Strength should consider:

- pick rate;
- skip rate;
- win rate;
- pick-vs-skip performance;
- sample size;
- player-skill bracket;
- current patch;
- character;
- Ascension;
- Singleplayer vs Multiplayer;
- multiplayer party size.

Use Bayesian shrinkage or another sample-confidence correction.

Do not rank a card with 8 observations above a card with 20,000 observations simply because the small sample happened to win more often.

---

# 19. Deck Synergy

Pairwise synergy is the first practical version.

For candidate `C` and current deck cards:

```text
C ↔ card1
C ↔ card2
C ↔ card3
...
```

Possible measurements:

- NPMI
- lift
- conditional pick rate
- pair win rate
- co-occurrence beyond expected frequency

Quantity should matter, but use diminishing returns.

Example:

```js
quantityWeight = Math.sqrt(quantity);
```

This prevents five copies of one card from dominating the entire synergy score linearly.

---

# 20. Relic Synergy

Apply the same approach:

```text
candidate ↔ relic1
candidate ↔ relic2
...
```

The explanation should show only the most important positive and negative interactions.

Example:

```text
Relic interactions:
Kunai               +8
Nunchaku             +4
Velvet Choker        -9
```

---

# 21. Archetype / Mechanic Tags

Pairwise statistics alone can miss conceptual synergies.

Create a tag layer for cards and relics:

```text
draw
discard
exhaust
strength
dexterity
poison
shivs
orbs
energy
zero-cost
summon
block
debuff
vulnerable
weak
multi-hit
retain
status
curse
team-block
ally-buff
multiplayer
```

A card can have several tags.

Example:

```js
{
  id: "CARD_X",
  tags: ["draw", "discard", "zero-cost"]
}
```

This provides a fallback when statistical samples are sparse.

---

# 22. Context-Aware Scoring

Later versions should consider:

- Act
- Floor
- Current HP
- Deck size
- Boss
- Elite path probability
- Gold
- Existing scaling
- Front-loaded damage
- Defensive capability
- Card draw
- Energy
- potion inventory
- multiplayer party health
- party roles

For the MVP, Act and floor are sufficient.

---

# 23. Skip Must Be a Real Candidate

The advisor must be capable of saying:

```text
SKIP — 82
Card A — 74
Card B — 60
Card C — 48
```

Otherwise it encourages deck bloat.

Skip scoring can initially depend on:

- current deck size;
- candidate quality;
- existing archetype cohesion;
- amount of draw;
- energy availability;
- average community skip behavior.

---

# 24. Card Removal Advisor

Removal needs a separate score.

Suggested initial formula:

```text
RemovalPriority =
    LowIntrinsicValue
  + NegativeDeckSynergy
  + Redundancy
  + StarterCardPenalty
  + CursePenalty
  + HistoricalRemovalRate
  + PersonalNegativePerformance
  - KeyArchetypeContribution
  - RelicSynergy
```

Example:

```text
BEST REMOVALS

1. Strike                 94
2. Defend                 73
3. Quick Slash            58
4. Acrobatics             12
```

Display explanation:

```text
Strike

Low current contribution             +28
Very low synergy with deck            +22
Starter-card removal prior            +20
No important relic interaction         +8
```

Do not claim statistical certainty if the available removal-event data is weak.

Show:

```text
Confidence: Low / Medium / High
```

---

# 25. Multiplayer Removal Advice

Card removal should remain centered on the primary player's deck.

Party context can make some cards harder to remove.

Example:

```text
Normally weak card
BUT
provides critical team Block
→ removal score reduced
```

Party-critical cards should receive a protection adjustment.

---

# 26. Data Model

Recommended in-browser state:

```js
const runState = {
  schemaVersion: 1,

  game: {
    version: null,
    mode: "singleplayer", // singleplayer | multiplayer | daily
    ascension: 0,
    act: 1,
    floor: 1,
    boss: null
  },

  primaryPlayerId: "p1",

  players: [
    {
      id: "p1",
      label: "You",
      character: "silent",
      hp: null,
      maxHp: null,
      gold: null,

      deck: [
        {
          cardId: "CARD_ID",
          normal: 1,
          upgraded: 0
        }
      ],

      relics: [],
      potions: [],

      roleTags: []
    }
  ],

  currentChoice: {
    type: "card_reward",
    candidates: [],
    allowSkip: true
  },

  preferences: {
    statsSource: "community",
    strongPlayerFilter: false,
    explainScores: true
  }
};
```

The exact schema can evolve, but the application should support multiple players from day one even if some teammate fields are unused by the first scoring engine.

---

# 27. Persistence

Use `localStorage` for lightweight preferences.

Use `IndexedDB` for:

- saved live runs;
- imported run history;
- cached statistics;
- card/relic metadata;
- cached artwork metadata;
- personal metrics.

Buttons:

```text
[ Save Run ]
[ Resume Run ]
[ New Run ]
[ Export Run ]
[ Import Run ]
```

A user should be able to close the browser and continue entering the run later.

---

# 28. Single-Page Technical Architecture

Initial project:

```text
/sts2-advisor
    index.html
    styles.css
    app.js
    /js
        state.js
        api.js
        scoring.js
        storage.js
        ui.js
        import.js
```

This is still a single-page web application.

If "one physical HTML file" later becomes a strict deployment requirement, the CSS and JavaScript can be bundled or inlined for release.

For development, separate files are easier to maintain.

---

# 29. No Framework Required for MVP

Version 1 can use:

- HTML
- CSS
- Vanilla JavaScript
- `fetch`
- `localStorage`
- `IndexedDB`

No React/Vue/Svelte requirement.

Reasons:

- very small deployment;
- easy GitHub Pages hosting;
- no build pipeline required;
- easier to distribute as a downloadable static app;
- transparent code.

If the UI becomes significantly more complex, a framework can be introduced later.

---

# 30. API Layer

Example interface:

```js
const API = {
  async loadCards() {},
  async loadRelics() {},
  async loadVersions() {},
  async loadMetrics(filters) {},
  async loadPairings(itemId, filters) {},
  async requestDraftAdvice(runState, candidates) {}
};
```

The recommendation engine should not call URLs directly.

Instead:

```text
UI
 ↓
Recommendation Engine
 ↓
Stats Adapter
 ↓
Spire Codex / future provider
```

This protects the application from API changes.

---

# 31. API Caching

Community statistics do not need to be downloaded on every click.

Cache:

```text
cards
relics
patch list
character metrics
pairings
multiplayer metrics
```

Cache key example:

```text
stats:
patch=current
mode=multiplayer
party=2
character=silent
ascension=8
```

Each cached object should have:

```js
{
  fetchedAt: 1770000000000,
  data: {}
}
```

---

# 32. Patch Awareness

Slay the Spire 2 is in active Early Access development.

This is a critical requirement.

Every statistical object should ideally include:

```text
game version
data date range
sample size
```

Never mix old balance data into current recommendations without labeling it.

Recommended UI:

```text
DATA
Current Patch Only ✓

Current sample: 3,284
Need more data?
[ Allow recent previous patch data ]
```

Fallback data should have reduced weight.

---

# 33. Confidence Model

Every recommendation gets a confidence label.

Example:

```text
HIGH
> 5,000 relevant observations

MEDIUM
500–5,000 observations

LOW
< 500 observations
```

The actual thresholds should be tuned after inspecting dataset distributions.

Confidence can also be penalized by:

- outdated patch data;
- missing multiplayer party state;
- missing deck/relic synergy records;
- Daily sample scarcity.

---

# 34. Recommendation Explanation Format

Keep explanations concise while offering a detailed panel.

Collapsed:

```text
Adrenaline — 91
Excellent fit for your current draw/discard engine.
```

Expanded:

```text
Base quality                 85
Deck synergy                 96
Relic synergy                78
Act relevance                82
Personal result              71

Top positive interactions:
Acrobatics                  +11
Calculated Gamble            +8
Kunai                        +6

Data:
18,421 comparable observations
Current patch
A7–A10
Singleplayer
```

---

# 35. MVP Scope

## MVP 0.1 — Manual Singleplayer Advisor

Must contain:

- Single page UI
- Five character selection
- Ascension selector
- Automatic character starter-state seeding (deck + starter relic + HP)
- Manual card album
- Card quantities
- Upgrade state
- Manual relic album
- Act/floor
- Three-card reward entry
- Skip option
- Basic score
- Recommendation explanation
- Card removal ranking
- Local run persistence

This version is useful without any file import.

---

# 36. MVP 0.2 — Multiplayer-Aware State

Add:

- Singleplayer / Multiplayer switch
- Party size
- 2–4 player tabs
- Primary player designation
- teammate characters
- quick teammate role entry
- optional teammate key cards/relics
- multiplayer-only card visibility
- multiplayer-specific statistics
- party synergy adjustment

The application's internal multi-player model should already exist in 0.1 so this is an extension, not a rewrite.

---

# 37. MVP 0.3 — Full Multiplayer Builds

Add:

- full manual deck entry for every player;
- full relic entry for every player;
- party-wide synergy analysis;
- card recommendations influenced by teammate builds;
- party-critical-card warnings;
- shared reward / relic allocation guidance where statistically meaningful.

Example future feature:

```text
CHEST RELIC ALLOCATION

Kunai
Best recipient: Silent

Relic B
Best recipient: Ironclad
```

This is secondary to card-pick advice but fits the same model well.

---

# 38. MVP 0.4 — Personal Run History

Add:

- `.run` file import;
- `.save` import where supported;
- historical choice parser;
- personal card results;
- personal removal habits;
- personal character results;
- personal-vs-community comparison;
- Hybrid recommendation source.

This is an enhancement, not required for live manual use.

---

# 39. MVP 0.5 — Advanced Advisor

Possible features:

- shop purchase ranking;
- shop removal value;
- potion recommendations;
- boss-specific scoring;
- elite-path preparedness;
- route advice;
- Ancient selection;
- relic reward selection;
- event-choice evaluation;
- multiplayer relic allocation;
- party role recommendations.

---

# 40. Development Order

Recommended order:

### Phase 1 — Data and State

1. Define canonical card/relic IDs.
2. Define multi-player-capable `runState`.
3. Connect game-data API.
4. Build caching.
5. Build local persistence.

### Phase 2 — Manual Live UI

6. Character selection.
7. Card album.
8. Deck editor.
9. Relic album.
10. Run context editor.
11. Reward entry.
12. Automatic deck update after "I Picked This."

### Phase 3 — Basic Scoring

13. Community card metrics.
14. Skip ranking.
15. Pairwise deck synergy.
16. Relic synergy.
17. Recommendation explanation.
18. Confidence score.

### Phase 4 — Removal Advisor

19. Removal heuristics.
20. Community removal statistics if available.
21. Contextual removal explanation.

### Phase 5 — Multiplayer

22. Party tabs.
23. Primary player logic.
24. Multiplayer-only cards.
25. Party-size statistics.
26. Cross-player synergy.
27. Multiplayer confidence model.

### Phase 6 — Personalization

28. Run-history import.
29. Personal model.
30. Hybrid weighting.
31. Export/import local advisor sessions.

---

# 41. Minimum Useful First Release

The first public version does **not** need:

- login;
- cloud database;
- automatic save watching;
- desktop software;
- machine learning;
- route planner;
- complete personal history analytics.

A genuinely useful first release is:

```text
Select character
      ↓
Enter current deck manually
      ↓
Enter relics manually
      ↓
Enter current reward
      ↓
See ranked choices + explanation
      ↓
Click selected card
      ↓
Continue same live run
```

with optional Multiplayer mode.

That should be the development target.

---

# 42. Important UX Requirement: Speed

If entering a 25–35 card deck takes ten minutes, players will not use the live advisor.

Target interaction:

- Search result appears immediately as the player types.
- Clicking card art adds it.
- Repeated click increases quantity.
- Upgrade toggle takes one click.
- Starter decks can be preloaded automatically.
- Character selection should preload that character's starting deck and relic where appropriate.
- Keyboard navigation should work.
- Recently selected cards can appear first.
- Common starter cards should have quick buttons.
- Deck can be sorted by name/type/cost.
- Reward entry should reuse the same search component.

Ideal manual reconstruction time:

```text
Character + starter deck: automatic
Additional cards: roughly one click/search each
Relics: roughly one click/search each
```

---

# 43. Character Starter-State Presets — Required

Selecting a character should **immediately pre-populate the live build** with that character's normal starting state. This is the default behavior, not an optional convenience buried behind another button.

The purpose is to make mid-run reconstruction fast:

```text
Select Silent
      ↓
12 starting cards appear automatically
Ring of the Snake appears automatically
Starting HP is filled automatically
      ↓
User only enters what has changed since Floor 1
```

The app should also provide:

```text
[ Reset to Character Start ]
```

This restores the selected character's base starter deck, starter relic, and starting HP for the currently selected Ascension.

Because Slay the Spire 2 is in active Early Access, these values were verified on August 20, 2026 and should be represented as versioned configuration data rather than scattered hard-coded UI assumptions.

## 43.1 Current starter-state table

| Character | Starting HP | Ascension 2+ starting HP | Starter Relic | Starting Deck |
|---|---:|---:|---|---|
| Ironclad | 80 | 64 | Burning Blood | Strike ×5, Defend ×4, Bash ×1 |
| Silent | 70 | 56 | Ring of the Snake | Strike ×5, Defend ×5, Neutralize ×1, Survivor ×1 |
| Regent | 75 | 60 | Divine Right | Strike ×4, Defend ×4, Falling Star ×1, Venerate ×1 |
| Necrobinder | 66 | 52 | Bound Phylactery | Strike ×4, Defend ×4, Bodyguard ×1, Unleash ×1 |
| Defect | 75 | 60 | Cracked Core | Strike ×4, Defend ×4, Zap ×1, Dualcast ×1 |

The normal starting deck contains no upgraded copies.

## 43.2 Preset configuration

Keep starter states in one canonical configuration object:

```js
const CHARACTER_STARTERS = {
  ironclad: {
    maxHp: 80,
    ascension2PlusHp: 64,
    starterRelics: ["BURNING_BLOOD"],
    deck: [
      { cardId: "IRONCLAD_STRIKE", normal: 5, upgraded: 0 },
      { cardId: "IRONCLAD_DEFEND", normal: 4, upgraded: 0 },
      { cardId: "BASH", normal: 1, upgraded: 0 }
    ]
  },

  silent: {
    maxHp: 70,
    ascension2PlusHp: 56,
    starterRelics: ["RING_OF_THE_SNAKE"],
    deck: [
      { cardId: "SILENT_STRIKE", normal: 5, upgraded: 0 },
      { cardId: "SILENT_DEFEND", normal: 5, upgraded: 0 },
      { cardId: "NEUTRALIZE", normal: 1, upgraded: 0 },
      { cardId: "SURVIVOR", normal: 1, upgraded: 0 }
    ]
  },

  regent: {
    maxHp: 75,
    ascension2PlusHp: 60,
    starterRelics: ["DIVINE_RIGHT"],
    deck: [
      { cardId: "REGENT_STRIKE", normal: 4, upgraded: 0 },
      { cardId: "REGENT_DEFEND", normal: 4, upgraded: 0 },
      { cardId: "FALLING_STAR", normal: 1, upgraded: 0 },
      { cardId: "VENERATE", normal: 1, upgraded: 0 }
    ]
  },

  necrobinder: {
    maxHp: 66,
    ascension2PlusHp: 52,
    starterRelics: ["BOUND_PHYLACTERY"],
    deck: [
      { cardId: "NECROBINDER_STRIKE", normal: 4, upgraded: 0 },
      { cardId: "NECROBINDER_DEFEND", normal: 4, upgraded: 0 },
      { cardId: "BODYGUARD", normal: 1, upgraded: 0 },
      { cardId: "UNLEASH", normal: 1, upgraded: 0 }
    ]
  },

  defect: {
    maxHp: 75,
    ascension2PlusHp: 60,
    starterRelics: ["CRACKED_CORE"],
    deck: [
      { cardId: "DEFECT_STRIKE", normal: 4, upgraded: 0 },
      { cardId: "DEFECT_DEFEND", normal: 4, upgraded: 0 },
      { cardId: "ZAP", normal: 1, upgraded: 0 },
      { cardId: "DUALCAST", normal: 1, upgraded: 0 }
    ]
  }
};
```

The exact API IDs may differ from the illustrative IDs above. When implementation begins, map these names to the canonical IDs returned by the selected game-data provider.

## 43.3 Ascension-sensitive initialization

Character selection and Ascension selection should work together.

Example:

```js
function getStartingHp(characterId, ascension) {
  const preset = CHARACTER_STARTERS[characterId];
  return ascension >= 2
    ? preset.ascension2PlusHp
    : preset.maxHp;
}
```

When a user changes Ascension before making manual HP edits, the starter HP should update automatically.

Once the user manually edits current HP, changing filters or other advisor settings should **not** overwrite their live value without confirmation.

## 43.4 Starter relic behavior

The starter relic must be pre-selected automatically.

Examples:

```text
Ironclad     → Burning Blood
Silent       → Ring of the Snake
Regent       → Divine Right
Necrobinder  → Bound Phylactery
Defect       → Cracked Core
```

The relic remains fully editable because a live run may have replaced or upgraded it.

If a player resets to the starter state, restore the base starter relic.

## 43.5 Reconstructing a run already in progress

The expected workflow should be additive/subtractive rather than starting from an empty deck.

Example:

```text
Select Silent
      ↓
App seeds:
5 Strike
5 Defend
Neutralize
Survivor
Ring of the Snake
      ↓
Player removes the Strike already removed in-game
      ↓
Player adds the 7 cards obtained so far
      ↓
Player adds new relics
      ↓
Live build is ready
```

This should be dramatically faster than requiring all 12 starting cards to be entered manually.

## 43.6 Multiplayer starter states

Every multiplayer party member should use the same character preset mechanism.

Example:

```text
YOU — Silent
Auto-seeded:
12 starting cards
Ring of the Snake
70 HP at A0–A1 / 56 HP at A2+

PLAYER 2 — Ironclad
Auto-seeded:
10 starting cards
Burning Blood
80 HP at A0–A1 / 64 HP at A2+
```

For teammate **Quick Entry**, the user can leave the seeded starter state untouched and add only important changes.

For teammate **Full Build**, the seeded deck/relic becomes the editable base just like the primary player's build.

If multiplayer Ascension changes starting HP in the same way as the selected run rules, the preset engine should apply the appropriate shared Ascension setting rather than maintaining unrelated values per player.

## 43.7 Preset UI rules

When the character changes:

1. If the build is still untouched, immediately replace it with the new character's starter state.
2. If the user has already edited the deck/relics, show a clear confirmation before replacing that work.
3. Always expose **Reset to Character Start**.
4. Allow **Start Empty** as a secondary advanced action for unusual/custom scenarios.
5. Default to the starter preset.

Recommended control:

```text
STARTING STATE

● Character starter state
○ Empty build

[ Reset to Character Start ]
```

## 43.8 Neow / opening changes

The starter preset should represent the character's **base pre-run loadout**.

If an opening blessing or other beginning-of-run effect changes cards, relics, gold, or other state, the user simply applies those changes through the normal live-run controls.

Do not create dozens of separate hard-coded "post-Neow" presets in the MVP.

The intended flow is:

```text
Base starter preset
      +
manual opening changes
      =
actual Floor 1 build
```

This keeps the preset system simple and robust.


# 44. Search Design

Card/relic search should support:

```text
Name
Partial name
Card text
Mechanic tag
Type
Rarity
Cost
```

Example:

```text
search: discard
```

shows cards tagged or described as discard-related.

This also turns the application into a useful card/relic reference even when the advisor is not being used.

---

# 45. Visual "Synergy Album"

A separate tab/panel can visualize the current build.

```text
BUILD SYNERGY

Discard            █████████  Strong
Draw               ████████   Strong
Zero-cost          █████      Moderate
Poison             ██         Weak
Block              ███        Needs support
Scaling            ███        Needs support
```

Then recommended cards can visually show:

```text
+ strengthens Draw
+ strengthens Discard
+ fills Scaling weakness
```

This is easier to understand than raw statistics alone.

---

# 46. Potential Community Data Provider

Current research indicates **Spire Codex** is a strong candidate for the initial data layer because it exposes STS2 card/relic data, run statistics, pairings, draft advice, game versions, and multiplayer run data.

Do not make this a permanent architectural dependency.

Use a provider abstraction.

Potential endpoints/features to investigate during implementation include:

```text
Cards
Relics
Characters
Run metrics
Pairings
Draft advice
Deck advisor
Pick coach
Game versions
Daily filtering
Multiplayer filtering
Party-size filtering
```

Before implementation, verify each endpoint's current schema and browser CORS behavior.

---

# 47. Known Multiplayer Facts Relevant to the App

As of this plan:

- STS2 supports up to four-player co-op.
- Players travel the same route and fight the same encounters.
- Each player maintains their own deck and most personal resources.
- Multiplayer-specific cards exist.
- Treasure/relic allocation can involve party decisions.
- Multiplayer Ascension is distinct from singleplayer progression.
- Multiplayer statistics should therefore not be treated as interchangeable with singleplayer statistics.

These facts justify keeping:

```text
mode
partySize
primaryPlayer
players[]
```

in the root state model.

---

# 48. Legal / Attribution Considerations

The application should identify itself as an unofficial community tool.

Suggested footer:

```text
Unofficial Slay the Spire 2 community tool.
Not affiliated with or endorsed by Mega Crit.
Game content and trademarks belong to their respective owners.
Statistical data source attribution shown where applicable.
```

Do not redistribute assets unless their permitted use is clear.

Prefer API-provided asset URLs or appropriately licensed/community-permitted sources rather than embedding large copies of game art without checking terms.

---

# 49. Reliability Strategy

The advisor should remain usable if the statistics API temporarily fails.

Fallback behavior:

```text
API available
→ full recommendation

API unavailable but cached data exists
→ cached recommendation + "cached data" badge

No statistics available
→ manual build view remains usable
→ optionally use local heuristic/tag scoring
```

Never destroy the user's manually entered run because an API call fails.

---

# 50. Security / Privacy

Manual run state stays local unless sent as necessary parameters to a statistics API.

Personal run-history imports should default to local processing.

Do not upload arbitrary save/history files without explicit disclosure.

Store only game-state information in browser storage.

Provide:

```text
[ Clear Local Data ]
```

---

# 51. Success Criteria for Version 1

The product is successful when a user can:

1. Open one web page.
2. Select Singleplayer or Multiplayer.
3. Select their character.
4. Reconstruct a live build manually.
5. Add relics.
6. Enter a three-card reward.
7. Get a ranked result including Skip.
8. See understandable statistical/synergy reasons.
9. Get a ranked removal suggestion.
10. Click their choice so the live run state updates.
11. Continue using the same page for the rest of the run.
12. In Multiplayer, keep recommendations centered on one selected player's build while optionally incorporating teammates.

---

# 52. Recommended First Coding Target

Build the application skeleton around this exact workflow first:

```text
NEW RUN
   ↓
MODE
Singleplayer / Multiplayer
   ↓
CHARACTER
   ↓
ASCENSION
   ↓
AUTO-SEED CHARACTER STARTER STATE
(deck + starter relic + starting HP)
   ↓
MANUAL DECK EDITOR
   ↓
MANUAL RELIC EDITOR
   ↓
CARD REWARD
   ↓
RANK
   ↓
EXPLAIN
   ↓
"I PICKED THIS"
   ↓
DECK UPDATES
   ↓
NEXT REWARD
```

For Multiplayer:

```text
NEW MULTIPLAYER RUN
   ↓
PARTY SIZE
   ↓
SELECT PRIMARY PLAYER
   ↓
ENTER PRIMARY BUILD
   ↓
OPTIONALLY ENTER TEAMMATES
   ↓
REWARD
   ↓
SOLO-CORE SCORE
   +
MULTIPLAYER/PARTY ADJUSTMENT
   ↓
RECOMMENDATION
```

This is the strongest foundation because it produces a useful live companion before advanced analytics, automatic save imports, or machine-learning models are required.

---

# 53. Immediate Next Implementation Tasks

When development begins, the first engineering session should produce:

1. `index.html` SPA shell.
2. Responsive three-panel desktop layout.
3. Character selection.
4. Singleplayer/Multiplayer toggle.
5. Party state model with `primaryPlayerId`.
6. Versioned `CHARACTER_STARTERS` preset configuration for all five characters.
7. Automatic starter deck/relic/HP seeding on character selection.
8. **Reset to Character Start** and secondary **Start Empty** actions.
9. Hard-coded temporary sample card/relic objects where API data is not yet connected.
10. Searchable card selector.
11. Searchable relic selector.
12. Editable live deck state.
13. Reward candidate entry.
14. Placeholder ranking output.
15. Save/restore current run from browser storage.

Only after the manual workflow feels fast should the real statistics API be attached.

This prevents API work from obscuring UX problems.

---

# 54. Research References

These references informed the feasibility and multiplayer portions of this plan.

- Mega Crit / Steam — Slay the Spire 2 official store information and co-op support.
  https://store.steampowered.com/app/2868840/Slay_the_Spire_2/

- Slay the Spire Wiki.gg — STS2 Multiplayer mechanics, party structure, individual decks/resources, shared route, multiplayer cards.
  https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Multiplayer

- Slay the Spire Wiki.gg — Current STS2 character starter loadouts and HP values (verified August 20, 2026):
  - Ironclad: https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Ironclad
  - Silent: https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Silent
  - Regent: https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Regent
  - Necrobinder: https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Necrobinder
  - Defect: https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Defect

- Spire Codex — Community run statistics and multiplayer analysis.
  https://spire-codex.com/

- Spire Codex developer/API documentation.
  https://spire-codex.com/developers

- STS Tracker — Community run tracking / companion concepts.
  https://ststracker.app/

---

# 55. Final Product Direction

The main differentiator should be:

> **A live, manually editable build advisor that explains the best next choice for *your exact current build*, rather than displaying a generic tier list.**

Singleplayer should remain the reference model and receive the deepest statistical tuning.

Multiplayer should extend that model instead of replacing it:

> **Optimize my deck first; then adjust for the team.**

That architecture lets the application be simple enough to build as a static single-page HTML/JavaScript site while leaving room for sophisticated statistical recommendations, full multiplayer party analysis, personal run history, and live companion features later.
