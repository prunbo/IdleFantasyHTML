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
| **Quests** | 166 of the app's 189 quests auto-track (gather / craft / kill / dungeon / thieving / prayer / slayer families) with claimable rewards. |
| **Farming** | Real-time crop patches (3/4/5 by level), seeds from the shop, ash fertilizer (up to 2.5× yield), farming pet at 1/1000 per harvest, and the rare Magic Bean that unlocks the Cloud Kingdom dungeon. |
| **Herblore** | All 16 potions brewed from crops + monster parts; one dose is consumed per combat session for flat stat bonuses (attack/strength/defense/ranged/magic, up to Overload +10 all). |
| **Slayer** | Slayer Master task assignment, bone-powered foretelling queue, task skipping, Slayer points and the points shop (XP lamps, Slayer helm, Abyssal whip, plate armour). |
| **Guilds** | 18 guilds × 10 ranks: progression quests tracked automatically + up to 4 date-seeded daily requests per guild (6am reset); rank 10 awards the guild cape. |
| **Infinite Tower** | Endless floors with the app's tier table, 100+ floor enemy scaling (HP → 10× at 250), 25 milestone rewards (gear, pets, permanent XP/HP/coin bonuses), death checkpoints every 25 floors, ammo/rune reclaim. |
| **Carnival** | The four idle minigames (Archery, Strongman, Wizard's Duel, Fishing Derby) convert skill levels into tickets, an animated Ring Toss with difficulty + cooldown, and the full prize shop (XP lamps, gear, the Juggling Imp pet). |
| **Pets** | All 25 pets as passive collectibles — ≈6% drop chance per gathering/crafting session, farming harvests, the Tower floor-100 pet, and the Carnival pet. Owned pets stack their XP boosts. |
| **Quality of life** | Live tick-by-tick combat feed with HP bar during dungeon/tower runs, 🔁 Repeat-last-session (persisted across reloads), welcome-back banner for offline progress, session-complete toasts, bulk Plant-all / Harvest-all farming, grouped skill board with pet/cape badges, pet collection silhouettes with hints, tower survival rating, 💾 save indicator, and a mobile-friendly layout. |

### Not in the web edition (yet)

Construction, Mercantile trade routes, church blessings, the Inn's hired workers,
expeditions/skilling dungeons, raid bosses, seasonal events, the Builder's Workshop,
and localized strings. The Android app remains the full experience.

## Code map

```
web/
├── index.html          # app shell
├── css/style.css       # dark fantasy theme
├── js/
│   ├── util.js         # helpers (rng, formatting, tier lookups)
│   ├── data.js         # loads the game's original JSON assets, builds lookups
│   ├── sim.js          # ported simulators (XP table, gathering, crafting, combat)
│   ├── state.js        # player state, equipment bonuses, localStorage save/load
│   ├── engine.js       # session lifecycle, shop, quests
│   ├── systems.js      # farming, slayer, guilds, carnival, tower, pets
│   ├── ui.js           # screen rendering + interactions
│   ├── ui-town.js      # Town tab + farming/herblore/pets UI
│   └── main.js         # boot, tick loop, autosave, offline catch-up
├── data/               # copied verbatim from app/src/main/assets/data
└── test/               # headless Node test suites (npm-less): node test/smoke.js
```

Run the tests with Node (no dependencies):

```bash
node test/smoke.js    # simulators, engine, shop, quests, save round-trip
node test/systems.js  # farming, herblore, slayer, guilds, carnival, tower, pets
node test/ui.js       # every screen rendered against a virtual DOM
```

## License

GPL-3.0, like the upstream game. The JSON data under `web/data/` is copied from
`app/src/main/assets/data` in this repository.
