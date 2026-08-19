/* ------------------------------------------------------------------ *
 * engine.js — session lifecycle, shop, quests
 * ------------------------------------------------------------------ */
'use strict';

const Engine = {
  /* ============================ Sessions ============================ */

  /** True while a session is running or awaiting collection. */
  hasSession() { return !!State.state.session; },

  session() { return State.state.session; },

  /** How many frames are revealed by wall-clock time. */
  revealedFrames(sess = this.session()) {
    if (!sess) return 0;
    const elapsed = Date.now() - sess.startedAt;
    return Util.clamp(Math.floor(elapsed / sess.frameMs) + 1, 0, sess.frames.length);
  },

  isComplete(sess = this.session()) {
    if (!sess) return false;
    return Date.now() >= sess.endsAt;
  },

  /** XP accumulated across revealed frames (for the live progress readout). */
  liveXp(sess = this.session()) {
    if (!sess) return { xp: 0, bySkill: {} };
    const n = this.revealedFrames(sess);
    let xp = 0; const bySkill = {};
    for (let i = 0; i < n; i++) {
      const f = sess.frames[i];
      xp += f.xpGain || 0;
      for (const [k, v] of Object.entries(f.xpBySkill || {})) bySkill[k] = (bySkill[k] || 0) + v;
    }
    return { xp, bySkill };
  },

  /** Descriptor of the most recently started session (for the Repeat button). */
  lastStart: null,

  _rememberStart(kind, skill, activityKey) {
    this.lastStart = { kind, skill, activityKey };
    State.state.lastStart = this.lastStart;
  },

  /** Restore the Repeat button across page reloads. */
  restoreLastStart() {
    if (!this.lastStart && State.state.lastStart) this.lastStart = State.state.lastStart;
  },

  /** Human label for the Repeat button. */
  lastStartLabel() {
    const ls = this.lastStart;
    if (!ls) return null;
    if (ls.kind === 'dungeon') return GameData.dungeons[ls.activityKey]?.display_name || 'last dungeon';
    if (ls.kind === 'tower') return 'Tower Floor ' + (State.state.tower.current + 1);
    if (ls.kind === 'carnival') return Systems.CARNIVAL_GAMES.find(g => g.key === ls.activityKey)?.name || 'carnival';
    if (ls.kind === 'boss') return GameData.raidBosses[ls.activityKey]?.display_name || 'boss';
    if (ls.kind === 'expedition') return 'Expedition: ' + (GameData.skillingDungeons[ls.activityKey]?.display_name || ls.activityKey);
    const def = GameData.skillDefs.find(d => d.key === ls.skill);
    const actLabel = ({
      mining: k => GameData.ores[k]?.display_name,
      woodcutting: k => GameData.trees[k]?.display_name,
      fishing: k => GameData.name(k),
      thieving: k => GameData.thievingNpcs.find(n => n.key === k)?.display_name,
      agility: k => GameData.agilityCourses[k]?.display_name,
      firemaking: k => GameData.name(k),
      herblore: k => GameData.herbloreRecipes[k]?.display_name,
      prayer: k => GameData.bones[k]?.display_name,
      mercantile: k => GameData.tradeRoutes[k]?.display_name,
      expedition: k => GameData.skillingDungeons[k]?.display_name,
    }[ls.skill] || (k => GameData.recipes[ls.skill]?.[k]?.display_name || GameData.name(k)))(ls.activityKey);
    return `${def?.name || ls.skill}: ${actLabel || ls.activityKey}`;
  },

  /** Restart whatever the player ran last (materials/levels re-validated). */
  repeatLast() {
    const ls = this.lastStart;
    if (!ls) return { error: 'Nothing to repeat yet.' };
    if (ls.kind === 'dungeon') return this.startDungeonSession(ls.activityKey);
    if (ls.kind === 'tower') return Systems.startTowerSession();
    if (ls.kind === 'carnival') return Systems.startCarnivalSession(ls.activityKey);
    if (ls.kind === 'boss') return Systems.Bosses.start(ls.activityKey);
    if (ls.kind === 'expedition') return this.startSkillSession('expedition', ls.activityKey);
    return this.startSkillSession(ls.skill, ls.activityKey);
  },

  _makeSession(kind, skill, activityKey, label, result, extra = {}) {
    const agilityLevel = State.level('agility');
    const nFrames = Math.max(1, result.frames.length);
    // Chronos Spire speeds up every player session
    const durationMs = kind === 'boss' ? result.durationMs
      : Math.max(1000, Math.round(result.durationMs * State.playerSessionDurationMultiplier()));
    const frameMs = Math.max(1000, Math.floor(durationMs / nFrames));
    const sess = {
      id: 's' + Date.now(),
      kind, skill, activityKey, label,
      startedAt: Date.now(),
      frameMs,
      frames: result.frames,
      endsAt: Date.now() + durationMs,
      agilityLevel,
      ...extra,
    };
    // Dungeon deaths end the session early, at the death tick (like the app)
    if (kind === 'dungeon' && result.frames.length > 0) {
      const last = result.frames[result.frames.length - 1];
      if (last.died) {
        const fullTicks = Math.max(...result.frames.map(f => Math.max(f.playerHits.length, f.enemyHits.length)), Sim.TICKS_PER_FRAME);
        const tickMs = Math.max(1, Math.floor(frameMs / fullTicks));
        const lastTicks = Math.max(last.playerHits.length, last.enemyHits.length);
        const lastMs = lastTicks > 0 ? Math.min(lastTicks * tickMs, frameMs) : frameMs;
        sess.endsAt = sess.startedAt + (result.frames.length - 1) * frameMs + lastMs + 2000;
      }
    }
    State.state.session = sess;
    this._rememberStart(kind, skill, activityKey);
    State.save();
    return sess;
  },

  /**
   * Worker variant: the session lives on the hired worker instead of the
   * player slot. Gathering runs take the tier's real duration (4–8 h);
   * production runs are per-item (1 min ÷ tier efficiency, like the app).
   */
  _makeWorkerSession(worker, kind, skill, activityKey, label, result, extra = {}) {
    const tier = worker.tier;
    const gathering = kind === 'gathering' || kind === 'expedition';
    // Gathering/combat runs take the tier's real duration (4–8 h); production
    // runs are per-item at the tier's crafting speed (1 min ÷ efficiency).
    const durationMs = gathering || kind === 'dungeon' || kind === 'boss' || kind === 'tower'
      ? tier.hours * 3600000
      : Math.max(60000, result.durationMs / (tier.efficiency || 1));
    const nFrames = Math.max(1, result.frames.length);
    const sess = {
      id: 'w' + Date.now() + '_' + worker.slot,
      kind, skill, activityKey, label,
      startedAt: Date.now(),
      frameMs: Math.max(1000, Math.floor(durationMs / nFrames)),
      frames: result.frames,
      endsAt: Date.now() + durationMs,
      agilityLevel: State.level('agility'),
      // Port of WorkerQueuedSessionStarter: the tier's combined multiplier applies
      // to loot & XP for gathering runs and combat/boss runs; production runs are
      // already quantity-capped instead.
      mult: (gathering && ['mining', 'woodcutting', 'fishing', 'thieving', 'agility'].includes(skill)) ||
        kind === 'dungeon' || kind === 'boss'
        ? Systems.Inn.gatheringMult(tier) : 1,
      workerTier: tier.key,
      workerSlot: worker.slot,
      ...extra,
    };
    const w = State.state.inn.workers[worker.slot];
    w.session = sess;
    State.pushLog(`🍺 ${w.name} started: ${label} (${Util.fmtTime(durationMs)})`);
    State.save();
    return sess;
  },

  /* ----------------------- gathering + production ----------------------- */

  /**
   * Start a skill session. Returns {error} or {ok, session}.
   * `qtyArg` limits production sessions (firemaking/smithing/cooking/etc.).
   * `opts.worker = {slot, tier}` targets a hired worker's session instead of
   * the player's (workers run in parallel, mirroring the app).
   */
  startSkillSession(skill, activityKey, qtyArg, opts = {}) {
    const worker = opts.worker || null;
    if (!worker && this.hasSession()) return { error: 'A session is already running.' };
    const s = State.state;
    const level = State.level(skill);
    const capeBonus = State.capeBonus(skill);
    const opts2 = { agilityLevel: State.level('agility'), petBoostPct: State.petBoost(skill) };
    // Gathering pets drop from their skill's sessions (1/1000 per frame, like the app).
    // Workers never roll pet drops (petDropKey = null in WorkerQueuedSessionStarter).
    const petDef = GameData.petBySkill[skill];
    if (!worker && petDef && ['mining', 'woodcutting', 'fishing', 'thieving', 'agility'].includes(skill))
      opts2.petDrop = { key: petDef.id, chance: 1 / 1000 };
    const saveChance = State.materialSaveChance();
    // Worker tiers cap crafting/prayer/runecrafting quantities (Long Laborer is uncapped)
    const capQty = q => worker ? Math.min(q, worker.tier.maxCraftQty) : q;
    const mkSession = (kind, sk, key, label, result, extra) =>
      worker
        ? this._makeWorkerSession(worker, kind, sk, key, label, result, extra)
        : this._makeSession(kind, sk, key, label, result, extra);

    switch (skill) {
      case 'mining': {
        const ore = GameData.ores[activityKey];
        if (!ore) return { error: 'Unknown ore.' };
        if (level < ore.level_required) return { error: `Requires Mining ${ore.level_required}.` };
        opts2.toolEfficiency = State.toolEfficiency('pickaxe', 'mining') * (1 + capeBonus);
        return { ok: true, session: mkSession('gathering', 'mining', activityKey, ore.display_name, Sim.simulateMining(activityKey, ore, State.xp('mining'), opts2)) };
      }
      case 'woodcutting': {
        const tree = GameData.trees[activityKey];
        if (!tree) return { error: 'Unknown tree.' };
        if (level < tree.level_required) return { error: `Requires Woodcutting ${tree.level_required}.` };
        opts2.toolEfficiency = State.toolEfficiency('axe', 'woodcutting', tree.level_required) * (1 + capeBonus);
        return { ok: true, session: mkSession('gathering', 'woodcutting', activityKey, tree.display_name, Sim.simulateWoodcutting(tree, State.xp('woodcutting'), opts2)) };
      }
      case 'fishing': {
        const fish = GameData.fish[activityKey];
        if (!fish) return { error: 'Unknown fish.' };
        if (level < fish.level_required) return { error: `Requires Fishing ${fish.level_required}.` };
        opts2.toolEfficiency = State.toolEfficiency('fishing_rod', 'fishing') * (1 + capeBonus);
        return { ok: true, session: mkSession('gathering', 'fishing', activityKey, GameData.name(activityKey), Sim.simulateFishing(activityKey, fish, State.xp('fishing'), opts2)) };
      }
      case 'thieving': {
        const npc = GameData.thievingNpcs.find(n => n.key === activityKey);
        if (!npc) return { error: 'Unknown target.' };
        if (level < npc.level_required) return { error: `Requires Thieving ${npc.level_required}.` };
        opts2.toolEfficiency = State.toolEfficiency('lockpick', 'thieving');
        return { ok: true, session: mkSession('gathering', 'thieving', activityKey, npc.display_name, Sim.simulateThieving(npc, State.xp('thieving'), level, opts2)) };
      }
      case 'agility': {
        const course = GameData.agilityCourses[activityKey];
        if (!course) return { error: 'Unknown course.' };
        if (level < course.level_required) return { error: `Requires Agility ${course.level_required}.` };
        opts2.toolEfficiency = State.toolEfficiency('grappling_hook', 'agility');
        return { ok: true, session: mkSession('gathering', 'agility', activityKey, course.display_name, Sim.simulateAgility(course, State.xp('agility'), level, opts2)) };
      }
      case 'mercantile': {
        // Trade routes: the caravan cost is paid up front; coins come back with the frames
        const route = GameData.tradeRoutes[activityKey];
        if (!route) return { error: 'Unknown trade route.' };
        if (level < route.level_required) return { error: `Requires Mercantile ${route.level_required}.` };
        if (State.state.coins < route.coin_cost) return { error: `Not enough coins (need ${Util.fmt(route.coin_cost)} 🪙).` };
        State.state.coins -= route.coin_cost;
        const routePet = GameData.petBySkill.mercantile;
        if (!worker && routePet) opts2.petDrop = { key: routePet.id, chance: 1 / 1000 };
        return { ok: true, session: mkSession('gathering', 'mercantile', activityKey, route.display_name, Sim.simulateMercantile(route, State.xp('mercantile'), opts2), { coinCost: route.coin_cost }) };
      }
      case 'expedition': {
        // Skilling dungeons: tiered XP + drops, lore notes roll every frame
        const dungeon = GameData.skillingDungeons[activityKey];
        if (!dungeon) return { error: 'Unknown expedition.' };
        if (typeof Systems.Expeditions === 'undefined') return { error: 'Expeditions not loaded.' };
        const avail = Systems.Expeditions.available(activityKey);
        if (!avail.ok) return { error: avail.reason };
        const skillKey = dungeon.skill;
        opts2.toolEfficiency = State.toolEfficiency(
          { mining: 'pickaxe', woodcutting: 'axe', fishing: 'fishing_rod', thieving: 'lockpick', agility: 'grappling_hook' }[skillKey] || 'pickaxe',
          skillKey);
        opts2.petBoostPct = State.petBoost(skillKey);
        if (!worker && GameData.petBySkill[skillKey]) opts2.petDrop = { key: GameData.petBySkill[skillKey].id, chance: 1 / 1000 };
        return { ok: true, session: mkSession('expedition', skillKey, activityKey, dungeon.display_name, Sim.simulateSkillingDungeon(activityKey, dungeon, State.xp(skillKey), opts2)) };
      }
      case 'firemaking': {
        const log = GameData.logs[activityKey];
        const ashKey = GameData.ashByLog[activityKey];
        if (!log || !ashKey) return { error: 'Unknown log.' };
        if (level < log.level_required) return { error: `Requires Firemaking ${log.level_required}.` };
        const have = State.count(activityKey);
        const qty = capQty(Math.min(have, qtyArg || have));
        if (qty < 1) return { error: `You need ${GameData.name(activityKey)} to burn.` };
        const eff = State.toolEfficiency('tinderbox', 'firemaking', log.level_required);
        State.removeItem(activityKey, qty);
        const petDef2 = GameData.petBySkill.firemaking;
        const baseFrameMs = Sim.sessionDurationMs(State.level('agility')) / 60;
        return { ok: true, session: mkSession('production', 'firemaking', activityKey, GameData.name(activityKey),
          { frames: Sim.simulateCraft(State.xp('firemaking'), qty, log.xp_per_log, 1, ashKey, eff, !worker && petDef2 ? { key: petDef2.id, chance: 1 / 1000 } : null), durationMs: Math.max(1, qty * baseFrameMs / eff) },
          { consumed: { [activityKey]: qty }, outputKey: ashKey, totalQty: qty }) };
      }
      case 'herblore': {
        const recipe = GameData.herbloreRecipes[activityKey];
        if (!recipe) return { error: 'Unknown recipe.' };
        if (level < recipe.level_required) return { error: `Requires Herblore ${recipe.level_required}.` };
        let maxQty = 500;
        for (const [mat, need] of Object.entries(recipe.materials || {}))
          maxQty = Math.min(maxQty, Math.floor((State.count(mat) || 0) / need));
        if (maxQty < 1) {
          const missing = Object.entries(recipe.materials || {}).filter(([m]) => (State.count(m) || 0) < 1).map(([m]) => GameData.name(m));
          return { error: `Not enough materials — need ${missing.join(', ')}.` };
        }
        const qty = capQty(Math.min(maxQty, qtyArg || maxQty));
        for (const [mat, need] of Object.entries(recipe.materials || {})) State.removeItem(mat, need * qty);
        const petDef3 = GameData.petBySkill.herblore;
        const baseFrameMs = Sim.sessionDurationMs(State.level('agility')) / 60;
        const effects = Object.entries(recipe.effects || {}).map(([k, v]) => `+${v} ${k}`).join(', ');
        return { ok: true, session: mkSession('production', 'herblore', activityKey, recipe.display_name,
          { frames: Sim.simulateCraft(State.xp('herblore'), qty, recipe.xp_per_item, recipe.output_quantity || 1, activityKey, 1, !worker && petDef3 ? { key: petDef3.id, chance: 1 / 1000 } : null), durationMs: Math.max(1, qty * baseFrameMs) },
          { consumed: Object.fromEntries(Object.entries(recipe.materials || {}).map(([m, n]) => [m, n * qty])), outputKey: activityKey, totalQty: qty * (recipe.output_quantity || 1) }) };
      }
      case 'smithing': case 'fletching': case 'crafting': case 'construction': {
        const recipe = GameData.recipes[skill][activityKey];
        if (!recipe) return { error: 'Unknown recipe.' };
        if (level < recipe.level_required) return { error: `Requires ${Util.prettify(skill)} ${recipe.level_required}.` };
        let maxQty = 500;
        for (const [mat, need] of Object.entries(recipe.materials || {}))
          maxQty = Math.min(maxQty, Math.floor((State.count(mat) || 0) / need));
        if (maxQty < 1) {
          const missing = Object.entries(recipe.materials || {}).filter(([m]) => (State.count(m) || 0) < 1).map(([m]) => GameData.name(m));
          return { error: `Not enough materials${missing.length ? ' — need ' + missing.join(', ') : ''}.` };
        }
        const qty = capQty(Math.min(maxQty, qtyArg || maxQty));
        // Artisan's Workshop: a chance to preserve every material except the first (primary)
        const mats = Object.entries(recipe.materials || {});
        const toConsume = {};
        mats.forEach(([m, n], i) => {
          let consume = n * qty;
          if (i > 0 && saveChance > 0) {
            let kept = 0;
            for (let u = 0; u < consume; u++) if (Math.random() < saveChance) kept++;
            consume -= kept;
          }
          toConsume[m] = consume;
        });
        for (const [mat, n] of Object.entries(toConsume)) if (n > 0) State.removeItem(mat, n);
        const eff = skill === 'smithing'
          ? State.toolEfficiency('hammer', 'smithing', recipe.level_required)
          : 1.0;
        const petDef4 = GameData.petBySkill[skill];
        const baseFrameMs = Sim.sessionDurationMs(State.level('agility')) / 60;
        return { ok: true, session: mkSession('production', skill, activityKey, recipe.display_name,
          { frames: Sim.simulateCraft(State.xp(skill), qty, recipe.xp_per_item, recipe.output_quantity || 1, activityKey, eff, !worker && petDef4 ? { key: petDef4.id, chance: 1 / 1000 } : null), durationMs: Math.max(1, qty * baseFrameMs / eff) },
          { consumed: toConsume, outputKey: activityKey, totalQty: qty * (recipe.output_quantity || 1) }) };
      }
      case 'cooking': {
        const recipe = GameData.recipes.cooking[activityKey];
        if (!recipe) return { error: 'Unknown recipe.' };
        if (level < recipe.level_required) return { error: `Requires Cooking ${recipe.level_required}.` };
        const have = State.count(recipe.raw_item) || 0;
        const qty = capQty(Math.min(have, qtyArg || have));
        if (qty < 1) return { error: `You need ${GameData.name(recipe.raw_item)} to cook.` };
        State.removeItem(recipe.raw_item, qty);
        const eff = State.toolEfficiency('frying_pan', 'cooking', recipe.level_required);
        const baseFrameMs = Sim.sessionDurationMs(State.level('agility')) / 60;
        return { ok: true, session: mkSession('production', 'cooking', activityKey, recipe.display_name,
          { frames: Sim.simulateCraft(State.xp('cooking'), qty, recipe.xp_per_item, 1, recipe.cooked_item, eff), durationMs: Math.max(1, qty * baseFrameMs / eff) },
          { consumed: { [recipe.raw_item]: qty }, outputKey: recipe.cooked_item, totalQty: qty }) };
      }
      case 'runecrafting': {
        const rune = GameData.runes[activityKey];
        if (!rune) return { error: 'Unknown rune.' };
        if (level < rune.level_required) return { error: `Requires Runecrafting ${rune.level_required}.` };
        const have = Math.floor((State.count('rune_essence') || 0) / (rune.essence_cost || 1));
        const qty = capQty(Math.min(have, qtyArg || have));
        if (qty < 1) return { error: 'You need Rune Essence — mine it at level 1 Mining or buy it at the shop.' };
        State.removeItem('rune_essence', qty * (rune.essence_cost || 1));
        const petDef5 = GameData.petBySkill.runecrafting;
        const frames = Sim.simulateRunecrafting(activityKey, rune, qty, State.xp('runecrafting'));
        if (!worker && petDef5 && frames.length > 0) {
          for (let i = 0; i < 60; i++) if (Math.random() < 1 / 1000) {
            const last = frames[frames.length - 1];
            last.items[petDef5.id] = (last.items[petDef5.id] || 0) + 1;
            break;
          }
        }
        const baseFrameMs = Sim.sessionDurationMs(State.level('agility')) / 60;
        return { ok: true, session: mkSession('production', 'runecrafting', activityKey, rune.display_name,
          { frames, durationMs: Math.max(1, qty * baseFrameMs) },
          { consumed: { rune_essence: qty * (rune.essence_cost || 1) }, outputKey: activityKey, totalQty: qty }) };
      }
      case 'prayer': {
        const bone = GameData.bones[activityKey];
        if (!bone) return { error: 'Unknown bone.' };
        const have = State.count(activityKey) || 0;
        const qty = capQty(Math.min(have, qtyArg || have));
        if (qty < 1) return { error: `You need ${bone.display_name}.` };
        State.removeItem(activityKey, qty);
        const baseFrameMs = Sim.sessionDurationMs(State.level('agility')) / 60;
        return { ok: true, session: mkSession('production', 'prayer', activityKey, bone.display_name,
          { frames: Sim.simulateCraft(State.xp('prayer'), qty, bone.xp_per_bone, 1, null, 1), durationMs: Math.max(1, qty * baseFrameMs) },
          { consumed: { [activityKey]: qty }, totalQty: qty }) };
      }
      default:
        return { error: 'Skill not available in the web edition.' };
    }
  },

  /* ------------------------------ dungeons ------------------------------ */

  validateStyle(style) {
    const weaponKey = State.equippedItem('weapon');
    const weapon = weaponKey ? GameData.equipment[weaponKey] : null;
    if (['attack', 'strength', 'defense'].includes(style)) {
      if (!weapon || !['attack', 'strength', null].includes(weapon.combat_style))
        return 'Equip a melee weapon for this style.';
      return null;
    }
    if (style === 'ranged') {
      if (!weapon || weapon.combat_style !== 'ranged') return 'Equip a bow to fight with Ranged.';
      return null;
    }
    if (style === 'magic') {
      if (!weapon || weapon.combat_style !== 'magic') return 'Equip a staff to fight with Magic.';
      if (!State.state.activeSpell) return 'Select a spell in the Combat tab.';
      const spell = GameData.spells[State.state.activeSpell];
      if (State.level('magic') < spell.magic_level_required) return `Requires Magic ${spell.magic_level_required}.`;
      if (!weapon.infinite_runes && State.count(spell.rune_type) < 1)
        return `You need ${GameData.name(spell.rune_type)}s to cast ${spell.display_name}.`;
      return null;
    }
    return 'Unknown style.';
  },

  startDungeonSession(dungeonKey, opts = {}) {
    const worker = opts.worker || null;
    if (!worker && this.hasSession()) return { error: 'A session is already running.' };
    const dungeon = GameData.dungeons[dungeonKey];
    if (!dungeon) return { error: 'Unknown dungeon.' };
    if (!State.dungeonUnlocked(dungeonKey)) return { error: 'This dungeon is locked — something in the clouds must open the way…' };
    const style = State.state.combatStyle;
    const styleError = this.validateStyle(style);
    if (styleError) return { error: styleError };
    if (style === 'ranged' && !State.equippedItem('arrows')) return { error: 'Select arrows in the Combat tab.' };

    const ctx = State.combatContext();
    ctx.petBoostPct = State.combatPetBoost();
    // Potion: one dose consumed at session start, bonuses last the whole run
    const potionKey = State.state.activePotion;
    if (potionKey && State.count(potionKey) > 0 && GameData.potionEffects[potionKey]) {
      State.removeItem(potionKey, 1);
      ctx.potions = GameData.potionEffects[potionKey];
    } else {
      ctx.potions = {};
    }
    const result = Sim.simulateDungeon(dungeon, ctx);
    State.save();
    const sess = worker
      ? this._makeWorkerSession(worker, 'dungeon', 'combat', dungeonKey, dungeon.display_name, result, { style })
      : this._makeSession('dungeon', 'combat', dungeonKey, dungeon.display_name, result, {
        style,
        foodAtStart: { ...ctx.food },
        arrowsAtStart: style === 'ranged' ? Object.entries(ctx.arrows).map(([k]) => k)[0] || null : null,
      });
    return { ok: true, session: sess };
  },

  /* ------------------------------ collect ------------------------------ */

  collect() {
    const sess = this.session();
    if (!sess) return null;
    const summary = {
      xpBySkill: {}, items: {}, kills: 0, killsByEnemy: {}, died: false,
      foodConsumed: {}, arrowsConsumed: {}, runesConsumed: {}, leveled: [],
      dungeon: sess.kind === 'dungeon' ? sess.activityKey : null,
      boss: sess.kind === 'boss' ? sess.activityKey : null,
      bossWon: false,
      expedition: sess.kind === 'expedition' ? sess.activityKey : null,
      notes: 0, noteTexts: [], unlockedDungeon: null,
      completed: sess.kind === 'dungeon' && !sess.frames.some(f => f.died),
    };

    for (const f of sess.frames) {
      for (const [k, v] of Object.entries(f.xpBySkill || {})) summary.xpBySkill[k] = (summary.xpBySkill[k] || 0) + v;
      if (f.xpGain && !f.xpBySkill) summary.xpBySkill[sess.skill] = (summary.xpBySkill[sess.skill] || 0) + f.xpGain;
      for (const [k, v] of Object.entries(f.items || {})) summary.items[k] = (summary.items[k] || 0) + v;
      summary.kills += f.kills || 0;
      for (const [k, v] of Object.entries(f.killsByEnemy || {})) summary.killsByEnemy[k] = (summary.killsByEnemy[k] || 0) + v;
      if (f.died) summary.died = true;
      for (const [k, v] of Object.entries(f.foodConsumed || {})) summary.foodConsumed[k] = (summary.foodConsumed[k] || 0) + v;
      for (const [k, v] of Object.entries(f.arrowsConsumed || {})) summary.arrowsConsumed[k] = (summary.arrowsConsumed[k] || 0) + v;
      for (const [k, v] of Object.entries(f.runesConsumed || {})) summary.runesConsumed[k] = (summary.runesConsumed[k] || 0) + v;
    }

    // --- Expedition: pull lore notes out of the loot and apply them ---
    if (sess.kind === 'expedition' && typeof Systems.Expeditions !== 'undefined') {
      let rawNotes = 0;
      for (const k of Object.keys(summary.items)) {
        if (k.startsWith('note_')) { rawNotes += summary.items[k]; delete summary.items[k]; }
      }
      const res = Systems.Expeditions.collectNotes(sess.activityKey, rawNotes);
      summary.notes = res.notes;
      summary.noteTexts = res.revealed || [];
      summary.unlockedDungeon = res.unlocked;
      if (res.unlocked) {
        State.pushLog(`🗺️ ${res.unlockMessage || 'A new dungeon is unlocked!'}`, 'quest');
      }
    }

    // --- Boss fights: the final frame carries the verdict ---
    if (sess.kind === 'boss') {
      const last = sess.frames[sess.frames.length - 1];
      summary.bossWon = (last.kills || 0) > 0;
      if (summary.bossWon) {
        summary.kills = 1;
        summary.killsByEnemy = { [sess.activityKey]: 1 };
      } else {
        summary.kills = 0;
        summary.killsByEnemy = {};
        summary.items = {};   // no loot on a loss (XP is already at 10% in the frames)
      }
      summary.completed = summary.bossWon;
      // Ammo/rune reclaim like the tower
      summary.reclaimed = {};
      for (const [k, v] of Object.entries(summary.arrowsConsumed)) {
        const back = Math.floor(v * Systems.reclaimChance(State.level('ranged')));
        if (back > 0) { summary.arrowsConsumed[k] -= back; summary.reclaimed[k] = back; }
      }
      for (const [k, v] of Object.entries(summary.runesConsumed)) {
        const back = Math.floor(v * Systems.reclaimChance(State.level('magic')));
        if (back > 0) { summary.runesConsumed[k] -= back; summary.reclaimed[k] = (summary.reclaimed[k] || 0) + back; }
      }
    }

    // --- Tower: death forfeits 90% of XP/loot; survivors get tower bonus multipliers ---
    const tower = State.state.tower;
    if (sess.kind === 'tower') {
      if (summary.died) {
        for (const k of Object.keys(summary.xpBySkill)) summary.xpBySkill[k] = Math.max(1, Math.floor(summary.xpBySkill[k] * 0.1));
        for (const k of Object.keys(summary.items)) {
          summary.items[k] = Math.floor(summary.items[k] * 0.1);
          if (summary.items[k] === 0) delete summary.items[k];
        }
      } else {
        const xpMult = 1 + tower.xpBonus / 100;
        const coinMult = 1 + tower.coinBonus / 100;
        for (const k of Object.keys(summary.xpBySkill)) summary.xpBySkill[k] = Math.floor(summary.xpBySkill[k] * xpMult);
        if (summary.items.coins) summary.items.coins = Math.floor(summary.items.coins * coinMult);
      }
      // Ammo/runes partially reclaimed (25%..75% by ranged/magic level)
      summary.reclaimed = {};
      for (const [k, v] of Object.entries(summary.arrowsConsumed)) {
        const back = Math.floor(v * Systems.reclaimChance(State.level('ranged')));
        if (back > 0) { summary.arrowsConsumed[k] -= back; summary.reclaimed[k] = back; }
      }
      for (const [k, v] of Object.entries(summary.runesConsumed)) {
        const back = Math.floor(v * Systems.reclaimChance(State.level('magic')));
        if (back > 0) { summary.runesConsumed[k] -= back; summary.reclaimed[k] = (summary.reclaimed[k] || 0) + back; }
      }
    }

    // --- Slayer: on-task kills grant Slayer XP and complete tasks (survivors only) ---
    if ((sess.kind === 'dungeon' || sess.kind === 'tower') && !summary.died && Object.keys(summary.killsByEnemy).length) {
      const slayerRes = Systems.recordKills(summary.killsByEnemy);
      if (slayerRes.xp > 0) summary.xpBySkill.slayer = (summary.xpBySkill.slayer || 0) + slayerRes.xp;
      summary.slayerTasks = slayerRes.tasksCompleted;
      State.state.stats.slayerTasksCompleted = (State.state.stats.slayerTasksCompleted || 0) + slayerRes.tasksCompleted;
      Systems.recordGuildSlayer(slayerRes.taskKills, slayerRes.tasksCompleted);
    }

    // --- Church blessing + XP boost multipliers apply to collected rewards ---
    const blessXp = State.blessingXpMultiplier();
    const blessCoins = State.blessingCoinMultiplier();
    const boostXp = State.xpBoostActive() ? 2 : 1;
    if (blessXp > 1 || boostXp > 1)
      for (const k of Object.keys(summary.xpBySkill)) summary.xpBySkill[k] = Math.floor(summary.xpBySkill[k] * blessXp * boostXp);
    if (blessCoins > 1 && summary.items.coins) summary.items.coins = Math.floor(summary.items.coins * blessCoins);

    // Apply XP
    for (const [skill, xp] of Object.entries(summary.xpBySkill)) {
      const ups = State.addXp(skill, xp);
      if (ups.length === 2) summary.leveled.push(`${skill} ${ups[0]}→${ups[1]}`);
    }
    // Apply items (pets are intercepted into the pet collection)
    summary.petsGained = [];
    for (const [k, v] of Object.entries(summary.items)) {
      if (GameData.pets[k]) { for (let i = 0; i < v; i++) if (State.addPet(k) && !summary.petsGained.includes(k)) summary.petsGained.push(k); continue; }
      State.addItem(k, v);
    }
    // Consume ammo/food used during combat
    for (const [k, v] of Object.entries(summary.foodConsumed)) State.removeItem(k, v);
    for (const [k, v] of Object.entries(summary.arrowsConsumed)) State.removeItem(k, v);
    for (const [k, v] of Object.entries(summary.runesConsumed)) State.removeItem(k, v);

    // --- Tower floor progression ---
    if (sess.kind === 'tower') {
      const floor = sess.floor;
      if (summary.died) {
        const checkpoint = Math.floor(tower.best / 25) * 25;
        tower.current = checkpoint;
        State.pushLog(`🗼 You fell on tower floor ${floor} — back to checkpoint ${checkpoint}.`, 'death');
      } else {
        const isBest = floor > tower.best;
        tower.current = floor;
        tower.best = Math.max(tower.best, floor);
        State.pushLog(isBest ? `🗼 New tower record: floor ${floor}!` : `🗼 Tower floor ${floor} cleared.`, 'quest');
      }
    }

    this._updateQuestCounters(sess, summary);
    this._updateGuildCounters(sess, summary);

    // --- Seasonal event hooks (bounty board progress + token pillars) ---
    if (typeof Systems.Seasonal !== 'undefined') {
      if (sess.kind === 'gathering') Systems.Seasonal.recordGathering(summary.items);
      else if (sess.kind === 'expedition') Systems.Seasonal.recordGathering(summary.items);
      else if (sess.kind === 'production') Systems.Seasonal.recordCrafting(summary.items);
      else if ((sess.kind === 'dungeon' || sess.kind === 'tower' || sess.kind === 'boss') && Object.keys(summary.killsByEnemy).length)
        Systems.Seasonal.recordCombat(summary.killsByEnemy);
      if (sess.kind === 'expedition') Systems.Seasonal.recordExpeditionCompletion(sess.activityKey);
      if (sess.kind === 'boss' && summary.bossWon) Systems.Seasonal.recordBossDefeat(sess.activityKey);
    }
    // --- Mercantile guild: route completions + coins earned from trade ---
    if (sess.kind === 'gathering' && sess.skill === 'mercantile')
      Systems.recordGuildTrade(sess.activityKey, summary.items.coins || 0);

    State.state.stats.sessionsCollected++;
    State.state.session = null;
    State.save();
    return summary;
  },

  /** Feed a collected session into the guild tracking system. */
  _updateGuildCounters(sess, summary) {
    if (typeof Systems === 'undefined') return;
    if (sess.kind === 'gathering' || sess.kind === 'expedition') {
      if (sess.skill === 'thieving') {
        const okFrames = sess.frames.filter(f => (f.xpGain || 0) > 0).length;
        Systems.recordGuildThieving(sess.activityKey, okFrames);
      } else if (sess.skill === 'agility') {
        Systems.recordGuildAgility(sess.activityKey);
      } else {
        Systems.recordGuildGathering(sess.skill, summary.items);
      }
    } else if (sess.kind === 'production') {
      if (sess.skill === 'prayer') {
        const buried = Object.values(sess.consumed || {}).reduce((a, b) => a + b, 0);
        Systems.recordGuildPrayer(buried);
      } else {
        Systems.recordGuildCrafting(sess.skill, summary.items);
      }
    } else if (sess.kind === 'dungeon' || sess.kind === 'tower' || sess.kind === 'boss') {
      if (!summary.died && Object.keys(summary.killsByEnemy).length) Systems.recordGuildCombat(summary.killsByEnemy, sess.style);
    }
  },

  _updateQuestCounters(sess, sum) {
    const st = State.state.stats;
    if (sess.kind === 'gathering') {
      if (sess.skill === 'thieving') {
        st.pickpockets = st.pickpockets || 0;
        const okFrames = sess.frames.filter(f => (f.xpGain || 0) > 0).length;
        st.pickpocketsByNpc = st.pickpocketsByNpc || {};
        st.pickpocketsByNpc[sess.activityKey] = (st.pickpocketsByNpc[sess.activityKey] || 0) + okFrames;
        st.stolen = st.stolen || {};
        for (const [k, v] of Object.entries(sum.items)) if (k !== 'coins') st.stolen[k] = (st.stolen[k] || 0) + v;
      } else {
        for (const [k, v] of Object.entries(sum.items)) {
          st.itemsGathered[k] = (st.itemsGathered[k] || 0) + v;
          if (sess.skill === 'fishing' && k.startsWith('raw_')) {
            st.fishCaught = (st.fishCaught || 0) + v;
          }
        }
      }
    } else if (sess.kind === 'expedition') {
      // Expeditions count as gathering for their skill (like the app's recordGathering)
      for (const [k, v] of Object.entries(sum.items)) st.itemsGathered[k] = (st.itemsGathered[k] || 0) + v;
    } else if (sess.kind === 'production') {
      if (sess.outputKey) {
        st.itemsCrafted[sess.outputKey] = (st.itemsCrafted[sess.outputKey] || 0) + (sum.items[sess.outputKey] || 0);
        if (sess.skill === 'cooking') {
          const recipe = Object.values(GameData.recipes.cooking).find(r => r.cooked_item === sess.outputKey);
          if (recipe && recipe.raw_item.startsWith('raw_')) st.fishCooked = (st.fishCooked || 0) + (sum.items[sess.outputKey] || 0);
        }
      }
      if (sess.skill === 'prayer') {
        st.bonesScatteredTotal = (st.bonesScatteredTotal || 0) + (sess.consumed ? Object.values(sess.consumed).reduce((a, b) => a + b, 0) : 0);
      }
    } else if (sess.kind === 'dungeon' || sess.kind === 'boss') {
      st.totalKills += sum.kills;
      for (const [k, v] of Object.entries(sum.killsByEnemy)) st.killsByEnemy[k] = (st.killsByEnemy[k] || 0) + v;
      st.combatItems = st.combatItems || {};
      for (const [k, v] of Object.entries(sum.items)) if (k !== 'coins') st.combatItems[k] = (st.combatItems[k] || 0) + v;
      if (sess.kind === 'boss' && sum.bossWon) {
        st.bossKillsByBoss = st.bossKillsByBoss || {};
        st.bossKillsByBoss[sess.activityKey] = (st.bossKillsByBoss[sess.activityKey] || 0) + 1;
      }
      if (sum.completed) {
        st.dungeonRuns[sess.activityKey] = (st.dungeonRuns[sess.activityKey] || 0) + 1;
        st.dungeonStyleRuns[sess.activityKey + ':' + sess.style] = (st.dungeonStyleRuns[sess.activityKey + ':' + sess.style] || 0) + 1;
        const usedFood = Object.values(sum.foodConsumed).some(v => v > 0);
        if (!usedFood) {
          st.dungeonNoFoodByDungeon = st.dungeonNoFoodByDungeon || {};
          st.dungeonNoFoodByDungeon[sess.activityKey] = (st.dungeonNoFoodByDungeon[sess.activityKey] || 0) + 1;
        }
      }
    }
  },

  /* ============================ Shop ============================ */

  /** Heuristic sell price, ported from ShopViewModel.sellPriceFor (simplified). */
  sellPrice(itemKey) {
    const mp = this._marketPrice(itemKey);
    const eq = GameData.equipment[itemKey];
    let base;
    if (eq) {
      if (itemKey.endsWith('_cape')) base = Math.max(5, Math.max(...Object.values(eq.requirements || {}), 1) * 3);
      else if (eq.slot === 'weapon' || eq.slot === 'body' || eq.slot === 'legs') base = Math.max(5, Math.max(...Object.values(eq.requirements || {}), 1) * 8);
      else base = Math.max(5, Math.max(...Object.values(eq.requirements || {}), 1) * 4);
    } else {
      const gem = GameData.gems[itemKey];
      base = 5;
      if (itemKey.includes('bar')) {
        base = { runite: 230, adamantite: 130, platinum: 140, mithril: 65, gold: 27, steel: 22, silver: 20, iron: 10 }[
          itemKey.split('_')[0]] || 15;
      } else if (gem) {
        base = { very_rare: 150, rare: 100, uncommon: 70 }[gem.rarity] || 50;
      } else if (itemKey.includes('arrow')) {
        base = { runite: 20, adamantite: 14, mithril: 9, steel: 6, iron: 4 }[itemKey.split('_')[0]] || 3;
        if (itemKey === 'arrow_shaft') base = 1;
      } else if (itemKey.endsWith('potion') || itemKey.endsWith('brew')) base = 25;
      else if (itemKey.includes('log')) base = 5;
      else if (itemKey.endsWith('_plank')) base = { redwood: 40, magic: 30, yew: 22, maple: 14, willow: 9, oak: 6 }[itemKey.split('_')[0]] || 4;
      else if (itemKey.endsWith('_nail')) base = { runite: 60, mithril: 25, steel: 12, iron: 6 }[itemKey.split('_')[0]] || 5;
      else if (itemKey.endsWith('ore') || itemKey === 'rune_essence') base = 5;
      else if (itemKey === 'stone') base = 8;
      else if (itemKey === 'carved_stone') base = 20;
      else if (itemKey === 'stone_block') base = 45;
      else if (GameData.recipes.construction[itemKey]) base = Math.max(10, Math.round((GameData.recipes.construction[itemKey].xp_per_item || 30) / 2));
      else if (itemKey.startsWith('cooked')) base = 10;
      else if (itemKey.startsWith('raw_')) base = 4;
      else if (GameData.fish[itemKey]) base = 8;
      else if (itemKey.includes('bone') || itemKey.includes('ashes')) base = 8;
      else if (itemKey.endsWith('_rune')) base = 8;
      else base = 5;
    }
    if (mp != null) {
      base = Math.max(base, Math.max(1, Math.floor(mp / 3)));
      const buy = Math.max(1, Math.floor(mp));
      return Math.max(1, Math.min(base, buy - 1));
    }
    return Math.max(1, base);
  },

  _marketPrice(itemKey) {
    for (const cat of Object.values(GameData.marketplace)) {
      const it = cat.items[itemKey];
      if (it) return it.price;
    }
    return null;
  },

  /** Buy catalogue: every marketplace item that is useful in the web edition. */
  buyEntries() {
    const entries = [];
    for (const cat of Object.values(GameData.marketplace)) {
      for (const [key, item] of Object.entries(cat.items)) {
        entries.push({ key, name: item.display_name, desc: item.description, price: item.price, category: cat.category_name });
      }
    }
    return entries;
  },

  buy(itemKey, qty) {
    const price = this._marketPrice(itemKey);
    if (price == null) return { error: 'Not for sale.' };
    const total = price * qty;
    if (State.state.coins < total) return { error: 'Not enough coins.' };
    State.state.coins -= total;
    State.addItem(itemKey, qty);
    State.save();
    return { ok: true };
  },

  /** The shop's 48h 2x XP boost (xp_boost_48h, 2.5M coins — port of activateXpBoost). */
  XP_BOOST: { key: 'xp_boost_48h', price: 2500000, durationMs: 48 * 3600000 },

  buyXpBoost() {
    if (State.xpBoostActive()) return { error: 'A 2× XP boost is already active.' };
    if (State.state.coins < this.XP_BOOST.price) return { error: 'Not enough coins.' };
    State.state.coins -= this.XP_BOOST.price;
    State.state.xpBoostUntil = Date.now() + this.XP_BOOST.durationMs;
    State.pushLog('⚡ 2× XP boost activated for 48 hours!', 'levelup');
    State.save();
    return { ok: true };
  },

  sell(itemKey, qty) {
    if (itemKey === 'carnival_ticket') return { error: 'Tickets can only be spent at the Carnival.' };
    const have = State.count(itemKey);
    qty = Math.min(qty, have);
    if (qty < 1) return { error: 'Nothing to sell.' };
    const equipped = Object.values(State.state.equipped).includes(itemKey) && have - qty < 1;
    if (equipped) return { error: 'Unequip it first.' };
    State.removeItem(itemKey, qty);
    State.state.coins += this.sellPrice(itemKey) * qty;
    State.save();
    return { ok: true, coins: this.sellPrice(itemKey) * qty };
  },

  /* ============================ Quests ============================ */

  SUPPORTED_QUEST_TYPES: new Set([
    'gather', 'gather_any', 'craft', 'craft_any', 'prayer', 'kill', 'dungeon',
    'kill_enemy', 'dungeon_melee_only', 'dungeon_ranged_only', 'dungeon_magic_only',
    'dungeon_no_food', 'collect', 'pickpocket', 'steal', 'slayer_task',
    'boss', 'upgrade_building',
  ]),

  questsAvailable() {
    return Object.values(GameData.quests).filter(q => this.SUPPORTED_QUEST_TYPES.has(q.type));
  },

  /** Quest progress: {count, goal, unlocked, claimed, complete}. */
  questProgress(q) {
    const st = State.state.stats;
    const qs = State.state.quests[q.id] || {};
    let count = 0;
    switch (q.type) {
      case 'gather': count = st.itemsGathered[q.target] || 0; break;
      case 'gather_any': count = q.target === 'any_fish' ? (st.fishCaught || 0) : 0; break;
      case 'craft': count = st.itemsCrafted[q.target] || 0; break;
      case 'craft_any': count = q.target === 'any_fish' ? (st.fishCooked || 0) : 0; break;
      case 'prayer': count = st.bonesScatteredTotal || 0; break;
      case 'kill': count = st.totalKills || 0; break;
      case 'kill_enemy': count = st.killsByEnemy[q.target] || 0; break;
      case 'dungeon': count = st.dungeonRuns[q.target] || 0; break;
      case 'dungeon_melee_only': count = st.dungeonStyleRuns[q.target + ':attack'] || 0; break;
      case 'dungeon_ranged_only': count = st.dungeonStyleRuns[q.target + ':ranged'] || 0; break;
      case 'dungeon_magic_only': count = st.dungeonStyleRuns[q.target + ':magic'] || 0; break;
      case 'dungeon_no_food': count = (st.dungeonNoFoodByDungeon || {})[q.target] || 0; break;
      case 'collect': count = (st.combatItems || {})[q.target] || 0; break;
      case 'pickpocket': count = (st.pickpocketsByNpc || {})[q.target] || 0; break;
      case 'steal': count = (st.stolen || {})[q.target] || 0; break;
      case 'slayer_task': count = st.slayerTasksCompleted || 0; break;
      case 'boss': count = (st.bossKillsByBoss || {})[q.target] || 0; break;
      case 'upgrade_building': count = (st.buildingsUpgradedByBuilding || {})[q.target] || 0; break;
    }
    const prevClaimed = !q.requires_previous || (State.state.quests[q.requires_previous]?.claimed);
    return {
      count, goal: q.amount,
      unlocked: prevClaimed,
      claimed: !!qs.claimed,
      complete: count >= q.amount,
    };
  },

  claimQuest(questId) {
    const q = GameData.quests[questId];
    if (!q) return { error: 'Unknown quest.' };
    const p = this.questProgress(q);
    if (p.claimed) return { error: 'Already claimed.' };
    if (!p.complete) return { error: 'Not complete yet.' };
    const rewards = q.rewards || {};
    if (rewards.coins) State.addItem('coins', rewards.coins);
    if (rewards.xp) State.addXp(q.skill === 'combat' ? 'attack' : q.skill, rewards.xp);
    for (const [k, v] of Object.entries(rewards.items || {})) State.addItem(k, v);
    State.state.quests[questId] = { claimed: true, claimedAt: Date.now() };
    State.pushLog(`📜 Quest complete: ${q.name}!`, 'quest');
    State.save();
    return { ok: true, rewards };
  },
};

/* Export for Node-based tests (no-op in the browser) */
if (typeof module !== "undefined" && module.exports) module.exports = { Engine };
