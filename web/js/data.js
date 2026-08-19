/* ------------------------------------------------------------------ *
 * data.js — loads the game's original JSON assets and builds lookups
 * ------------------------------------------------------------------ */
'use strict';

const GameData = {
  loaded: false,
  xpTable: [],          // index = level (1..99) -> xp required
  ores: {}, trees: {}, fish: {}, logs: {}, gems: {}, runes: {}, bones: {},
  agilityCourses: {}, thievingNpcs: [], spells: {}, equipment: {}, enemies: {},
  dungeons: {}, marketplace: {}, quests: {},
  crops: {}, slayerTasks: {}, pets: {}, carnivalPrizes: {},
  guildQuests: {}, guildDailies: [], herbloreRecipes: {},
  townBuildings: {}, raidBosses: {}, seasonalEvents: {},
  tradeRoutes: {},          // id -> route data
  tradeRouteList: [],       // sorted by level
  skillingDungeons: {},     // key -> expedition data
  skillingDungeonList: [],  // sorted by level
  potionEffects: {},   // potion itemKey -> {stat: bonus}
  petBySkill: {},      // boosted_skill -> pet data (first match)
  recipes: { smithing: {}, cooking: {}, fletching: {}, crafting: {}, herblore: {}, construction: {} },
  names: {},            // itemKey -> display name
  foodHeals: {},        // itemKey -> heal value
  arrowBonuses: {},     // arrow itemKey -> ranged strength bonus
  ashByLog: {},         // logKey -> ash item key
  itemNameSource: {},

  async loadAll() {
    // Embedded bundle first (lets the game run from file:// with no server);
    // fall back to fetching the JSON files when the bundle is absent.
    const j = async p => {
      if (typeof GAME_BUNDLE !== 'undefined' && GAME_BUNDLE[p] != null) return GAME_BUNDLE[p];
      const base = 'data/';
      const r = await fetch(base + p);
      if (!r.ok) throw new Error('Failed to load ' + p);
      return r.json();
    };

    const [xp, ores, gems, trees, logs, fish, runes, spells, bones, agility, thieving,
      marketplace, quests, equipment, enemies, fishingSkill,
      smithing, cooking, fletching, crafting, construction, manifest,
      crops, slayerTasks, pets, carnivalPrizes, guildQuests, guildDailies, herblore,
      buildings, raidBosses, seasonalEvents] = await Promise.all([
      j('xp_table.json'), j('ores.json'), j('gems.json'), j('trees.json'), j('logs.json'),
      j('fish.json'), j('runes.json'), j('spells.json'), j('bones.json'),
      j('agility_courses.json'), j('thieving_npcs.json'), j('marketplace.json'),
      j('quests.json'), j('equipment.json'), j('enemies.json'), j('skills/fishing.json'),
      j('recipes/smithing.json'), j('recipes/cooking.json'), j('recipes/fletching.json'),
      j('recipes/crafting.json'), j('recipes/construction.json'), j('dungeons.json'),
      j('crops.json'), j('slayer_tasks.json'), j('pets.json'), j('carnival_prizes.json'),
      j('guild_quests.json'), j('guild_daily_quests.json'), j('recipes/herblore.json'),
      j('buildings.json'), j('raid_bosses.json'), j('seasonal_events.json'),
    ]);

    this.xpTable = xp.levels;
    this.ores = ores; this.gems = gems; this.trees = trees; this.fish = fish;
    this.logs = logs; this.gems = gems; this.runes = runes; this.spells = spells;
    this.bones = bones; this.agilityCourses = agility; this.thievingNpcs = thieving;
    this.marketplace = marketplace; this.quests = quests; this.equipment = equipment;
    this.enemies = enemies;
    this.fishingSkill = fishingSkill;
    this.recipes = { smithing, cooking, fletching, crafting, herblore, construction };
    this.crops = crops; this.slayerTasks = slayerTasks; this.pets = pets;
    this.carnivalPrizes = carnivalPrizes; this.guildQuests = guildQuests;
    this.guildDailies = guildDailies; this.herbloreRecipes = herblore;
    this.townBuildings = buildings; this.raidBosses = raidBosses; this.seasonalEvents = seasonalEvents;

    // Dungeons (explicit manifest so the game works on any static host)
    const dungeonList = await Promise.all(manifest.map(f => j('dungeons/' + f + '.json')));
    manifest.forEach((name, i) => { this.dungeons[name] = dungeonList[i]; });

    // Skilling dungeons (expeditions) + trade routes (mercantile) — same idea
    const SKILLING_KEYS = [
      'copper_caverns', 'whispering_grove', 'sunken_grotto', 'crumbling_watchtower', 'thieves_den',
      'dwarven_depths', 'corrupted_canopy', 'abyssal_lagoon', 'shattered_spire', 'shadow_vault',
    ];
    const ROUTE_KEYS = ['local_market', 'river_trading_post', 'merchants_quarter',
      'eastern_caravan', 'northern_ports', 'grand_exchange'];
    const skilling = await Promise.all(SKILLING_KEYS.map(f => j('skilling_dungeons/' + f + '.json')));
    SKILLING_KEYS.forEach((k, i) => { this.skillingDungeons[k] = skilling[i]; });
    this.skillingDungeonList = skilling.slice().sort((a, b) => a.level_required - b.level_required);
    const routes = await Promise.all(ROUTE_KEYS.map(f => j('trade_routes/' + f + '.json')));
    ROUTE_KEYS.forEach((k, i) => { this.tradeRoutes[k] = routes[i]; });
    this.tradeRouteList = routes.slice().sort((a, b) => a.level_required - b.level_required);

    this._buildLookups();
    this.loaded = true;
  },

  _buildLookups() {
    const N = this.names;

    // Display names from every source, mirroring GameStrings.itemName resolution order
    for (const [k, v] of Object.entries(this.equipment)) N[k] = v.display_name;
    for (const [k, v] of Object.entries(this.ores)) N[k] = v.display_name;
    for (const [k, v] of Object.entries(this.gems)) N[k] = v.display_name;
    for (const [k, v] of Object.entries(this.logs)) N[k] = v.display_name;
    for (const [k, v] of Object.entries(this.runes)) N[k] = v.display_name;
    for (const [k, v] of Object.entries(this.trees)) if (v.log_name && !N[v.log_name]) N[v.log_name] = v.log_display_name;
    for (const [k, v] of Object.entries(this.fish)) N[k] = (N[k] || ('Raw ' + v.display_name));
    for (const [k, v] of Object.entries(this.bones)) N[k] = v.display_name;
    for (const [k, v] of Object.entries(this.recipes.smithing)) N[k] = v.display_name;
    for (const [k, v] of Object.entries(this.recipes.crafting)) N[k] = v.display_name;
    for (const [k, v] of Object.entries(this.recipes.fletching)) N[k] = v.display_name;
    for (const [k, v] of Object.entries(this.recipes.cooking)) N[v.cooked_item] = v.display_name;
    for (const [k, v] of Object.entries(this.thievingNpcs)) for (const e of (v.loot_table || [])) if (!N[e.item]) N[e.item] = Util.prettify(e.item);
    for (const cat of Object.values(this.marketplace))
      for (const [k, v] of Object.entries(cat.items)) N[k] = v.display_name;
    N['coins'] = 'Coins';

    // Food heal values (cooked recipes) — everything with a healing_value is edible
    for (const v of Object.values(this.recipes.cooking)) this.foodHeals[v.cooked_item] = v.healing_value;

    // Arrow strength bonuses (from QueuedSessionStarter.ARROW_STRENGTH_BONUS)
    this.arrowBonuses = {
      bronze_arrow: 7, iron_arrow: 10, steel_arrow: 16,
      mithril_arrow: 22, adamantite_arrow: 31, runite_arrow: 49,
    };

    for (const [k, v] of Object.entries(this.crops)) N[k] = v.display_name;

    // Construction materials & furniture names
    for (const [k, v] of Object.entries(this.recipes.construction)) N[k] = v.display_name;
    N['stone'] = 'Stone'; N['plank'] = 'Plank'; N['magic_plank'] = 'Magic Plank';
    N['redwood_plank'] = 'Redwood Plank';
    for (const nail of ['iron_nail', 'steel_nail', 'mithril_nail', 'runite_nail'])
      if (!N[nail]) N[nail] = Util.prettify(nail) + 's';


    // Herblore potion effects
    for (const [k, v] of Object.entries(this.herbloreRecipes)) {
      N[k] = v.display_name;
      this.potionEffects[k] = v.effects || {};
    }

    // Pets by boosted skill
    for (const p of Object.values(this.pets))
      if (!this.petBySkill[p.boosted_skill]) this.petBySkill[p.boosted_skill] = p;

    // Log -> ash mapping for firemaking (bones.json holds the ash items)
    for (const logKey of Object.keys(this.logs)) {
      const ashKey = logKey === 'log' ? 'ashes' : logKey.replace('_log', '') + '_ashes';
      if (this.bones[ashKey]) this.ashByLog[logKey] = ashKey;
    }
  },

  name(key) { return this.names[key] || Util.prettify(key); },

  /** All blessings (port of ChurchRepository.ALL_BLESSINGS). Names via blessing_<key>_name. */
  BLESSINGS: [
    { key: 'blessed_focus', lvl: 1, type: 'XP', mag: 1.05 },
    { key: 'stone_skin', lvl: 1, type: 'DEFENSE', mag: 2 },
    { key: 'blessed_focus_ii', lvl: 10, type: 'XP', mag: 1.10 },
    { key: 'stone_skin_ii', lvl: 10, type: 'DEFENSE', mag: 4 },
    { key: 'blessed_focus_iii', lvl: 20, type: 'XP', mag: 1.15 },
    { key: 'stone_skin_iii', lvl: 20, type: 'DEFENSE', mag: 6 },
    { key: 'tithe_blessing', lvl: 30, type: 'XP', mag: 1.18 },
    { key: 'stone_skin_iv', lvl: 30, type: 'DEFENSE', mag: 9 },
    { key: 'fortune_i', lvl: 30, type: 'COINS', mag: 0.08 },
    { key: 'tithe_blessing_ii', lvl: 40, type: 'XP', mag: 1.20 },
    { key: 'iron_ward', lvl: 40, type: 'DEFENSE', mag: 12 },
    { key: 'fortune_ii', lvl: 40, type: 'COINS', mag: 0.10 },
    { key: 'tithe_blessing_iii', lvl: 50, type: 'XP', mag: 1.25 },
    { key: 'iron_ward_ii', lvl: 50, type: 'DEFENSE', mag: 15 },
    { key: 'fortune_iii', lvl: 50, type: 'COINS', mag: 0.13 },
    { key: 'divine_focus', lvl: 60, type: 'XP', mag: 1.28 },
    { key: 'diamond_skin', lvl: 60, type: 'DEFENSE', mag: 18 },
    { key: 'fortune_iv', lvl: 60, type: 'COINS', mag: 0.15 },
    { key: 'divine_focus_ii', lvl: 70, type: 'XP', mag: 1.32 },
    { key: 'diamond_skin_ii', lvl: 70, type: 'DEFENSE', mag: 22 },
    { key: 'fortune_v', lvl: 70, type: 'COINS', mag: 0.18 },
    { key: 'divine_grace', lvl: 80, type: 'XP', mag: 1.37 },
    { key: 'holy_shield', lvl: 80, type: 'DEFENSE', mag: 26 },
    { key: 'abundance', lvl: 80, type: 'COINS', mag: 0.20 },
    { key: 'divine_grace_ii', lvl: 90, type: 'XP', mag: 1.43 },
    { key: 'holy_shield_ii', lvl: 90, type: 'DEFENSE', mag: 30 },
    { key: 'abundance_ii', lvl: 90, type: 'COINS', mag: 0.23 },
    { key: 'sacred_grace', lvl: 99, type: 'XP', mag: 1.50 },
    { key: 'aegis', lvl: 99, type: 'DEFENSE', mag: 35 },
    { key: 'abundance_iii', lvl: 99, type: 'COINS', mag: 0.25 },
  ],

  blessing(key) { return this.BLESSINGS.find(b => b.key === key) || null; },

  blessingName(b) { return this.blessingStr(b, 'name', b.key.split('_').map((w, i) => i ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)).join(' ')); },

  blessingStr(b, suffix, fallback) {
    const k = 'blessing_' + b.key + '_' + suffix;
    return (typeof I18n !== 'undefined' && I18n.has(k)) ? I18n.t(k) : fallback;
  },

  /** All dungeons sorted by recommended level. */
  dungeonList() {
    return Object.values(this.dungeons).sort((a, b) => (a.recommended_level || 1) - (b.recommended_level || 1));
  },

  isFood(key) { return this.foodHeals[key] != null; },

  /** The 17 trainable skills in the web edition. */
  skillDefs: [
    { key: 'mining', name: 'Mining', icon: '⛏️', group: 'Gathering', desc: 'Extract ores and gems from the earth' },
    { key: 'woodcutting', name: 'Woodcutting', icon: '🪓', group: 'Gathering', desc: 'Chop trees for logs' },
    { key: 'fishing', name: 'Fishing', icon: '🎣', group: 'Gathering', desc: 'Catch fish from rivers and seas' },
    { key: 'thieving', name: 'Thieving', icon: '🗝️', group: 'Gathering', desc: 'Pickpocket townsfolk for coins and loot' },
    { key: 'agility', name: 'Agility', icon: '🏃', group: 'Gathering', desc: 'Run obstacle courses — higher agility speeds up every session' },
    { key: 'smithing', name: 'Smithing', icon: '🔨', group: 'Production', desc: 'Smelt ores into bars and forge gear' },
    { key: 'cooking', name: 'Cooking', icon: '🍳', group: 'Production', desc: 'Cook raw food to heal you in dungeons' },
    { key: 'fletching', name: 'Fletching', icon: '🏹', group: 'Production', desc: 'Craft arrows and bows from logs' },
    { key: 'crafting', name: 'Crafting', icon: '💎', group: 'Production', desc: 'Fashion jewelry from bars and gems' },
    { key: 'firemaking', name: 'Firemaking', icon: '🔥', group: 'Production', desc: 'Burn logs into ashes' },
    { key: 'runecrafting', name: 'Runecrafting', icon: '✨', group: 'Production', desc: 'Bind rune essence into casting runes' },
    { key: 'construction', name: 'Construction', icon: '🏗️', group: 'Production', desc: 'Build furniture from planks, nails and stone — the Workshop upgrades the town' },
    { key: 'prayer', name: 'Prayer', icon: '🙏', group: 'Production', desc: 'Scatter bones and ashes for blessing XP' },
    { key: 'farming', name: 'Farming', icon: '🌾', group: 'Gathering', desc: 'Plant seeds in real-time patches and harvest crops' },
    { key: 'herblore', name: 'Herblore', icon: '🧪', group: 'Production', desc: 'Brew combat potions from crops and monster parts' },
    { key: 'mercantile', name: 'Mercantile', icon: '🛒', group: 'Gathering', desc: 'Dispatch trade caravans — invest coins for profit and Mercantile XP' },
    { key: 'slayer', name: 'Slayer', icon: '🗡️', group: 'Combat', desc: 'Complete Slayer Master tasks for points and gear' },
    { key: 'attack', name: 'Attack', icon: '⚔️', group: 'Combat', desc: 'Melee accuracy' },
    { key: 'strength', name: 'Strength', icon: '💪', group: 'Combat', desc: 'Melee damage' },
    { key: 'defense', name: 'Defense', icon: '🛡️', group: 'Combat', desc: 'Resist incoming damage' },
    { key: 'ranged', name: 'Ranged', icon: '🏹', group: 'Combat', desc: 'Bows and arrows' },
    { key: 'magic', name: 'Magic', icon: '🔮', group: 'Combat', desc: 'Staves, runes and spells' },
    { key: 'hitpoints', name: 'Hitpoints', icon: '❤️', group: 'Combat', desc: 'Your life pool — trained by fighting' },
  ],
};

/* Export for Node-based tests (no-op in the browser) */
if (typeof module !== "undefined" && module.exports) module.exports = { GameData };
