# ⚔️ Idle Fantasy — Web Edition

A browser port of the open-source Android idle RPG **[Idle Fantasy](https://github.com/tristinbaker/IdleFantasy)**.
Same game data, same combat math — playable in any browser.

> Set your hero to work. Close the tab. Come back to loot.

## Play it

Serve this `web/` folder over HTTP (fetching the JSON game data requires it — opening
`index.html` straight from disk won't work):

```bash
cd web
python3 -m http.server 8080
# open http://localhost:8080
```

Progress is saved automatically to your browser's `localStorage` (autosave every 10 s
and on tab close). Use 📤/📥 in the top bar to export/import a save code.

## What's in the port

| System | Details |
| --- | --- |
| **Session engine** | Faithful port of the Android pre-simulation model: starting a session rolls all 60 one-minute frames up front; results are revealed in real time and collected when done. Works fully offline — close the tab and come back. |
| **Agility** | Sessions shrink from 60 min (level 1) to 40 min (level 99), exactly like the app. |
| **Combat** | Tick-by-tick port of `CombatSimulator`: OSRS-style max-hit and hit-chance formulas, 2.4 s enemy attack cadence, per-weapon attack speeds, auto-eating (best food first, ≤300/session, 50 % HP threshold), death forfeits loot but keeps XP, per-run dungeon rare drops. |
| **XP curve** | The app's exact `xp_table.json` (level 99 = 13,034,431 XP). Combat XP splits ~70 % main style / 15 % Hitpoints / 15 % Defense. |
| **Skills (21)** | Mining, Woodcutting, Fishing, Thieving, Agility, **Farming**, Firemaking, Smithing, Cooking, Fletching, Crafting, Runecrafting (2×/3× multipliers at 50/75), **Herblore**, Prayer, Attack, Strength, Defense, Ranged, Magic, Hitpoints, **Slayer**. |
| **Production** | Quantity-based sessions like the app (`buildCraftFrames`): materials consumed up front, session length scales with amount and tool efficiency. |
| **Dungeons** | All 29 dungeons with their real enemy rosters, weights, drops and safe zones, plus the survival-rating estimator. |
| **Gear** | 340+ equipment pieces with slots, level requirements, two-handed rules, tool efficiencies (pickaxes, axes, rods, hammers… incl. the +25 %/tier over-level bonus) and skill capes at 99. |
| **Shop** | The app's marketplace catalogue and its sell-price heuristics (bars by metal, gems by rarity, etc.). |
| **Quests** | All **189** of the app's quests auto-track (gather / craft / kill / dungeon / boss-slaying / building-upgrade / thieving / prayer / slayer families) with claimable rewards. |
| **Farming** | Real-time crop patches (3/4/5 by level), seeds from the shop, ash fertilizer (up to 2.5× yield), farming pet at 1/1000 per harvest, and the rare Magic Bean that unlocks the Cloud Kingdom dungeon. |
| **Herblore** | All 16 potions brewed from crops + monster parts; one dose is consumed per combat session for flat stat bonuses (attack/strength/defense/ranged/magic, up to Overload +10 all). |
| **Slayer** | Slayer Master task assignment, bone-powered foretelling queue, task skipping, Slayer points and the points shop (XP lamps, Slayer helm, Abyssal whip, plate armour). |
| **Guilds** | 18 guilds × 10 ranks: progression quests tracked automatically + up to 4 date-seeded daily requests per guild (6am reset); rank 10 awards the guild cape. |
| **Infinite Tower** | Endless floors with the app's tier table, 100+ floor enemy scaling (HP → 10× at 250), 25 milestone rewards (gear, pets, permanent XP/HP/coin bonuses), death checkpoints every 25 floors, ammo/rune reclaim. |
| **Carnival** | The four idle minigames (Archery, Strongman, Wizard's Duel, Fishing Derby) convert skill levels into tickets, an animated Ring Toss with difficulty + cooldown, and the full prize shop (XP lamps, gear, the Juggling Imp pet). |
| **Pets** | All 25 pets as passive collectibles — ≈6% drop chance per gathering/crafting session, farming harvests, the Tower floor-100 pet, and the Carnival pet. Owned pets stack their XP boosts. |
| **Quality of life** | Live tick-by-tick combat feed with HP bar during dungeon/tower runs, 🔁 Repeat-last-session (persisted across reloads), welcome-back banner for offline progress, session-complete toasts, bulk Plant-all / Harvest-all farming, grouped skill board with pet/cape badges, pet collection silhouettes with hints, tower survival rating, 💾 save indicator, and a mobile-friendly layout. |

| **Construction** | All 13 furniture recipes from planks (Fletching), nails (Smithing) and stone; the finished furniture feeds the Builder's Workshop, and 8 Construction quests + the Construction guild are tracked. |
| **Mercantile** | All 6 trade routes with the app's exact coin/XP range math — caravan costs are paid up front, one coin total is rolled per run and split across the 60 frames; the Merchants guild tracks route runs and coins earned. |
| **Church** | All 30 blessings (XP ×1.05→×1.50, Defense +2→+35, Coins +8%→+25%) with the app's bone costs and greedy bone consumption; one active blessing at a time, extendable, shown live on the Home screen and applied to collected XP/coins and combat defense. |
| **Inn workers** | Hire a Long Laborer (slot 1) or Apprentice/Journeyman/Master (slot 2) — the app's exact hour×efficiency multipliers (8h×0.5 … 4h×2.5), crafting caps per tier, workers run in parallel with your hero, use your gear for dungeon/boss jobs, benefit from the Inn building's XP bonus, and are dismissed after their one job. Plus the daily bulk-food menu. |
| **Expeditions** | All 10 skilling dungeons with tiered XP/drop tables and per-frame lore-note rolls (incl. the 10-dry-run pity note). Collecting notes reveals the expedition's lore; finding all of them unlocks its hidden combat dungeon — 11 lore-gated dungeons now open the same way as in the app. |
| **Raid bosses** | All 8 bosses as long single-target fights (tick-by-tick port of `CombatSimulator.simulateBoss`, incl. the DPS fallback): combat-level gating, food/ammo consumption, win = full XP rewards + loot table + rare drops + pet roll, loss = 10% XP; ammo reclaim; 20 boss-slaying quests. |
| **Seasonal events** | Date-driven events with the full token economy: Bounty Board (one slot per task type, rotation cooldowns, 6am rerolls, turn-in tasks), expedition/boss/minigame token pillars, reward tiers, Night Market with coin-priced offers and cooldown-skip effects, and the whack-a-mole / Simon-says minigame with easy mode. |
| **Builder's Workshop** | All 9 town buildings × 3 tiers with the app's per-mille builder's discount (0.5%/Construction level): worker XP, guild-quest reduction, longer blessings, extra farm plots, extra carnival games + faster cooldowns + idle tickets, material preservation, and Chronos Spire session speed-up — all wired into their systems. |
| **XP boost** | The shop's 48h 2× XP boost (2.5M coins) and the seasonal reward-tier boost, applied to every collected session. |
| **Localization** | 17 languages generated from the app's Weblate translations (`scripts/build_web_locales.py` → `i18n/*.json`), a 🌐 language picker, auto-detection, and localized navigation + the new systems' screens (more strings migrate to the table over time; untranslated keys fall back to English). |

### Not in the web edition (yet)

Skill prestige, the Fairgrounds' two extra active carnival games (Shell Game and
Higher or Lower), the action queue, arena records, achievements, titles, custom
themes, the Monument, save slots, character customization, daily/weekly quest
boards, and full-parity string coverage. The Android app remains the full
experience.

## Code map

```
web/
├── index.html          # app shell
├── css/style.css       # dark fantasy theme
├── i18n/               # generated locales (scripts/build_web_locales.py)
├── js/
│   ├── util.js         # helpers (rng, formatting, tier lookups)
│   ├── i18n.js         # localized strings (loads i18n/<locale>.json)
│   ├── data.js         # loads the game's original JSON assets, builds lookups
│   ├── sim.js          # ported simulators (XP table, gathering, crafting, combat, mercantile, skilling dungeons, bosses)
│   ├── state.js        # player state, equipment bonuses, town/church/inn/expedition/seasonal state, localStorage save/load
│   ├── systems.js      # farming, slayer, guilds, carnival, tower, pets
│   ├── systems-town.js # church, builder's workshop, inn workers, expeditions, raid bosses, seasonal events
│   ├── engine.js       # session lifecycle (incl. worker jobs), shop, quests
│   ├── ui.js           # screen rendering + interactions
│   ├── ui-town.js      # Town tab (slayer/guilds/church/inn/builder/expeditions/event/carnival/tower), farming/herblore/pets UI
│   └── main.js         # boot, tick loop, autosave, offline catch-up, language picker
├── data/               # copied verbatim from app/src/main/assets/data
└── test/               # headless Node test suites (npm-less): node test/smoke.js
```

Run the tests with Node (no dependencies):

```bash
node test/smoke.js    # simulators, engine, shop, quests, save round-trip
node test/systems.js  # farming, herblore, slayer, guilds, carnival, tower, pets
node test/port2.js    # construction, mercantile, church, builder, inn workers, expeditions, bosses, seasonal, i18n
node test/ui.js       # every screen rendered against a virtual DOM
```

After changing the Android string resources (or adding `t('…')` lookups to the
web UI), regenerate the locale files from the repo root:

```bash
python3 scripts/build_web_locales.py
```

## License

GPL-3.0, like the upstream game. The JSON data under `web/data/` is copied from
`app/src/main/assets/data` in this repository.
