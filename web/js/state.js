/* ------------------------------------------------------------------ *
 * state.js — player state, equipment bonuses, save/load
 * ------------------------------------------------------------------ */
'use strict';

const State = {
  SAVE_KEY: 'idle-fantasy-web-save-v1',

  defaults() {
    const skills = {};
    for (const def of GameData.skillDefs) skills[def.key] = { xp: 0 };
    skills.hitpoints.xp = Sim.xpForLevel(10); // HP starts at 10 like the app
    return {
      version: 1,
      createdAt: Date.now(),
      coins: 25,
      skills,
      inventory: { bronze_sword: 1, wooden_shield: 1, cooked_shrimp: 15 },
      equipped: { weapon: 'bronze_sword', shield: 'wooden_shield' },
      combatStyle: 'attack',
      activeSpell: null,
      styleWeapons: {},      // style -> weapon key memory
      activePotion: null,    // potion selected for the next combat session
      session: null,
      lastStart: null,       // {kind, skill, activityKey} for the Repeat button
      quests: {},            // id -> {claimed:bool}
      stats: {
        itemsGathered: {}, itemsCrafted: {}, killsByEnemy: {}, totalKills: 0,
        dungeonRuns: {}, dungeonStyleRuns: {}, dungeonNoFoodRuns: 0,
        pickpockets: 0, stolen: {}, bonesScattered: {}, sessionsCollected: 0,
        slayerTasksCompleted: 0,
      },
      // Pets (passive collectibles — every owned pet gives its boost)
      petsOwned: [],
      // Farming: 5 patch slots (3 unlocked at level 1, 4 at 20, 5 at 40)
      farmingPatches: [null, null, null, null, null],
      magicBeanPlanted: false,
      unlockedDungeonsExtra: [],   // e.g. cloud_kingdom via magic bean
      // Slayer
      slayer: { activeTask: null, foretelled: [], points: 0 },
      // Infinite Tower
      tower: { current: 0, best: 0, claimed: [], xpBonus: 0, hpBonus: 0, coinBonus: 0 },
      // Carnival (active minigame cooldowns, epoch ms)
      carnivalCooldowns: {},
      // Guilds
      guilds: {
        progress: {},          // guild quest id -> {progress, completed}
        dailyIds: [], dailyProgress: {}, dailyClaimed: [],
        tierCounts: {},        // "guild:tier" -> dailies claimed this tier
        generatedAt: 0,
      },
      log: [],
    };
  },

  state: null,

  init() { this.state = this.defaults(); },

  /* ------------------------------ persistence ------------------------------ */

  _savedAt: 0,

  save() {
    try {
      localStorage.setItem(this.SAVE_KEY, JSON.stringify(this.state));
      this._savedAt = Date.now();
    } catch (e) { console.warn('Save failed', e); }
  },

  load() {
    try {
      const raw = localStorage.getItem(this.SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || data.version !== 1) return false;
      // Merge in any new default fields
      const def = this.defaults();
      data.skills = { ...def.skills, ...data.skills };
      data.stats = { ...def.stats, ...data.stats };
      data.guilds = { ...def.guilds, ...data.guilds };
      data.slayer = { ...def.slayer, ...data.slayer };
      data.tower = { ...def.tower, ...data.tower };
      if (!Array.isArray(data.farmingPatches)) data.farmingPatches = def.farmingPatches;
      while (data.farmingPatches.length < 5) data.farmingPatches.push(null);
      if (!Array.isArray(data.petsOwned)) data.petsOwned = [];
      this.state = data;
      return true;
    } catch (e) { return false; }
  },

  exportSave() { return btoa(unescape(encodeURIComponent(JSON.stringify(this.state)))); },

  importSave(code) {
    try {
      const data = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
      if (!data || !data.skills) return false;
      this.state = data;
      this.save();
      return true;
    } catch (e) { return false; }
  },

  reset() { localStorage.removeItem(this.SAVE_KEY); this.init(); this.save(); },

  /* ------------------------------ skills ------------------------------ */

  level(skill) { return Sim.levelForXp(this.state.skills[skill]?.xp || 0); },
  xp(skill) { return this.state.skills[skill]?.xp || 0; },

  totalLevel() {
    return GameData.skillDefs.reduce((s, d) => s + this.level(d.key), 0);
  },

  addXp(skill, amount) {
    if (!this.state.skills[skill]) return [];
    const before = this.level(skill);
    this.state.skills[skill].xp += amount;
    const after = this.level(skill);
    if (after > before) {
      this.pushLog(`⬆️ ${GameData.skillDefs.find(d => d.key === skill)?.name || skill} level ${before} → ${after}!`, 'levelup');
      if (after === 99) this._awardCape(skill);
      return [before, after];
    }
    return [];
  },

  _awardCape(skill) {
    const capeKey = skill + '_cape';
    const cape = GameData.equipment[capeKey];
    if (!cape || this.state.inventory[capeKey]) return;
    this.state.inventory[capeKey] = (this.state.inventory[capeKey] || 0) + 1;
    this.pushLog(`🎓 You've been awarded the ${cape.display_name}!`, 'levelup');
  },

  /* ------------------------------ inventory ------------------------------ */

  addItem(key, qty) {
    if (!key || qty <= 0) return;
    if (key === 'coins') { this.state.coins += qty; return; }
    this.state.inventory[key] = (this.state.inventory[key] || 0) + qty;
  },

  removeItem(key, qty) {
    if (key === 'coins') { this.state.coins = Math.max(0, this.state.coins - qty); return; }
    const have = this.state.inventory[key] || 0;
    this.state.inventory[key] = Math.max(0, have - qty);
    if (this.state.inventory[key] === 0) delete this.state.inventory[key];
    // Unequip if the last copy vanished
    if (!this.state.inventory[key]) {
      for (const [slot, item] of Object.entries(this.state.equipped))
        if (item === key) delete this.state.equipped[slot];
    }
  },

  count(key) { return key === 'coins' ? this.state.coins : (this.state.inventory[key] || 0); },

  /* ------------------------------ equipment ------------------------------ */

  SLOTS() {
    return ['weapon', 'shield', 'head', 'body', 'legs', 'boots', 'cape', 'ring', 'necklace'];
  },
  TOOL_SLOTS() {
    return ['pickaxe', 'axe', 'fishing_rod', 'hammer', 'tinderbox', 'grappling_hook', 'frying_pan', 'lockpick', 'hoe'];
  },

  equippedItem(slot) { return this.state.equipped[slot] || null; },

  equip(key) {
    const eq = GameData.equipment[key];
    if (!eq) return 'Not equipment.';
    for (const [skill, lvl] of Object.entries(eq.requirements || {}))
      if (this.level(skill) < lvl) return `Requires ${Util.prettify(skill)} ${lvl}.`;
    this.removeItem(key, 1);
    const prev = this.equippedItem(eq.slot);
    if (prev) this.addItem(prev, 1);
    this.state.equipped[eq.slot] = key;
    // Two-handed weapons occupy the shield slot
    if (eq.slot === 'weapon' && eq.two_handed && this.equippedItem('shield')) {
      this.addItem(this.equippedItem('shield'), 1);
      delete this.state.equipped.shield;
    }
    if (eq.slot === 'shield' && this.equippedItem('weapon') && GameData.equipment[this.equippedItem('weapon')]?.two_handed) {
      this.addItem(this.equippedItem('weapon'), 1);
      delete this.state.equipped.weapon;
    }
    // Remember the weapon per combat style
    if (eq.slot === 'weapon') this.state.styleWeapons[this.state.combatStyle] = key;
    return null;
  },

  unequip(slot) {
    const item = this.equippedItem(slot);
    if (!item) return;
    delete this.state.equipped[slot];
    this.addItem(item, 1);
  },

  meetsRequirements(key) {
    const eq = GameData.equipment[key];
    if (!eq) return true;
    for (const [skill, lvl] of Object.entries(eq.requirements || {}))
      if (this.level(skill) < lvl) return false;
    return true;
  },

  /**
   * Tool efficiency multiplier (port of util/ToolEfficiency.kt): base value from the
   * tool item, plus +25% per tier the tool outranks the resource being worked.
   */
  toolEfficiency(slot, skillKey, resourceLevelRequired = 0) {
    const key = this.equippedItem(slot);
    if (!key) return 1.0;
    const eq = GameData.equipment[key];
    if (!eq) return 1.0;
    const base = eq[skillKey + '_efficiency'] || 1.0;
    if (resourceLevelRequired <= 0) return base;
    const TIERS = [1, 15, 30, 55, 70, 85];
    const tierIndex = lvl => { let t = 0; TIERS.forEach((x, i) => { if (x <= lvl) t = i; }); return t; };
    const toolReq = (eq.requirements || {})[skillKey] || 1;
    const diff = tierIndex(toolReq) - tierIndex(resourceLevelRequired);
    return diff > 0 ? base * (1 + 0.25 * diff) : base;
  },

  /** Skill cape bonus (0.1 => +10% yield) if the cape for this skill is worn. */
  capeBonus(skillKey) {
    const cape = this.equippedItem('cape');
    if (!cape) return 0;
    const eq = GameData.equipment[cape];
    return eq && eq.cape_skill === skillKey ? (eq.cape_bonus || 0) : 0;
  },

  /** XP boost percentage from all owned pets for a given skill ('combat' matches combat pets). */
  petBoost(skillKey) {
    return this.state.petsOwned.reduce((sum, id) => {
      const p = GameData.pets[id];
      return sum + (p && (p.boosted_skill === skillKey || p.boosted_skill === 'all') ? p.boost_percent : 0);
    }, 0);
  },

  combatPetBoost() {
    return this.state.petsOwned.reduce((sum, id) => {
      const p = GameData.pets[id];
      return sum + (p && (p.boosted_skill === 'combat' || p.boosted_skill === 'all') ? p.boost_percent : 0);
    }, 0);
  },

  addPet(id) {
    if (!GameData.pets[id] || this.state.petsOwned.includes(id)) return false;
    this.state.petsOwned.push(id);
    const p = GameData.pets[id];
    this.pushLog(`🐾 ${p.emoji || '🐾'} ${p.display_name} joined you! (+${p.boost_percent}% ${Util.prettify(p.boosted_skill)} XP)`, 'quest');
    return true;
  },

  /** Farming patch count: 3 (lvl 1-19), 4 (20-39), 5 (40+). */
  patchCount() {
    const lvl = this.level('farming');
    return lvl >= 40 ? 5 : lvl >= 20 ? 4 : 3;
  },

  /** Effective max HP including tower milestone bonuses (+5 hp levels each). */
  effectiveHpLevel() { return this.level('hitpoints') + (this.state.tower?.hpBonus || 0); },

  /** A dungeon is visible if not gated, or unlocked via the magic bean. */
  dungeonUnlocked(key) {
    if (key !== 'cloud_kingdom') return true;
    return (this.state.unlockedDungeonsExtra || []).includes('cloud_kingdom');
  },

  /** Summed combat bonuses from all currently equipped gear. */
  combatBonuses() {
    const b = { attack: 0, strength: 0, defense: 0, rangedAttack: 0, rangedStr: 0, magicAttack: 0, magicDmg: 0, attackSpeed: null, infiniteRunes: null };
    for (const slot of State.SLOTS()) {
      const key = this.equippedItem(slot);
      if (!key) continue;
      const eq = GameData.equipment[key];
      if (!eq) continue;
      b.attack += eq.attack_bonus || 0;
      b.strength += eq.strength_bonus || 0;
      b.defense += eq.defense_bonus || 0;
      b.rangedAttack += eq.ranged_attack_bonus || 0;
      b.rangedStr += eq.ranged_strength_bonus || 0;
      b.magicAttack += eq.magic_attack_bonus || 0;
      b.magicDmg += eq.magic_damage_bonus || 0;
      if (slot === 'weapon') {
        if (eq.attack_speed) b.attackSpeed = eq.attack_speed;
        if (eq.infinite_runes) b.infiniteRunes = eq.infinite_runes;
      }
    }
    return b;
  },

  /** Effective combat context passed to the dungeon simulator. */
  combatContext() {
    const s = this.state;
    const bonuses = this.combatBonuses();
    const style = s.combatStyle;
    const weaponKey = this.equippedItem('weapon');
    const weapon = weaponKey ? GameData.equipment[weaponKey] : null;

    const ctx = {
      style,
      attack: this.level('attack'),
      strength: this.level('strength'),
      defense: this.level('defense') + bonuses.defense,
      hitpoints: this.effectiveHpLevel(),
      ranged: this.level('ranged'),
      magic: this.level('magic'),
      agilityLevel: this.level('agility'),
      potions: {},
    };

    if (style === 'ranged') {
      ctx.weaponAtkBonus = bonuses.rangedAttack;
      ctx.rangedStrBonus = bonuses.rangedStr;
      const arrowKey = this.equippedItem('arrows');
      ctx.arrows = arrowKey && this.count(arrowKey) > 0 ? { [arrowKey]: this.count(arrowKey) } : {};
      ctx.attackSpeedSec = weapon?.attack_speed || 2.4;
    } else if (style === 'magic') {
      ctx.weaponAtkBonus = bonuses.magicAttack;
      const spell = s.activeSpell ? GameData.spells[s.activeSpell] : null;
      ctx.spellMaxHit = (spell?.max_hit || 0) + bonuses.magicDmg;
      ctx.runeKey = bonuses.infiniteRunes || weapon?.infinite_runes ? null : spell?.rune_type || null;
      ctx.runeCost = spell?.rune_cost || 1;
      ctx.runes = ctx.runeKey ? this.count(ctx.runeKey) : Infinity;
      ctx.attackSpeedSec = weapon?.attack_speed || 2.4;
    } else {
      ctx.weaponAtkBonus = bonuses.attack;
      ctx.weaponStrBonus = bonuses.strength;
      ctx.attackSpeedSec = 2.4;
    }

    // Food supply: all edible items, mapped to counts
    ctx.food = {};
    for (const [key, qty] of Object.entries(this.state.inventory))
      if (GameData.isFood(key)) ctx.food[key] = qty;

    return ctx;
  },

  /* ------------------------------ misc ------------------------------ */

  pushLog(msg, type = 'info') {
    this.state.log.unshift({ msg, type, t: Date.now() });
    if (this.state.log.length > 60) this.state.log.length = 60;
  },
};

/* Export for Node-based tests (no-op in the browser) */
if (typeof module !== "undefined" && module.exports) module.exports = { State };
