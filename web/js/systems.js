/* ------------------------------------------------------------------ *
 * systems.js — Farming, Slayer, Guilds, Carnival, Infinite Tower, Pets
 * Ported from FarmingRepository, SlayerRepository, GuildRepository,
 * CarnivalRepository/CarnivalSimulator and TowerViewModel.
 * ------------------------------------------------------------------ */
'use strict';

const Systems = {

  /* ================================================================== *
   *  FARMING — real-time patches (3 at lvl 1, 4 at 20, 5 at 40)
   * ================================================================== */

  ASH_YIELD: {
    ashes: 1.10, oak_ashes: 1.20, willow_ashes: 1.35, maple_ashes: 1.50,
    yew_ashes: 1.75, magic_ashes: 2.00, redwood_ashes: 2.50,
  },

  cropReady(patch) {
    const crop = GameData.crops[patch.crop];
    if (!crop) return true;
    return Date.now() >= patch.plantedAt + crop.growth_time_hours * 3600000;
  },

  patchTimeLeftMs(patch) {
    const crop = GameData.crops[patch.crop];
    if (!crop) return 0;
    return patch.plantedAt + crop.growth_time_hours * 3600000 - Date.now();
  },

  /** Plant a seed (consumes 1 seed + optional fertilizer ash). Returns {error} or {ok}. */
  plantCrop(patchNumber, cropId, useAsh) {
    const st = State.state;
    const patchIdx = patchNumber - 1;
    if (patchIdx < 0 || patchIdx >= State.patchCount()) return { error: 'That patch is locked.' };
    if (st.farmingPatches[patchIdx]) return { error: 'Patch is already growing a crop.' };
    const crop = GameData.crops[cropId];
    if (!crop) return { error: 'Unknown crop.' };
    if (State.level('farming') < crop.farming_level_required) return { error: `Requires Farming ${crop.farming_level_required}.` };
    if (State.count(crop.seed_name) < 1) return { error: `You need a ${GameData.name(crop.seed_name)}.` };

    let ashKey = null;
    if (cropId !== 'magic_bean' && useAsh) {
      ashKey = Object.keys(this.ASH_YIELD).find(k => State.count(k) > 0) || null;
      if (!ashKey) return { error: 'No ashes to use as fertilizer.' };
      State.removeItem(ashKey, 1);
    }
    State.removeItem(crop.seed_name, 1);
    st.farmingPatches[patchIdx] = { crop: cropId, plantedAt: Date.now(), fert: ashKey };
    if (cropId === 'magic_bean') st.magicBeanPlanted = true;
    if (crop.planting_xp > 0) State.addXp('farming', crop.planting_xp);
    State.save();
    return { ok: true };
  },

  /** Harvest a ready patch: rolls yield (x hoe mult x ash mult, x2 with Farming Cape). */
  harvestPatch(patchNumber) {
    const st = State.state;
    const patchIdx = patchNumber - 1;
    const patch = st.farmingPatches[patchIdx];
    if (!patch) return { error: 'Nothing planted here.' };
    const crop = GameData.crops[patch.crop];
    if (!crop) return { error: 'Unknown crop.' };
    if (!this.cropReady(patch)) return { error: 'Still growing.' };

    // Magic bean: climb the beanstalk to unlock the Cloud Kingdom
    if (patch.crop === 'magic_bean') {
      st.farmingPatches[patchIdx] = null;
      if (!st.unlockedDungeonsExtra.includes('cloud_kingdom')) {
        st.unlockedDungeonsExtra.push('cloud_kingdom');
        State.pushLog('🫘 You climb the beanstalk… the Cloud Kingdom dungeon is unlocked!', 'quest');
      } else {
        State.pushLog('🫘 You climb the beanstalk again for old times\' sake.', 'quest');
      }
      State.save();
      return { ok: true, bean: true };
    }

    const hoeMult = State.toolEfficiency('hoe', 'farming');
    const capedDouble = State.equippedItem('cape') === 'farming_cape';
    const ashMult = this.ASH_YIELD[patch.fert] || 1.0;
    let yieldQty = Util.randInt(crop.yield_min, crop.yield_max);
    yieldQty = Math.round(yieldQty * hoeMult * ashMult);
    if (capedDouble) yieldQty *= 2;

    State.addItem(crop.id, yieldQty);
    State.addItem(crop.seed_name, 1); // seed back, like the app
    State.addXp('farming', crop.harvest_xp * yieldQty);
    st.stats.itemsGathered[crop.id] = (st.stats.itemsGathered[crop.id] || 0) + yieldQty;

    // Farming pet: 1/1000 per harvest
    const pet = GameData.petBySkill.farming;
    if (pet && Math.random() < 1 / 1000) State.addPet(pet.id);

    // Rare magic bean drop (1% if never planted one and none owned)
    if (!st.magicBeanPlanted && (st.inventory.magic_bean || 0) === 0 && Util.randInt(1, 100) === 1) {
      State.addItem('magic_bean', 1);
      State.pushLog('🫘 A magic bean tumbles out of the harvest!', 'quest');
    }

    st.farmingPatches[patchIdx] = null;
    // Guild gather tracking for farming
    this.recordGuildGathering('farming', { [crop.id]: yieldQty });
    State.save();
    return { ok: true, yield: yieldQty, crop: crop.id, xp: crop.harvest_xp * yieldQty };
  },

  /* ================================================================== *
   *  SLAYER — task assignment, foretelling, points shop
   * ================================================================== */

  BONE_XP: { bones: 10, big_bones: 20, giant_bones: 40, dragon_bone: 80 },
  FORETEL_COSTS: [10, 25, 50], // in bone units (1 unit = 10 XP)
  SLAYER_SKIP_COST: 30,
  SLAYER_SHOP: [
    { key: 'xp_lamp_small', name: 'Small XP Lamp', cost: 50, xp: 10000 },
    { key: 'xp_lamp_large', name: 'Large XP Lamp', cost: 200, xp: 50000 },
    { key: 'slayer_helm', cost: 400 },
    { key: 'abyssal_whip', cost: 300 },
    { key: 'slayer_platebody', cost: 350 },
    { key: 'slayer_platelegs', cost: 250 },
    { key: 'slayer_plateskirt', cost: 250 },
  ],

  _eligibleTasks() {
    const lvl = State.level('slayer');
    return Object.entries(GameData.slayerTasks).filter(([, cfg]) => cfg.slayer_level <= lvl);
  },

  _randomTask() {
    const eligible = this._eligibleTasks();
    if (!eligible.length) return null;
    const [enemyKey, cfg] = eligible[Math.floor(Math.random() * eligible.length)];
    return {
      enemyKey,
      targetKills: Util.randInt(cfg.min_kills, cfg.max_kills),
      killsCompleted: 0,
      xpPerKill: cfg.xp_per_kill,
      taskPoints: Math.max(3, Math.floor(cfg.slayer_level / 5)),
    };
  },

  assignTask() {
    const st = State.state.slayer;
    if (st.activeTask) return { error: 'You already have an active task.' };
    // Pop the first foretelled task if any
    if (st.foretelled.length) {
      st.activeTask = st.foretelled.shift();
      State.save();
      return { ok: true, task: st.activeTask };
    }
    const task = this._randomTask();
    if (!task) return { error: 'No tasks available — train Slayer or check back.' };
    st.activeTask = task;
    State.save();
    return { ok: true, task };
  },

  /** Total bone XP available for foretelling. */
  totalBoneXp() {
    return Object.entries(this.BONE_XP).reduce((s, [k, xp]) => s + (State.count(k) || 0) * xp, 0);
  },

  /** Pay bones to queue a specific upcoming task (slot costs 10/25/50 units). */
  foretelTask() {
    const st = State.state.slayer;
    if (st.foretelled.length >= 3) return { error: 'Foretell queue is full (3).' };
    const costUnits = this.FORETEL_COSTS[st.foretelled.length];
    const costXp = costUnits * 10;
    if (this.totalBoneXp() < costXp) return { error: `Needs ${costUnits} bone units (${costXp} bone XP).` };
    const task = this._randomTask();
    if (!task) return { error: 'No eligible tasks.' };

    // Consume bones cheapest-first
    let remaining = costXp;
    for (const boneKey of ['bones', 'big_bones', 'giant_bones', 'dragon_bone']) {
      if (remaining <= 0) break;
      const xp = this.BONE_XP[boneKey];
      const have = State.count(boneKey);
      if (!have) continue;
      const consume = Math.min(have, Math.ceil(remaining / xp));
      State.removeItem(boneKey, consume);
      remaining -= consume * xp;
    }

    if (!st.activeTask) st.activeTask = task;
    else st.foretelled.push(task);
    State.save();
    return { ok: true, task };
  },

  skipTask() {
    const st = State.state.slayer;
    if (!st.activeTask) return { error: 'No active task.' };
    if (st.points < this.SLAYER_SKIP_COST) return { error: `Skipping costs ${this.SLAYER_SKIP_COST} points.` };
    st.points -= this.SLAYER_SKIP_COST;
    st.activeTask = null;
    return this.assignTask();
  },

  /**
   * Record kills from a combat session. Returns {xp, tasksCompleted, taskKills}.
   * A completed task awards points and promotes the next foretelled task.
   */
  recordKills(killsByEnemy) {
    const st = State.state.slayer;
    let xp = 0, tasksCompleted = 0, taskKills = 0;
    for (const [enemy, count] of Object.entries(killsByEnemy)) {
      const task = st.activeTask;
      if (!task || task.enemyKey !== enemy || count <= 0) continue;
      const added = Math.min(count, task.targetKills - task.killsCompleted);
      if (added <= 0) continue;
      xp += added * task.xpPerKill;
      taskKills += added;
      task.killsCompleted += added;
      if (task.killsCompleted >= task.targetKills) {
        st.points += task.taskPoints;
        tasksCompleted++;
        st.activeTask = st.foretelled.shift() || null;
        State.state.stats.slayerTasksCompleted = (State.state.stats.slayerTasksCompleted || 0) + 1;
        State.pushLog(`🗡️ Slayer task complete! +${task.taskPoints} points`, 'quest');
      }
    }
    if (taskKills > 0 || tasksCompleted > 0) State.save();
    return { xp, tasksCompleted, taskKills };
  },

  /** Slayer points shop: lamps (with chosen skill) and gear. */
  buySlayerItem(entryKey, skillKey) {
    const entry = this.SLAYER_SHOP.find(e => e.key === entryKey);
    if (!entry) return { error: 'Unknown item.' };
    const st = State.state.slayer;
    if (st.points < entry.cost) return { error: `Costs ${entry.cost} Slayer points (you have ${st.points}).` };
    st.points -= entry.cost;
    if (entry.xp) {
      if (!skillKey || !State.state.skills[skillKey]) { st.points += entry.cost; return { error: 'Choose a skill for the lamp.' }; }
      State.addXp(skillKey, entry.xp);
      State.pushLog(`🛒 Slayer lamp: +${Util.fmt(entry.xp)} ${Util.prettify(skillKey)} XP`);
    } else {
      State.addItem(entry.key, 1);
      State.pushLog(`🛒 Bought ${GameData.name(entry.key)} from the Slayer Master.`);
    }
    State.save();
    return { ok: true };
  },

  /* ================================================================== *
   *  GUILDS — 18 guilds, 10 tiers; progression quests + daily requests
   * ================================================================== */

  // Only guilds whose skills exist in the web edition (construction & mercantile excluded)
  GUILDS: [
    'mining', 'fishing', 'woodcutting', 'farming', 'thieving', 'firemaking', 'agility',
    'smithing', 'cooking', 'fletching', 'crafting', 'runecrafting', 'herblore',
    'warriors', 'archers', 'mages', 'slayer', 'prayer',
  ],

  GUILD_ICONS: {
    mining: '⛏️', fishing: '🎣', woodcutting: '🪓', farming: '🌾', thieving: '🗝️',
    firemaking: '🔥', agility: '🏃', smithing: '🔨', cooking: '🍳', fletching: '🏹',
    crafting: '💎', runecrafting: '✨', herblore: '🧪', warriors: '⚔️', archers: '🎯',
    mages: '🔮', slayer: '🗡️', prayer: '🙏',
  },

  DAILIES_PER_TIER: [2, 3, 4, 5, 7, 9, 12, 15, 20, 25],

  POTION_SUBSTITUTES: {
    strength_potion: ['super_strength_potion', 'overload_potion'],
    attack_potion: ['super_attack_potion', 'overload_potion'],
    defense_potion: ['super_defense_potion', 'overload_potion'],
    ranging_potion: ['super_ranging_potion', 'overload_potion'],
    magic_potion: ['super_magic_potion', 'overload_potion'],
    super_strength_potion: ['overload_potion'],
    super_attack_potion: ['overload_potion'],
    super_defense_potion: ['overload_potion'],
    super_ranging_potion: ['overload_potion'],
    super_magic_potion: ['overload_potion'],
  },

  countForTarget(items, target) {
    return (items[target] || 0) +
      (items['enhanced_' + target] || 0) +
      (this.POTION_SUBSTITUTES[target] || []).reduce((s, k) => s + (items[k] || 0), 0);
  },

  _guildQuests(guild) {
    return Object.values(GameData.guildQuests).filter(q => q.guild === guild)
      .sort((a, b) => a.guild_level_required - b.guild_level_required);
  },

  _completedQuestIds() {
    return new Set(Object.entries(State.state.guilds.progress)
      .filter(([, p]) => p.completed).map(([id]) => id));
  },

  /** Two-gate guild level: all tier quests done AND tier daily count met. */
  guildLevel(guild) {
    const g = State.state.guilds;
    const completed = this._completedQuestIds();
    let level = 0;
    while (level < this.DAILIES_PER_TIER.length) {
      const tierQuests = this._guildQuests(guild).filter(q => q.guild_level_required === level);
      if (tierQuests.length === 0) break;
      if (tierQuests.some(q => !completed.has(q.id))) break;
      if ((g.tierCounts[guild + ':' + level] || 0) < this.DAILIES_PER_TIER[level]) break;
      level++;
    }
    return level;
  },

  guildUnlocked(guild) {
    return this._guildQuests(guild).some(q => State.state.guilds.progress[q.id]?.completed);
  },

  /** Add progress to a guild progression quest (active tier only). */
  _addQuestProgress(guild, type, target, count, matchAnyTarget) {
    if (count <= 0) return;
    const g = State.state.guilds;
    const level = this.guildLevel(guild);
    for (const q of this._guildQuests(guild)) {
      if (q.type !== type || q.guild_level_required > level) continue;
      if (!matchAnyTarget && q.target !== target) continue;
      const row = g.progress[q.id] || (g.progress[q.id] = { progress: 0, completed: false });
      if (row.completed) continue;
      row.progress += count;
    }
  },

  /** Advance matching unclaimed dailies. */
  _addDailyProgress(guild, type, target, count, matchAnyTarget) {
    if (count <= 0) return;
    const g = State.state.guilds;
    const pool = {}; for (const t of GameData.guildDailies) pool[t.id] = t;
    for (const id of g.dailyIds) {
      if (g.dailyClaimed.includes(id)) continue;
      const t = pool[id];
      if (!t || t.guild !== guild || t.type !== type) continue;
      if (!matchAnyTarget && t.target !== target) continue;
      g.dailyProgress[id] = (g.dailyProgress[id] || 0) + count;
    }
  },

  // ---- recording hooks (called from Engine.collect and farming) ----

  recordGuildGathering(skill, items) {
    if (!this.GUILDS.includes(skill)) return;
    for (const [target, count] of Object.entries(items)) {
      this._addQuestProgress(skill, 'gather', target, count);
      this._addDailyProgress(skill, 'gather', target, count);
    }
  },

  recordGuildCrafting(skill, items) {
    if (!this.GUILDS.includes(skill)) return;
    const targets = new Set([...Object.keys(items)]);
    for (const q of this._guildQuests(skill)) if (q.type === 'craft') targets.add(q.target);
    for (const t of GameData.guildDailies) if (t.guild === skill && t.type === 'craft') targets.add(t.target);
    for (const target of targets) {
      const count = this.countForTarget(items, target);
      if (count > 0) {
        this._addQuestProgress(skill, 'craft', target, count);
        this._addDailyProgress(skill, 'craft', target, count);
      }
    }
  },

  recordGuildCombat(killsByEnemy, combatStyle) {
    const guild = { ranged: 'archers', magic: 'mages' }[combatStyle] || 'warriors';
    const totalKills = Object.values(killsByEnemy).reduce((a, b) => a + b, 0);
    if (totalKills <= 0) return;
    this._addQuestProgress(guild, 'kill', null, totalKills, true);
    this._addDailyProgress(guild, 'kill', null, totalKills, true);
  },

  recordGuildThieving(npcKey, successCount) {
    if (successCount <= 0) return;
    this._addQuestProgress('thieving', 'pickpocket', npcKey, successCount);
    this._addDailyProgress('thieving', 'pickpocket', npcKey, successCount);
  },

  recordGuildAgility(courseKey) {
    this._addQuestProgress('agility', 'sessions', courseKey, 1);
    this._addDailyProgress('agility', 'sessions', courseKey, 1);
  },

  recordGuildPrayer(totalBuried) {
    if (totalBuried <= 0) return;
    this._addQuestProgress('prayer', 'prayer', null, totalBuried, true);
    this._addDailyProgress('prayer', 'prayer', null, totalBuried, true);
  },

  recordGuildSlayer(taskKills, tasksCompleted) {
    if (taskKills > 0) {
      this._addQuestProgress('slayer', 'slayer_kill', null, taskKills, true);
      this._addDailyProgress('slayer', 'slayer_kill', null, taskKills, true);
    }
    if (tasksCompleted > 0) {
      this._addQuestProgress('slayer', 'slayer_task', null, tasksCompleted, true);
      this._addDailyProgress('slayer', 'slayer_task', null, tasksCompleted, true);
    }
  },

  /** Claim a completed progression quest; levels the guild when the tier finishes. */
  claimGuildQuest(questId) {
    const g = State.state.guilds;
    const quest = GameData.guildQuests[questId];
    const row = g.progress[questId];
    if (!quest || !row || row.completed) return { error: 'Not claimable.' };
    if (row.progress < quest.amount) return { error: 'Not complete yet.' };
    row.completed = true;
    const rewards = this._grantGuildRewards(quest.rewards || {}, quest.guild);
    State.save();
    return { ok: true, rewards };
  },

  /** Claim a completed daily; increments this tier's daily counter. */
  claimGuildDaily(templateId) {
    const g = State.state.guilds;
    const t = GameData.guildDailies.find(x => x.id === templateId);
    if (!t) return { error: 'Unknown daily.' };
    if ((g.dailyProgress[templateId] || 0) < t.amount) return { error: 'Not complete yet.' };
    if (g.dailyClaimed.includes(templateId)) return { error: 'Already claimed.' };
    g.dailyClaimed.push(templateId);
    const level = this.guildLevel(t.guild);
    const tierKey = t.guild + ':' + level;
    g.tierCounts[tierKey] = Math.min((g.tierCounts[tierKey] || 0) + 1, this.DAILIES_PER_TIER[level] ?? Infinity);
    const rewards = this._grantGuildRewards(t.rewards || {}, t.guild, level, this.guildLevel(t.guild));
    State.save();
    return { ok: true, rewards };
  },

  _grantGuildRewards(rewards, guild, oldLevel, newLevel) {
    if (rewards.coins) State.addItem('coins', rewards.coins);
    if (rewards.xp && rewards.xp_skill) State.addXp(rewards.xp_skill, rewards.xp);
    for (const [k, v] of Object.entries(rewards.items || {})) State.addItem(k, v);
    // Guild cape on reaching rank 10
    if (newLevel != null && newLevel > (oldLevel ?? 0) && newLevel >= 10) {
      const capeKey = guild + '_guild_cape';
      if (GameData.equipment[capeKey] && State.count(capeKey) === 0) {
        State.addItem(capeKey, 1);
        State.pushLog(`🎓 The ${Util.prettify(guild)} guild awards you their cape!`, 'quest');
      }
    }
    return rewards;
  },

  /** Date-seeded daily refresh (up to 4 per unlocked guild), 6am local reset. */
  ensureDailies() {
    const g = State.state.guilds;
    // Dailies refresh once per day after the 6am local reset
    if (g.generatedAt > 0 && Date.now() < this._nextResetAfter(g.generatedAt)) return;

    const now = new Date();
    const seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    let rngState = seed;
    const rng = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };

    g.dailyIds = []; g.dailyProgress = {}; g.dailyClaimed = [];
    for (const guild of this.GUILDS) {
      if (!this.guildUnlocked(guild)) continue;
      const level = Math.max(1, this.guildLevel(guild));
      const pool = GameData.guildDailies.filter(t => t.guild === guild && this._dailyReachable(t));
      const inBracket = pool.filter(t => level >= t.guild_level_min && level <= t.guild_level_max);
      const chosen = [];
      for (const candidates of [inBracket, pool]) {
        const shuffled = [...candidates].sort(() => rng() - 0.5);
        for (const t of shuffled) {
          if (chosen.length >= 4) break;
          if (!chosen.includes(t)) chosen.push(t);
        }
        if (chosen.length >= 4) break;
      }
      g.dailyIds.push(...chosen.map(t => t.id));
    }
    g.generatedAt = Date.now();
    State.save();
  },

  _nextResetAfter(fromMs) {
    const d = new Date(fromMs);
    const next = new Date(d); next.setHours(6, 0, 0, 0);
    if (next <= d) next.setDate(next.getDate() + 1);
    return next.getTime();
  },

  /** Whether the player's current levels can actually work toward this daily. */
  _dailyReachable(t) {
    const lvl = s => State.level(s);
    try {
      switch (true) {
        case t.guild === 'farming' && t.type === 'gather': return lvl('farming') >= (GameData.crops[t.target]?.farming_level_required || 1);
        case t.guild === 'thieving' && t.type === 'pickpocket': return lvl('thieving') >= (GameData.thievingNpcs.find(n => n.key === t.target)?.level_required || 1);
        case t.guild === 'herblore' && t.type === 'craft': return lvl('herblore') >= (GameData.herbloreRecipes[t.target]?.level_required || 1);
        case t.guild === 'smithing' && t.type === 'craft': return lvl('smithing') >= (GameData.recipes.smithing[t.target]?.level_required || 1);
        case t.guild === 'cooking' && t.type === 'craft': return lvl('cooking') >= (GameData.recipes.cooking[t.target]?.level_required || 1);
        case t.guild === 'crafting' && t.type === 'craft': return lvl('crafting') >= (GameData.recipes.crafting[t.target]?.level_required || 1);
        case t.guild === 'fletching' && t.type === 'craft': return lvl('fletching') >= (GameData.recipes.fletching[t.target]?.level_required || 1);
        case t.guild === 'runecrafting' && t.type === 'craft': return lvl('runecrafting') >= (GameData.runes[t.target]?.level_required || 1);
        case t.guild === 'firemaking' && t.type === 'craft': {
          const ashToLog = { ashes: 'log', oak_ashes: 'oak_log', willow_ashes: 'willow_log', maple_ashes: 'maple_log', yew_ashes: 'yew_log', magic_ashes: 'magic_log', redwood_ashes: 'redwood_log' };
          return lvl('firemaking') >= (GameData.logs[ashToLog[t.target] || t.target]?.level_required || 1);
        }
        case t.guild === 'mining' && t.type === 'gather': return lvl('mining') >= (GameData.ores[t.target]?.level_required || 1);
        case t.guild === 'fishing' && t.type === 'gather': return lvl('fishing') >= (GameData.fish[t.target]?.level_required || 1);
        case t.guild === 'woodcutting' && t.type === 'gather': {
          const tree = Object.values(GameData.trees).find(tr => tr.log_name === t.target);
          return lvl('woodcutting') >= (tree?.level_required || 1);
        }
        case t.guild === 'agility' && t.type === 'sessions': return lvl('agility') >= (GameData.agilityCourses[t.target]?.level_required || 1);
        default: return true;
      }
    } catch (e) { return true; }
  },

  guildDailiesFor(guild) {
    const pool = {}; for (const t of GameData.guildDailies) pool[t.id] = t;
    const g = State.state.guilds;
    return g.dailyIds.map(id => pool[id]).filter(t => t && t.guild === guild);
  },

  /* ================================================================== *
   *  CARNIVAL — idle minigames, Ring Toss, prize shop
   * ================================================================== */

  CARNIVAL_GAMES: [
    { key: 'archery_range', name: 'Archery Range', icon: '🎯', skill: 'ranged' },
    { key: 'strongman_competition', name: 'Strongman Competition', icon: '💪', skill: 'strength' },
    { key: 'wizards_duel', name: "Wizard's Duel", icon: '🔮', skill: 'magic' },
    { key: 'fishing_derby', name: 'Fishing Derby', icon: '🐟', skill: 'fishing' },
  ],

  /** Ticket chance bonus from worn carnival gear (Carnival Cape: +5%). */
  carnivalTierBonus() {
    const cape = State.equippedItem('cape');
    const eq = cape ? GameData.equipment[cape] : null;
    return eq && eq.cape_skill === 'carnival' ? (eq.cape_bonus || 0) : 0;
  },

  startCarnivalSession(gameKey) {
    if (Engine.hasSession()) return { error: 'A session is already running.' };
    const game = this.CARNIVAL_GAMES.find(g => g.key === gameKey);
    if (!game) return { error: 'Unknown minigame.' };
    const result = Sim.simulateCarnival(gameKey, State.level(game.skill), State.petBoost(game.skill), State.level('agility'), this.carnivalTierBonus());
    return {
      ok: true,
      session: Engine._makeSession('carnival', game.skill, gameKey, game.name, result, { gameKey }),
    };
  },

  RING_TOSS_COOLDOWN_MS: 10 * 60 * 1000,

  /** Play Ring Toss: hit the target zone (position 0..1) for tickets. */
  playRingToss(position, hard) {
    const st = State.state;
    const now = Date.now();
    const cd = st.carnivalCooldowns.ring_toss || 0;
    if (now < cd) return { error: 'Ring Toss is on cooldown.' };
    const won = hard ? (position >= 0.52 && position <= 0.57) : (position >= 0.45 && position <= 0.55);
    const tickets = won ? (hard ? 7 : 2) : 0;
    if (tickets > 0) State.addItem('carnival_ticket', tickets);
    st.carnivalCooldowns.ring_toss = now + this.RING_TOSS_COOLDOWN_MS;
    State.save();
    return { ok: true, won, tickets };
  },

  ticketBalance() { return State.count('carnival_ticket'); },

  /** Redeem a carnival prize. XP lamps need a chosen skill. */
  redeemPrize(prizeKey, skillKey) {
    const prize = GameData.carnivalPrizes[prizeKey];
    if (!prize) return { error: 'Unknown prize.' };
    if (this.ticketBalance() < prize.ticket_cost) return { error: `Needs ${prize.ticket_cost} tickets.` };
    State.removeItem('carnival_ticket', prize.ticket_cost);
    if (prize.type === 'pet') {
      State.addPet(prizeKey);
    } else if (prize.type === 'xp_lamp') {
      if (!skillKey || !State.state.skills[skillKey]) {
        State.addItem('carnival_ticket', prize.ticket_cost);
        return { error: 'Choose a skill for the lamp.' };
      }
      State.addXp(skillKey, prize.xp_amount);
      State.pushLog(`🏮 Carnival lamp: +${Util.fmt(prize.xp_amount)} ${Util.prettify(skillKey)} XP`);
    } else {
      State.addItem(prizeKey, 1);
    }
    State.save();
    return { ok: true };
  },

  /* ================================================================== *
   *  INFINITE TOWER
   * ================================================================== */

  /** Start the next tower floor as a combat session (potion consumed, like dungeons). */
  startTowerSession() {
    if (Engine.hasSession()) return { error: 'A session is already running.' };
    const floor = State.state.tower.current + 1;
    const style = State.state.combatStyle;
    const styleError = Engine.validateStyle(style);
    if (styleError) return { error: styleError };
    if (style === 'ranged' && !State.equippedItem('arrows')) return { error: 'Select arrows in the Combat tab.' };

    const ctx = State.combatContext();
    ctx.petBoostPct = State.combatPetBoost();
    // Potion: consume one at session start
    const potionKey = State.state.activePotion;
    if (potionKey && State.count(potionKey) > 0) {
      State.removeItem(potionKey, 1);
      ctx.potions = GameData.potionEffects[potionKey] || {};
    } else {
      ctx.potions = {};
    }
    // Ranged/magic need enough ammo for a full run (like the app)
    if (style === 'ranged') {
      const ticks = Math.round(60 / (ctx.attackSpeedSec || 2.4));
      const have = Object.values(ctx.arrows).reduce((a, b) => a + b, 0);
      if (have < 1) return { error: 'You have no arrows left.' };
    }
    if (style === 'magic' && ctx.runeKey && ctx.runes !== Infinity) {
      const needed = 60 * Math.round(60 / (ctx.attackSpeedSec || 2.4)) * ctx.runeCost;
      if (ctx.runes < needed) return { error: `You need ${needed}× ${GameData.name(ctx.runeKey)} for a full floor.` };
    }

    const dungeon = Sim.buildTowerFloor(floor);
    const enemies = Sim.scaledTowerEnemies(floor);
    const result = Sim.simulateDungeon(dungeon, ctx, enemies);
    State.save();
    return {
      ok: true,
      session: Engine._makeSession('tower', 'tower', 'tower_floor_' + floor, 'Tower Floor ' + floor, result, {
        style, floor,
      }),
    };
  },

  /** Ammo/rune reclaim chance: 25% at level 1 → 75% at 99. */
  reclaimChance(level) { return 0.25 + (level - 1) / 98 * 0.50; },

  /** Claim a tower milestone reward. */
  claimTowerMilestone(floor) {
    const t = State.state.tower;
    const m = Sim.TOWER_MILESTONES.find(x => x.floor === floor);
    if (!m) return { error: 'Unknown milestone.' };
    if (t.claimed.includes(floor)) return { error: 'Already claimed.' };
    if (t.best < floor) return { error: `Reach floor ${floor} first.` };
    t.claimed.push(floor);
    const notes = [];
    if (m.type === 'item') { State.addItem(m.item, 1); notes.push(GameData.name(m.item)); }
    if (m.type === 'items') { m.items.forEach(k => State.addItem(k, 1)); notes.push(m.items.map(k => GameData.name(k)).join(', ')); }
    if (m.type === 'pet') { State.addPet(m.item); notes.push(GameData.pets[m.item].display_name); }
    if (m.type === 'coins') { State.addItem('coins', m.amount); notes.push(Util.fmt(m.amount) + ' coins'); }
    if (m.coins) { State.addItem('coins', m.coins); notes.push(Util.fmt(m.coins) + ' coins'); }
    if (m.type === 'xp') { t.xpBonus += m.amount; notes.push(`+${m.amount}% XP`); }
    if (m.type === 'hp') { t.hpBonus += m.amount; notes.push(`+${m.amount * 10} max HP`); }
    if (m.type === 'coinDrops') { t.coinBonus += m.amount; notes.push(`+${m.amount}% coins`); }
    State.pushLog(`🗼 Tower milestone floor ${floor}: ${notes.join(', ')}`, 'quest');
    State.save();
    return { ok: true, notes };
  },
};

/* Export for Node-based tests (no-op in the browser) */
if (typeof module !== 'undefined' && module.exports) module.exports = { Systems };
