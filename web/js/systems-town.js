/* ------------------------------------------------------------------ *
 * systems-town.js — the second half of the Android port:
 *   Church blessings, Builder's Workshop (town buildings), the Inn's
 *   hired workers, Expeditions (skilling dungeons), Raid Bosses, and
 *   Seasonal Events (bounty board, token track, Night Market, minigame).
 * Ported from ChurchRepository, TownRepository, WorkerQueuedSessionStarter,
 * ExpeditionsViewModel/HomeViewModel, CombatViewModel and
 * SeasonalEventRepository. Loaded after systems.js; extends `Systems`.
 * ------------------------------------------------------------------ */
'use strict';

(() => {
  const t = (key, args, fb) => (typeof I18n !== 'undefined' && I18n.has(key)) ? I18n.t(key, args) : fb;

  Systems.combatLevel = function () {
    const atk = State.level('attack'), str = State.level('strength');
    const def = State.level('defense'), hp = State.level('hitpoints');
    return Math.max(1, Math.floor((atk + str) * 0.325 + (def + hp) * 0.25));
  };

  /* ================================================================== *
   *  CHURCH — timed blessings paid for with bones
   * ================================================================== */

  Systems.Church = {
    /** Bone-equivalent cost per blessing (port of ChurchRepository.boneCostFor). */
    boneCostFor(b) {
      const lvl = b.lvl;
      if (lvl >= 99) return 300;
      if (lvl >= 90) return 265;
      if (lvl >= 80) return 230;
      if (lvl >= 70) return 185;
      if (lvl >= 60) return 145;
      if (lvl >= 50) return 110;
      if (lvl >= 40) return 80;
      if (lvl >= 30) return 55;
      if (lvl >= 20) return 35;
      if (lvl >= 10) return 20;
      return 10;
    },

    blessingsForLevel() {
      const lvl = State.level('prayer');
      return GameData.BLESSINGS.filter(b => b.lvl <= lvl);
    },

    /** Consume bones greedily from least to most valuable (port of activateBlessing). */
    activate(key) {
      const b = GameData.blessing(key);
      if (!b) return { error: 'Unknown blessing.' };
      const ch = State.state.church;
      const active = State.activeBlessing();
      if (active && active.key !== key) return { error: t('church_already_active', null, 'A blessing is already active') };
      if (State.level('prayer') < b.lvl)
        return { error: t('church_locked_level', [b.lvl], `Requires Prayer level ${b.lvl}`) };
      const costXp = this.boneCostFor(b) * 10;  // cost is in regular-bone equivalents
      if (State.totalBoneXp() < costXp)
        return { error: t('church_not_enough_bones', [this.boneCostFor(b)], `Not enough bones (need ${this.boneCostFor(b)})`) };

      // Consume bone types cheapest-first
      const BONE_XP = { bones: 10, big_bones: 20, giant_bones: 40, dragon_bone: 80 };
      let remaining = costXp;
      for (const boneKey of Object.keys(BONE_XP)) {
        if (remaining <= 0) break;
        const xp = BONE_XP[boneKey];
        const have = State.count(boneKey);
        if (!have) continue;
        const consume = Math.min(have, Math.ceil(remaining / xp));
        State.removeItem(boneKey, consume);
        remaining -= consume * xp;
      }

      const durationMs = State.blessingDurationMs();
      ch.blessingKey = key;
      ch.blessingExpiresAt = (active && active.key === key ? ch.blessingExpiresAt : Date.now()) + durationMs;
      State.pushLog(`🙏 Blessing active: ${GameData.blessingName(b)} — ${Util.fmtTime(durationMs)}`, 'levelup');
      State.save();
      return { ok: true, blessing: b };
    },

    deactivate() {
      State.state.church.blessingKey = null;
      State.state.church.blessingExpiresAt = 0;
      State.save();
      return { ok: true };
    },
  };

  /* ================================================================== *
   *  BUILDER'S WORKSHOP — town building upgrades
   * ================================================================== */

  Systems.Town = {
    BUILDING_META: {
      inn: { icon: '🍺' },
      guild_hall: { icon: '🏛️' },
      church: { icon: '⛪' },
      fairgrounds: { icon: '🎡' },
      garden: { icon: '🌾' },
      queue_master: { icon: '📋' },
      cape_rack: { icon: '🎓' },
      artisans_workshop: { icon: '⚒️' },
      chronos_spire: { icon: '⏳' },
    },

    /** Localized building name (town_building_<key>_name in the app strings). */
    buildingName(key) {
      const k = 'town_building_' + key + '_name';
      return (typeof I18n !== 'undefined' && I18n.has(k)) ? I18n.t(k) : Util.prettify(key);
    },

    /** Builder's discount: 0.5% per Construction level, capped at 49.5% (per-mille math). */
    discountPerMille() {
      return Math.min(Math.max(State.level('construction'), 0) * 5, 495);
    },
    discountedCoins(cost) { return Math.floor(cost * (1000 - this.discountPerMille()) / 1000); },
    discountedQty(qty) { return Math.max(1, Math.ceil(qty * (1000 - this.discountPerMille()) / 1000)); },

    currentTier(buildingKey) { return State.state.town.buildingTiers[buildingKey] || 0; },

    /** Upgrade a building (port of TownRepository.upgradeBuilding). */
    upgrade(buildingKey) {
      const building = GameData.townBuildings[buildingKey];
      if (!building) return { error: 'Unknown building.' };
      const current = this.currentTier(buildingKey);
      if (current >= building.tiers.length) return { error: 'Already at max tier.' };
      const tierDef = building.tiers[current];
      if (State.level('construction') < tierDef.construction_level_required)
        return { error: t('builder_lock_level', [tierDef.construction_level_required], `Requires Construction ${tierDef.construction_level_required}`) };

      const coinCost = this.discountedCoins(tierDef.coin_cost);
      const materials = Object.fromEntries(Object.entries(tierDef.materials || {})
        .map(([m, q]) => [m, this.discountedQty(q)]));
      if (State.state.coins < coinCost) return { error: t('inn_not_enough_coins', null, 'Not enough coins.') };
      for (const [m, q] of Object.entries(materials))
        if (State.count(m) < q) return { error: `Not enough materials — need ${q}× ${GameData.name(m)}.` };

      State.removeItem('coins', coinCost);
      for (const [m, q] of Object.entries(materials)) State.removeItem(m, q);
      State.state.town.buildingTiers[buildingKey] = current + 1;
      State.state.stats.buildingsUpgraded = (State.state.stats.buildingsUpgraded || 0) + 1;
      State.state.stats.buildingsUpgradedByBuilding = State.state.stats.buildingsUpgradedByBuilding || {};
      State.state.stats.buildingsUpgradedByBuilding[buildingKey] = (State.state.stats.buildingsUpgradedByBuilding[buildingKey] || 0) + 1;
      State.pushLog(`🏗️ ${this.buildingName(buildingKey)} upgraded to tier ${current + 1}!`, 'quest');
      State.save();
      return { ok: true };
    },
  };

  /* ================================================================== *
   *  INN — hired workers (slot 1: Long Laborer; slot 2: skilled tiers)
   * ================================================================== */

  Systems.Inn = {
    TIERS: {
      long_laborer: { key: 'long_laborer', slot: 1, hours: 8, efficiency: 0.5, hireCost: 5000, maxCraftQty: Infinity },
      apprentice: { key: 'apprentice', slot: 2, hours: 8, efficiency: 1.0, hireCost: 10000, maxCraftQty: 480 },
      journeyman: { key: 'journeyman', slot: 2, hours: 6, efficiency: 1.5, hireCost: 20000, maxCraftQty: 540 },
      master: { key: 'master', slot: 2, hours: 4, efficiency: 2.5, hireCost: 50000, maxCraftQty: 600 },
    },

    tier(key) { return this.TIERS[key]; },

    /** Combined multiplier applied to gathering loot & XP at collect (hours × efficiency). */
    gatheringMult(tier) { return (tier.hours * 60) * tier.efficiency / 60; },

    workerName(tierKey) {
      const names = (typeof I18n !== 'undefined' && I18n.arr('worker_names').length)
        ? I18n.arr('worker_names') : ['Aldric', 'Brenna', 'Calder', 'Dwyn', 'Elara', 'Finn', 'Gwenna'];
      // Date-seeded like the app (day + tier ordinal salt)
      const d = new Date();
      const daySeed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
      const ord = Object.keys(this.TIERS).indexOf(tierKey);
      let s = (daySeed + ord * 7919) % 2147483647;
      s = (s * 48271) % 2147483647;
      return names[s % names.length];
    },

    hire(tierKey) {
      const tier = this.tier(tierKey);
      if (!tier) return { error: 'Unknown worker tier.' };
      const inn = State.state.inn;
      if (inn.workers[tier.slot]) return { error: t('inn_worker_already_hired', null, 'A worker is already hired for this slot.') };
      if (State.state.coins < tier.hireCost) return { error: t('inn_not_enough_coins', null, 'Not enough coins.') };
      State.state.coins -= tier.hireCost;
      let name = this.workerName(tierKey);
      const other = inn.workers[tier.slot === 1 ? 2 : 1];
      if (other && other.name === name) name = this.workerName(tierKey + '_x');
      inn.workers[tier.slot] = { tier: tierKey, name };
      State.pushLog(`🍺 ${name} the ${Util.prettify(tierKey)} is hired! Assign them a job.`, 'quest');
      State.save();
      return { ok: true, worker: inn.workers[tier.slot] };
    },

    dismiss(slot) {
      const inn = State.state.inn;
      if (!inn.workers[slot]) return { error: 'No worker in that slot.' };
      const name = inn.workers[slot].name;
      inn.workers[slot] = null;
      State.pushLog(`🍺 ${name} packed up their tools and left.`);
      State.save();
      return { ok: true };
    },

    workerSession(slot) { return State.state.inn.workers[slot]?.session || null; },

    /** Start a worker job — mirrors Engine.startSkillSession but targets the worker slot. */
    startJob(slot, skill, activityKey, qty) {
      const worker = State.state.inn.workers[slot];
      if (!worker) return { error: 'No worker hired in that slot.' };
      if (worker.session) return { error: `${worker.name} is already working.` };
      const tier = this.tier(worker.tier);
      const res = Engine.startSkillSession(skill, activityKey, qty, { worker: { slot, tier } });
      if (res.error) return res;
      return res;
    },

    /** Collect a finished worker session; applies tier + Inn multipliers, then dismisses. */
    collect(slot) {
      const worker = State.state.inn.workers[slot];
      const sess = worker?.session;
      if (!sess) return { error: 'Nothing to collect.' };
      if (Date.now() < sess.endsAt) return { error: 'Still working.' };

      const tier = this.tier(worker.tier);
      const innXpMult = State.townBonusProduct('worker_xp');
      const boostXp = State.xpBoostActive() ? 2 : 1;
      const mult = sess.mult != null ? sess.mult : 1;

      const summary = { xpBySkill: {}, items: {}, coins: 0, petsGained: [], leveled: [], name: worker.name, died: false, kills: 0, killsByEnemy: {} };
      for (const f of sess.frames) {
        for (const [k, v] of Object.entries(f.xpBySkill || {})) summary.xpBySkill[k] = (summary.xpBySkill[k] || 0) + v;
        if (f.xpGain && !f.xpBySkill) summary.xpBySkill[sess.skill] = (summary.xpBySkill[sess.skill] || 0) + f.xpGain;
        for (const [k, v] of Object.entries(f.items || {})) {
          if (k === 'coins') { summary.coins += v; continue; }
          summary.items[k] = (summary.items[k] || 0) + v;
        }
        summary.kills += f.kills || 0;
        for (const [k, v] of Object.entries(f.killsByEnemy || {})) summary.killsByEnemy[k] = (summary.killsByEnemy[k] || 0) + v;
        if (f.died) summary.died = true;
      }

      // Worker deaths forfeit 90% like the player path
      if (sess.kind === 'dungeon' && summary.died) {
        for (const k of Object.keys(summary.xpBySkill)) summary.xpBySkill[k] = Math.max(1, Math.floor(summary.xpBySkill[k] * 0.1));
        for (const k of Object.keys(summary.items)) {
          summary.items[k] = Math.floor(summary.items[k] * 0.1);
          if (!summary.items[k]) delete summary.items[k];
        }
      }

      // Boss sessions: only the last frame carries loot/XP
      if (sess.kind === 'boss') {
        const last = sess.frames[sess.frames.length - 1];
        const won = (last.kills || 0) > 0;
        summary.items = {};
        summary.coins = 0;
        summary.xpBySkill = {};
        if (won) {
          for (const [k, v] of Object.entries(last.items || {})) {
            if (k === 'coins') summary.coins += v; else summary.items[k] = v;
          }
          for (const [k, v] of Object.entries(last.xpBySkill || {})) summary.xpBySkill[k] = v;
        } else {
          summary.died = true;
          for (const [k, v] of Object.entries(last.xpBySkill || {})) summary.xpBySkill[k] = v;
        }
      }

      // XP & loot: × the tier's combined multiplier (gathering/combat runs only),
      // then × the Inn's worker-XP bonus. Each stack keeps at least 1.
      for (const k of Object.keys(summary.xpBySkill)) {
        summary.xpBySkill[k] = Math.max(1, Math.floor(summary.xpBySkill[k] * mult * innXpMult * boostXp));
      }
      for (const k of Object.keys(summary.items)) summary.items[k] = Math.max(1, Math.floor(summary.items[k] * mult));
      summary.coins = Math.floor(summary.coins * mult);

      // Apply
      summary.leveled = [];
      for (const [skill, xp] of Object.entries(summary.xpBySkill)) {
        const ups = State.addXp(skill, xp);
        if (ups.length === 2) summary.leveled.push(`${skill} ${ups[0]}→${ups[1]}`);
      }
      for (const [k, v] of Object.entries(summary.items)) {
        if (GameData.pets[k]) { for (let i = 0; i < v; i++) State.addPet(k); if (!summary.petsGained.includes(k)) summary.petsGained.push(k); continue; }
        State.addItem(k, v);
      }
      if (summary.coins) State.addItem('coins', summary.coins);

      // Track quest/guild counters with the same hooks as the player path
      Engine._updateQuestCounters(sess, summary);
      Engine._updateGuildCounters(sess, summary);
      if ((sess.kind === 'dungeon' || sess.kind === 'boss') && Object.keys(summary.killsByEnemy).length) {
        Systems.recordKills(summary.killsByEnemy);
      }
      if (typeof Systems.Seasonal !== 'undefined') {
        if (sess.kind === 'gathering' || sess.kind === 'expedition') Systems.Seasonal.recordGathering(summary.items);
        if (sess.kind === 'production') Systems.Seasonal.recordCrafting(summary.items);
        if ((sess.kind === 'dungeon' || sess.kind === 'boss') && Object.keys(summary.killsByEnemy).length)
          Systems.Seasonal.recordCombat(summary.killsByEnemy);
      }

      // Worker is dismissed after their one job (like the app)
      const name = worker.name;
      State.state.inn.workers[slot] = null;
      State.state.stats.workerJobsCollected = (State.state.stats.workerJobsCollected || 0) + 1;
      State.pushLog(`🍺 ${name} finished: ${sess.label} — job complete and worker dismissed.`, 'quest');
      State.save();
      return { ok: true, summary };
    },

    /** Daily rotating bulk-food menu (port of InnViewModel.computeDailyFoods). */
    dailyFoods() {
      const inn = State.state.inn;
      const day = new Date(); day.setHours(0, 0, 0, 0);
      if (inn.dailyFoods.generatedAt >= day.getTime()) return inn.dailyFoods.items;
      let seed = day.getTime() / 86400000;
      const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
      const pool = Object.entries(GameData.recipes.cooking)
        .filter(([, r]) => r.healing_value >= 10)
        .map(([k, r]) => ({ key: r.cooked_item, name: r.display_name, heal: r.healing_value, price: Math.max(5, Math.round(r.healing_value * 1.2)) }));
      const picked = [];
      const usedIdx = new Set();
      while (picked.length < Math.min(4, pool.length) && picked.length < pool.length) {
        const idx = Math.floor(rnd() * pool.length);
        if (usedIdx.has(idx)) continue;
        usedIdx.add(idx);
        picked.push(pool[idx]);
      }
      inn.dailyFoods = { generatedAt: day.getTime(), items: picked };
      State.save();
      return picked;
    },

    buyFood(key, price, qty = 1) {
      const total = price * qty;
      if (State.state.coins < total) return { error: t('inn_not_enough_coins', null, 'Not enough coins.') };
      State.state.coins -= total;
      State.addItem(key, qty);
      State.save();
      return { ok: true };
    },
  };

  /* ================================================================== *
   *  EXPEDITIONS — skilling dungeons that unlock combat dungeons
   * ================================================================== */

  Systems.Expeditions = {
    /** Is this expedition available (level + prerequisite dungeon unlocked)? */
    available(dungeonKey) {
      const d = GameData.skillingDungeons[dungeonKey];
      if (!d) return { ok: false, reason: 'Unknown expedition.' };
      const skillLevel = State.level(d.skill);
      if (skillLevel < d.level_required)
        return { ok: false, reason: t('expedition_lock_level', [Util.prettify(d.skill), d.level_required], `Requires ${Util.prettify(d.skill)} level ${d.level_required}`) };
      if (d.requires_previous_unlock && !State.dungeonUnlocked(d.requires_previous_unlock))
        return { ok: false, reason: t('expedition_lock_notes', [GameData.dungeons[d.requires_previous_unlock]?.display_name || d.requires_previous_unlock], `Find all notes in ${GameData.dungeons[d.requires_previous_unlock]?.display_name || d.requires_previous_unlock} first`) };
      return { ok: true };
    },

    notesFound(dungeonKey) { return State.state.expeditions.notes[dungeonKey] || 0; },

    start(dungeonKey) {
      const avail = this.available(dungeonKey);
      if (!avail.ok) return { error: avail.reason };
      return Engine.startSkillSession('expedition', dungeonKey);
    },

    /**
     * Handle lore notes from a collected expedition: pity counter, note
     * threshold, dungeon unlock (port of collectExpeditionSession).
     */
    collectNotes(dungeonKey, rawNotes) {
      const d = GameData.skillingDungeons[dungeonKey];
      if (!d) return { notes: 0, revealed: [], unlocked: null };
      const st = State.state.expeditions;
      const pity = st.pityRuns[dungeonKey] || 0;
      const notes = rawNotes === 0 && pity >= 9 ? 1 : rawNotes;  // pity: a note after 10 dry runs
      st.pityRuns[dungeonKey] = notes > 0 ? 0 : pity + 1;
      if (notes <= 0) return { notes: 0, revealed: [], unlocked: null };

      const oldCount = st.notes[dungeonKey] || 0;
      const newCount = Math.min(oldCount + notes, d.note_threshold);
      st.notes[dungeonKey] = newCount;
      const revealed = (d.note_texts || []).slice(0, newCount).slice(oldCount);
      let unlocked = null;
      if (newCount >= d.note_threshold && d.unlock_dungeon && !State.dungeonUnlocked(d.unlock_dungeon)) {
        (State.state.unlockedDungeonsExtra = State.state.unlockedDungeonsExtra || []).push(d.unlock_dungeon);
        unlocked = d.unlock_dungeon;
      }
      return { notes, revealed, unlocked, unlockMessage: unlocked ? (d.unlock_message || null) : null };
    },
  };

  /* ================================================================== *
   *  RAID BOSSES — long single-target fights with big reward tables
   * ================================================================== */

  Systems.Bosses = {
    list() {
      return Object.entries(GameData.raidBosses)
        .sort((a, b) => a[1].combat_level_required - b[1].combat_level_required);
    },

    /** Start a raid boss fight (port of CombatViewModel.startBossSession). */
    start(bossKey, opts = {}) {
      const worker = opts.worker || null;
      if (!worker && Engine.hasSession()) return { error: 'A session is already running.' };
      const boss = GameData.raidBosses[bossKey];
      if (!boss) return { error: 'Unknown boss.' };
      if (Systems.combatLevel() < boss.combat_level_required)
        return { error: `Requires combat level ${boss.combat_level_required} (you are ${Systems.combatLevel()}).` };
      const style = State.state.combatStyle;
      const styleError = Engine.validateStyle(style);
      if (styleError) return { error: styleError };
      if (style === 'ranged' && !State.equippedItem('arrows')) return { error: 'Select arrows in the Combat tab.' };

      const ctx = State.combatContext();
      ctx.petBoostPct = State.combatPetBoost();
      const potionKey = State.state.activePotion;
      if (potionKey && State.count(potionKey) > 0 && GameData.potionEffects[potionKey]) {
        State.removeItem(potionKey, 1);
        ctx.potions = GameData.potionEffects[potionKey];
      } else ctx.potions = {};

      const frames = Sim.simulateBoss(boss, bossKey, ctx);
      // A frame = one minute of game time; the fight ends with its last frame
      const frameMs = Sim.sessionDurationMs(State.level('agility'), State.playerSessionDurationMultiplier()) / 60;
      State.save();
      const result = { frames, durationMs: Math.max(60000, frames.length * frameMs) };
      const sess = worker
        ? Engine._makeWorkerSession(worker, 'boss', 'boss', bossKey, boss.display_name, result, { style, bossKey })
        : Engine._makeSession('boss', 'boss', bossKey, boss.display_name, result, { style, bossKey });
      return { ok: true, session: sess };
    },
  };

  /* ================================================================== *
   *  SEASONAL EVENTS — bounty board, tokens, reward tiers, market, minigame
   * ================================================================== */

  Systems.Seasonal = {
    /** The event whose date window contains now, or null. */
    activeEvent() {
      const now = Date.now();
      return Object.values(GameData.seasonalEvents).find(e => now >= e.start_ms && now <= e.end_ms) || null;
    },

    tokens(eventId) { return State.state.seasonal.tokensByEvent[eventId] || 0; },

    expeditionKeys(event) {
      return event.expedition_dungeon_keys?.length ? event.expedition_dungeon_keys
        : (event.expedition_dungeon_key ? [event.expedition_dungeon_key] : []);
    },

    /* ---------------- bounty board ---------------- */

    /** One slot per task type; validates/rotates slots (port of ensureBountySlotsRefreshed). */
    ensureBountySlots() {
      const event = this.activeEvent();
      if (!event) return null;
      const st = State.state.seasonal;
      const byType = {};
      for (const task of event.bounty_tasks) (byType[task.type] = byType[task.type] || []).push(task);
      const validIds = new Set(event.bounty_tasks.map(x => x.id));
      const now = Date.now();

      const slotsValid = st.bountyEventId === event.id &&
        st.bountySlots.length === Object.keys(byType).length &&
        st.bountySlots.every(id => validIds.has(id));
      if (!slotsValid) {
        st.bountyEventId = event.id;
        st.bountySlots = Object.values(byType).map(pool => this._pickTask(pool, null).id);
        st.bountyProgress = {};
        st.bountyCooldowns = {};
        st.bountyDailyStamp = now;
        State.save();
        return event;
      }

      let changed = false;
      // Claimed slots rotate to a new same-type task after the cooldown
      for (let i = 0; i < st.bountySlots.length; i++) {
        const cd = st.bountyCooldowns[i];
        if (cd == null || now < cd) continue;
        const current = event.bounty_tasks.find(x => x.id === st.bountySlots[i]);
        const next = this._pickTask(byType[current.type], current.id);
        st.bountySlots[i] = next.id;
        delete st.bountyProgress[current.id];
        delete st.bountyCooldowns[i];
        changed = true;
      }
      // Daily 6am reroll of untouched slots so an out-of-reach bounty never squats
      if (Systems._nextResetAfter(st.bountyDailyStamp) <= now) {
        for (let i = 0; i < st.bountySlots.length; i++) {
          if (st.bountyCooldowns[i] != null) continue;
          const current = event.bounty_tasks.find(x => x.id === st.bountySlots[i]);
          if ((st.bountyProgress[current.id] || 0) > 0) continue;
          const next = this._pickTask(byType[current.type], current.id);
          if (next.id === current.id) continue;
          st.bountySlots[i] = next.id;
          delete st.bountyProgress[current.id];
          changed = true;
        }
        st.bountyDailyStamp = now;
        changed = true;
      }
      if (changed) State.save();
      return event;
    },

    /** Prefer tasks the player can actually work on (level-reachable). */
    _pickTask(pool, excludeId) {
      const fresh = pool.filter(x => x.id !== excludeId);
      const reachable = fresh.filter(x => this._taskReachable(x));
      const candidates = reachable.length ? reachable : fresh;
      return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)]
        : pool.find(x => x.id === excludeId) || pool[0];
    },

    _taskReachable(task) {
      if (task.type === 'kill') {
        // Event kill targets spawn in the event expedition — gate on its recommended level
        const keys = this.expeditionKeys(this.activeEvent() || {});
        const rec = Math.min(...keys.map(k => GameData.dungeons[k]?.recommended_level || 1).concat([Infinity]));
        return Systems.combatLevel() >= rec;
      }
      const lvl = s => State.level(s);
      switch (task.skill) {
        case 'woodcutting': { const tr = Object.values(GameData.trees).find(x => x.log_name === task.target); return lvl('woodcutting') >= (tr?.level_required || 1); }
        case 'mining': return lvl('mining') >= (GameData.ores[task.target]?.level_required || 1);
        case 'fishing': return lvl('fishing') >= (GameData.fish[task.target]?.level_required || 1);
        case 'farming': return lvl('farming') >= (GameData.crops[task.target]?.farming_level_required || 1);
        case 'herblore': return lvl('herblore') >= (GameData.herbloreRecipes[task.target]?.level_required || 1);
        case 'fletching': return lvl('fletching') >= (GameData.recipes.fletching[task.target]?.level_required || 1);
        case 'smithing': return lvl('smithing') >= (GameData.recipes.smithing[task.target]?.level_required || 1);
        case 'crafting': return lvl('crafting') >= (GameData.recipes.crafting[task.target]?.level_required || 1);
        case 'runecrafting': return lvl('runecrafting') >= (GameData.runes[task.target]?.level_required || 1);
        case 'cooking': {
          const r = Object.values(GameData.recipes.cooking).find(x => x.cooked_item === task.target || x.raw_item === task.target);
          return lvl('cooking') >= (r?.level_required || 1);
        }
        default: return true;
      }
    },

    /** Slots with task + progress info for the UI. */
    bountyTasks() {
      const event = this.activeEvent();
      if (!event) return [];
      this.ensureBountySlots();
      const st = State.state.seasonal;
      return st.bountySlots.map((id, index) => {
        const task = event.bounty_tasks.find(x => x.id === id);
        if (!task) return null;
        const progress = task.type === 'turn_in'
          ? Math.min(State.count(task.target), task.amount)
          : (st.bountyProgress[id] || 0);
        return { task, progress, cooldownUntil: st.bountyCooldowns[index] };
      }).filter(Boolean);
    },

    recordGathering(items) { this._recordBounty('gather', items); },
    recordCrafting(items) { this._recordBounty('craft', items); },
    recordCombat(killsByEnemy) { this._recordBounty('kill', killsByEnemy); },

    _recordBounty(type, counts) {
      const event = this.activeEvent();
      if (!event || !event.pillars.includes('bounty')) return;
      this.ensureBountySlots();
      const st = State.state.seasonal;
      const active = new Set(st.bountySlots);
      let changed = false;
      for (const task of event.bounty_tasks) {
        if (task.type !== type || !active.has(task.id)) continue;
        const count = (counts[task.target] || 0) + (counts['enhanced_' + task.target] || 0);
        if (count <= 0) continue;
        const cur = st.bountyProgress[task.id] || 0;
        if (cur >= task.amount) continue;
        st.bountyProgress[task.id] = Math.min(cur + count, task.amount);
        changed = true;
      }
      if (changed) State.save();
    },

    claimBountyTask(taskId) {
      const event = this.activeEvent();
      if (!event || !event.pillars.includes('bounty')) return { error: 'No active event.' };
      this.ensureBountySlots();
      const st = State.state.seasonal;
      const slotIndex = st.bountySlots.indexOf(taskId);
      if (slotIndex < 0 || st.bountyCooldowns[slotIndex] != null) return { error: 'Not claimable.' };
      const task = event.bounty_tasks.find(x => x.id === taskId);
      if (!task) return { error: 'Unknown task.' };
      if (task.type === 'turn_in') {
        if (State.count(task.target) < task.amount) return { error: `You need ${task.amount}× ${GameData.name(task.target)}.` };
        State.removeItem(task.target, task.amount);
      } else if ((st.bountyProgress[taskId] || 0) < task.amount) {
        return { error: 'Not complete yet.' };
      }
      st.bountyCooldowns[slotIndex] = Date.now() + (event.bounty_rotation_ms || 3600000);
      this._awardToken(event);
      State.save();
      return { ok: true };
    },

    /** Token hooks for expedition / boss pillars. */
    recordExpeditionCompletion(activityKey) {
      const event = this.activeEvent();
      if (!event || !event.pillars.includes('expedition')) return;
      if (!this.expeditionKeys(event).includes(activityKey)) return;
      this._awardToken(event);
      State.save();
    },

    recordBossDefeat(bossKey) {
      const event = this.activeEvent();
      if (!event || !event.pillars.includes('boss') || event.boss_key !== bossKey) return;
      this._awardToken(event);
      State.save();
    },

    _awardToken(event) {
      const st = State.state.seasonal;
      const count = (st.tokensByEvent[event.id] || 0) + 1;
      st.tokensByEvent[event.id] = count;
      if (count >= event.token_goal && !st.bannersEarned.includes(event.id)) {
        st.bannersEarned.push(event.id);
        State.pushLog(`🎉 ${event.display_name}: goal reached — the ${event.display_name} banner is yours!`, 'quest');
      }
    },

    claimRewardTier(event, tier) {
      const st = State.state.seasonal;
      const claimed = st.rewardTiersClaimed[event.id] || [];
      if ((st.tokensByEvent[event.id] || 0) < tier.tokens || claimed.includes(tier.tokens))
        return { error: 'Not claimable yet.' };
      const notes = [];
      if (tier.coins > 0) { State.addItem('coins', tier.coins); notes.push(Util.fmt(tier.coins) + ' coins'); }
      for (const [k, v] of Object.entries(tier.items || {})) { State.addItem(k, v); notes.push(GameData.name(k)); }
      if (tier.pet_id) { State.addPet(tier.pet_id); notes.push(GameData.pets[tier.pet_id]?.display_name || tier.pet_id); }
      if (tier.xp_boost) { State.state.xpBoostUntil = Date.now() + 48 * 3600000; notes.push('48h 2× XP boost'); }
      st.rewardTiersClaimed[event.id] = [...claimed, tier.tokens];
      State.pushLog(`🎉 ${event.display_name} reward claimed: ${notes.join(', ') || tier.description}`, 'quest');
      State.save();
      return { ok: true, notes };
    },

    purchaseMarketOffer(event, offer) {
      const st = State.state.seasonal;
      const purchaseKey = event.id + ':' + offer.id;
      const bought = st.marketPurchases[purchaseKey] || 0;
      if (offer.limit != null && bought >= offer.limit) return { error: 'Purchase limit reached.' };
      if (State.state.coins < offer.coin_cost) return { error: 'Not enough coins.' };
      State.state.coins -= offer.coin_cost;
      for (const [k, v] of Object.entries(offer.items || {})) State.addItem(k, v);
      if (offer.effect === 'skip_bounty_cooldowns') {
        for (const k of Object.keys(st.bountyCooldowns)) st.bountyCooldowns[k] = 0;
        this.ensureBountySlots();
      } else if (offer.effect === 'skip_minigame_cooldown') {
        st.minigameCooldownAt = 0;
      }
      st.marketPurchases[purchaseKey] = bought + 1;
      State.save();
      return { ok: true };
    },

    /* ---------------- minigame ---------------- */

    minigameOnCooldown() {
      return (State.state.seasonal.minigameCooldownAt || 0) > Date.now();
    },

    /** Report a finished round (port of submitMinigameAttempt). */
    submitMinigame(won) {
      const event = this.activeEvent();
      const minigame = event?.minigame;
      if (!event || !event.pillars.includes('minigame') || !minigame) return { error: 'No active minigame.' };
      const st = State.state.seasonal;
      const now = Date.now();
      if ((st.minigameCooldownAt || 0) > now) return { error: 'On cooldown.', resumesAt: st.minigameCooldownAt };
      const cd = st.minigameEasyMode ? (minigame.cooldown_ms_easy || minigame.cooldown_ms) : minigame.cooldown_ms;
      st.minigameCooldownAt = now + cd;
      if (won) this._awardToken(event);
      State.save();
      return { ok: true, won, resumesAt: st.minigameCooldownAt };
    },
  };
})();

/* Export for Node-based tests (no-op in the browser) */
if (typeof module !== "undefined" && module.exports) module.exports = { Systems: globalThis.Systems };
