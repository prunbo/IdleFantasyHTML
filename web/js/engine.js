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

  _makeSession(kind, skill, activityKey, label, result, extra = {}) {
    const agilityLevel = State.level('agility');
    const nFrames = Math.max(1, result.frames.length);
    const frameMs = Math.max(1000, Math.floor(result.durationMs / nFrames));
    const sess = {
      id: 's' + Date.now(),
      kind, skill, activityKey, label,
      startedAt: Date.now(),
      frameMs,
      frames: result.frames,
      endsAt: Date.now() + result.durationMs,
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
    State.save();
    return sess;
  },

  /* ----------------------- gathering + production ----------------------- */

  /**
   * Start a skill session. Returns {error} or {ok, session}.
   * `qtyArg` limits production sessions (firemaking/smithing/cooking/etc.).
   */
  startSkillSession(skill, activityKey, qtyArg) {
    if (this.hasSession()) return { error: 'A session is already running.' };
    const s = State.state;
    const level = State.level(skill);
    const capeBonus = State.capeBonus(skill);
    const opts = { agilityLevel: State.level('agility'), petBoostPct: 0 };

    switch (skill) {
      case 'mining': {
        const ore = GameData.ores[activityKey];
        if (!ore) return { error: 'Unknown ore.' };
        if (level < ore.level_required) return { error: `Requires Mining ${ore.level_required}.` };
        opts.toolEfficiency = State.toolEfficiency('pickaxe', 'mining') * (1 + capeBonus);
        return { ok: true, session: this._makeSession('gathering', 'mining', activityKey, ore.display_name, Sim.simulateMining(activityKey, ore, State.xp('mining'), opts)) };
      }
      case 'woodcutting': {
        const tree = GameData.trees[activityKey];
        if (!tree) return { error: 'Unknown tree.' };
        if (level < tree.level_required) return { error: `Requires Woodcutting ${tree.level_required}.` };
        opts.toolEfficiency = State.toolEfficiency('axe', 'woodcutting', tree.level_required) * (1 + capeBonus);
        return { ok: true, session: this._makeSession('gathering', 'woodcutting', activityKey, tree.display_name, Sim.simulateWoodcutting(tree, State.xp('woodcutting'), opts)) };
      }
      case 'fishing': {
        const fish = GameData.fish[activityKey];
        if (!fish) return { error: 'Unknown fish.' };
        if (level < fish.level_required) return { error: `Requires Fishing ${fish.level_required}.` };
        opts.toolEfficiency = State.toolEfficiency('fishing_rod', 'fishing') * (1 + capeBonus);
        return { ok: true, session: this._makeSession('gathering', 'fishing', activityKey, GameData.name(activityKey), Sim.simulateFishing(activityKey, fish, State.xp('fishing'), opts)) };
      }
      case 'thieving': {
        const npc = GameData.thievingNpcs.find(n => n.key === activityKey);
        if (!npc) return { error: 'Unknown target.' };
        if (level < npc.level_required) return { error: `Requires Thieving ${npc.level_required}.` };
        opts.toolEfficiency = State.toolEfficiency('lockpick', 'thieving');
        return { ok: true, session: this._makeSession('gathering', 'thieving', activityKey, npc.display_name, Sim.simulateThieving(npc, State.xp('thieving'), level, opts)) };
      }
      case 'agility': {
        const course = GameData.agilityCourses[activityKey];
        if (!course) return { error: 'Unknown course.' };
        if (level < course.level_required) return { error: `Requires Agility ${course.level_required}.` };
        opts.toolEfficiency = State.toolEfficiency('grappling_hook', 'agility');
        return { ok: true, session: this._makeSession('gathering', 'agility', activityKey, course.display_name, Sim.simulateAgility(course, State.xp('agility'), level, opts)) };
      }
      case 'firemaking': {
        const log = GameData.logs[activityKey];
        const ashKey = GameData.ashByLog[activityKey];
        if (!log || !ashKey) return { error: 'Unknown log.' };
        if (level < log.level_required) return { error: `Requires Firemaking ${log.level_required}.` };
        const have = State.count(activityKey);
        const qty = Math.min(have, qtyArg || have);
        if (qty < 1) return { error: `You need ${GameData.name(activityKey)} to burn.` };
        const eff = State.toolEfficiency('tinderbox', 'firemaking', log.level_required);
        State.removeItem(activityKey, qty);
        const baseFrameMs = Sim.sessionDurationMs(State.level('agility')) / 60;
        return { ok: true, session: this._makeSession('production', 'firemaking', activityKey, GameData.name(activityKey),
          { frames: Sim.simulateCraft(State.xp('firemaking'), qty, log.xp_per_log, 1, ashKey, eff), durationMs: Math.max(1, qty * baseFrameMs / eff) },
          { consumed: { [activityKey]: qty }, outputKey: ashKey, totalQty: qty }) };
      }
      case 'smithing': case 'fletching': case 'crafting': {
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
        const qty = Math.min(maxQty, qtyArg || maxQty);
        for (const [mat, need] of Object.entries(recipe.materials || {})) State.removeItem(mat, need * qty);
        const eff = skill === 'smithing'
          ? State.toolEfficiency('hammer', 'smithing', recipe.level_required)
          : 1.0;
        const baseFrameMs = Sim.sessionDurationMs(State.level('agility')) / 60;
        return { ok: true, session: this._makeSession('production', skill, activityKey, recipe.display_name,
          { frames: Sim.simulateCraft(State.xp(skill), qty, recipe.xp_per_item, recipe.output_quantity || 1, activityKey, eff), durationMs: Math.max(1, qty * baseFrameMs / eff) },
          { consumed: Object.fromEntries(Object.entries(recipe.materials || {}).map(([m, n]) => [m, n * qty])), outputKey: activityKey, totalQty: qty * (recipe.output_quantity || 1) }) };
      }
      case 'cooking': {
        const recipe = GameData.recipes.cooking[activityKey];
        if (!recipe) return { error: 'Unknown recipe.' };
        if (level < recipe.level_required) return { error: `Requires Cooking ${recipe.level_required}.` };
        const have = State.count(recipe.raw_item) || 0;
        const qty = Math.min(have, qtyArg || have);
        if (qty < 1) return { error: `You need ${GameData.name(recipe.raw_item)} to cook.` };
        State.removeItem(recipe.raw_item, qty);
        const eff = State.toolEfficiency('frying_pan', 'cooking', recipe.level_required);
        const baseFrameMs = Sim.sessionDurationMs(State.level('agility')) / 60;
        return { ok: true, session: this._makeSession('production', 'cooking', activityKey, recipe.display_name,
          { frames: Sim.simulateCraft(State.xp('cooking'), qty, recipe.xp_per_item, 1, recipe.cooked_item, eff), durationMs: Math.max(1, qty * baseFrameMs / eff) },
          { consumed: { [recipe.raw_item]: qty }, outputKey: recipe.cooked_item, totalQty: qty }) };
      }
      case 'runecrafting': {
        const rune = GameData.runes[activityKey];
        if (!rune) return { error: 'Unknown rune.' };
        if (level < rune.level_required) return { error: `Requires Runecrafting ${rune.level_required}.` };
        const have = Math.floor((State.count('rune_essence') || 0) / (rune.essence_cost || 1));
        const qty = Math.min(have, qtyArg || have);
        if (qty < 1) return { error: 'You need Rune Essence — mine it at level 1 Mining or buy it at the shop.' };
        State.removeItem('rune_essence', qty * (rune.essence_cost || 1));
        const baseFrameMs = Sim.sessionDurationMs(State.level('agility')) / 60;
        return { ok: true, session: this._makeSession('production', 'runecrafting', activityKey, rune.display_name,
          { frames: Sim.simulateRunecrafting(activityKey, rune, qty, State.xp('runecrafting')), durationMs: Math.max(1, qty * baseFrameMs) },
          { consumed: { rune_essence: qty * (rune.essence_cost || 1) }, outputKey: activityKey, totalQty: qty }) };
      }
      case 'prayer': {
        const bone = GameData.bones[activityKey];
        if (!bone) return { error: 'Unknown bone.' };
        const have = State.count(activityKey) || 0;
        const qty = Math.min(have, qtyArg || have);
        if (qty < 1) return { error: `You need ${bone.display_name}.` };
        State.removeItem(activityKey, qty);
        const baseFrameMs = Sim.sessionDurationMs(State.level('agility')) / 60;
        return { ok: true, session: this._makeSession('production', 'prayer', activityKey, bone.display_name,
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

  startDungeonSession(dungeonKey) {
    if (this.hasSession()) return { error: 'A session is already running.' };
    const dungeon = GameData.dungeons[dungeonKey];
    if (!dungeon) return { error: 'Unknown dungeon.' };
    const style = State.state.combatStyle;
    const styleError = this.validateStyle(style);
    if (styleError) return { error: styleError };
    if (style === 'ranged' && !State.equippedItem('arrows')) return { error: 'Select arrows in the Combat tab.' };

    const ctx = State.combatContext();
    const result = Sim.simulateDungeon(dungeon, ctx);
    return {
      ok: true,
      session: this._makeSession('dungeon', 'combat', dungeonKey, dungeon.display_name, result, {
        style,
        foodAtStart: { ...ctx.food },
        arrowsAtStart: style === 'ranged' ? Object.entries(ctx.arrows).map(([k]) => k)[0] || null : null,
      }),
    };
  },

  /* ------------------------------ collect ------------------------------ */

  collect() {
    const sess = this.session();
    if (!sess) return null;
    const summary = {
      xpBySkill: {}, items: {}, kills: 0, killsByEnemy: {}, died: false,
      foodConsumed: {}, arrowsConsumed: {}, runesConsumed: {}, leveled: [],
      dungeon: sess.kind === 'dungeon' ? sess.activityKey : null,
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

    // Apply XP
    for (const [skill, xp] of Object.entries(summary.xpBySkill)) {
      const ups = State.addXp(skill, xp);
      if (ups.length === 2) summary.leveled.push(`${skill} ${ups[0]}→${ups[1]}`);
    }
    // Apply items
    for (const [k, v] of Object.entries(summary.items)) State.addItem(k, v);
    // Consume ammo/food used during combat
    for (const [k, v] of Object.entries(summary.foodConsumed)) State.removeItem(k, v);
    for (const [k, v] of Object.entries(summary.arrowsConsumed)) State.removeItem(k, v);
    for (const [k, v] of Object.entries(summary.runesConsumed)) State.removeItem(k, v);

    this._updateQuestCounters(sess, summary);
    State.state.stats.sessionsCollected++;
    State.state.session = null;
    State.save();
    return summary;
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
    } else if (sess.kind === 'dungeon') {
      st.totalKills += sum.kills;
      for (const [k, v] of Object.entries(sum.killsByEnemy)) st.killsByEnemy[k] = (st.killsByEnemy[k] || 0) + v;
      st.combatItems = st.combatItems || {};
      for (const [k, v] of Object.entries(sum.items)) if (k !== 'coins') st.combatItems[k] = (st.combatItems[k] || 0) + v;
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
      } else if (itemKey.endsWith('potion')) base = 25;
      else if (itemKey.includes('log')) base = 5;
      else if (itemKey.endsWith('ore') || itemKey === 'rune_essence') base = 5;
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

  sell(itemKey, qty) {
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
    'dungeon_no_food', 'collect', 'pickpocket', 'steal',
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
