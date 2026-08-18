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
  potionEffects: {},   // potion itemKey -> {stat: bonus}
  petBySkill: {},      // boosted_skill -> pet data (first match)
  recipes: { smithing: {}, cooking: {}, fletching: {}, crafting: {}, herblore: {} },
  names: {},            // itemKey -> display name
  foodHeals: {},        // itemKey -> heal value
  arrowBonuses: {},     // arrow itemKey -> ranged strength bonus
  ashByLog: {},         // logKey -> ash item key
  itemNameSource: {},

  async loadAll() {
    const base = 'data/';
    const j = async p => fetch(base + p).then(r => {
      if (!r.ok) throw new Error('Failed to load ' + p);
      return r.json();
    });

    const [xp, ores, gems, trees, logs, fish, runes, spells, bones, agility, thieving,
      marketplace, quests, equipment, enemies, fishingSkill,
      smithing, cooking, fletching, crafting, manifest,
      crops, slayerTasks, pets, carnivalPrizes, guildQuests, guildDailies, herblore] = await Promise.all([
      j('xp_table.json'), j('ores.json'), j('gems.json'), j('trees.json'), j('logs.json'),
      j('fish.json'), j('runes.json'), j('spells.json'), j('bones.json'),
      j('agility_courses.json'), j('thieving_npcs.json'), j('marketplace.json'),
      j('quests.json'), j('equipment.json'), j('enemies.json'), j('skills/fishing.json'),
      j('recipes/smithing.json'), j('recipes/cooking.json'), j('recipes/fletching.json'),
      j('recipes/crafting.json'), j('dungeons.json'),
      j('crops.json'), j('slayer_tasks.json'), j('pets.json'), j('carnival_prizes.json'),
      j('guild_quests.json'), j('guild_daily_quests.json'), j('recipes/herblore.json'),
    ]);

    this.xpTable = xp.levels;
    this.ores = ores; this.gems = gems; this.trees = trees; this.fish = fish;
    this.logs = logs; this.gems = gems; this.runes = runes; this.spells = spells;
    this.bones = bones; this.agilityCourses = agility; this.thievingNpcs = thieving;
    this.marketplace = marketplace; this.quests = quests; this.equipment = equipment;
    this.enemies = enemies;
    this.fishingSkill = fishingSkill;
    this.recipes = { smithing, cooking, fletching, crafting, herblore };
    this.crops = crops; this.slayerTasks = slayerTasks; this.pets = pets;
    this.carnivalPrizes = carnivalPrizes; this.guildQuests = guildQuests;
    this.guildDailies = guildDailies; this.herbloreRecipes = herblore;

    // Dungeons (explicit manifest so the game works on any static host)
    const dungeonList = await Promise.all(manifest.map(f => j('dungeons/' + f + '.json')));
    manifest.forEach((name, i) => { this.dungeons[name] = dungeonList[i]; });

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
    { key: 'prayer', name: 'Prayer', icon: '🙏', group: 'Production', desc: 'Scatter bones and ashes for blessing XP' },
    { key: 'farming', name: 'Farming', icon: '🌾', group: 'Gathering', desc: 'Plant seeds in real-time patches and harvest crops' },
    { key: 'herblore', name: 'Herblore', icon: '🧪', group: 'Production', desc: 'Brew combat potions from crops and monster parts' },
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
