/* ------------------------------------------------------------------ *
 * sim.js — faithful JavaScript port of the Kotlin simulators:
 *   XpTable, SkillSimulator, ThievingSimulator, CombatSimulator
 * A session = 60 pre-simulated "frames" (1 minute of game time each).
 * The wall-clock duration shrinks with Agility (60 min -> 40 min @ 99).
 * ------------------------------------------------------------------ */
'use strict';

const Sim = {
  TICKS_PER_FRAME: 25,
  BASE_ATTACK_SPEED_SEC: 2.4,

  /* --------------------------- pet drop helper --------------------------- */

  /** One pet-drop roll (chance is per frame, like the app's 1/1000 x 60 frames). */
  _petRoll(items, petDrop) {
    if (petDrop && petDrop.key && Math.random() < petDrop.chance) {
      items[petDrop.key] = (items[petDrop.key] || 0) + 1;
    }
  },

  /* ------------------------------ XP table ------------------------------ */

  levelForXp(xp) {
    const t = GameData.xpTable;
    let level = 1;
    for (let l = 1; l <= 99; l++) {
      if (xp >= t[String(l)]) level = l; else break;
    }
    return level;
  },

  xpForLevel(level) { return GameData.xpTable[String(Util.clamp(level, 1, 99))]; },

  /** Agility bonus: sessions scale from 60 min at lvl 1 to 40 min at lvl 99.
   *  `durationMult` (Chronos Spire) further scales the wall-clock time. */
  sessionDurationMs(agilityLevel, durationMult = 1) {
    const fraction = Util.clamp(agilityLevel - 1, 0, 98) / 98;
    const maxReduction = 20.0;
    const minutes = (60.0 - maxReduction * fraction) * Util.clamp(durationMult, 0.5, 1.0);
    return Math.max(1, Math.round(minutes)) * 60000;
  },

  /* -------------------------- Gathering skills -------------------------- */

  /** Mining: fixed ore target, 1 ore/frame base, independent gem rolls per ore. */
  simulateMining(oreKey, oreData, startXp, opts) {
    const eff = opts.toolEfficiency || 1;
    const petBoost = opts.petBoostPct || 0;
    let currentXp = startXp, acc = 0;
    const frames = [];
    for (let minute = 1; minute <= 60; minute++) {
      const xpBefore = currentXp;
      const levelBefore = this.levelForXp(currentXp);
      const baseXp = Math.floor(oreData.xp_per_ore * eff);
      const xpGain = Math.floor(baseXp * (1 + petBoost / 100));
      currentXp += xpGain;
      const levelAfter = this.levelForXp(currentXp);

      acc += eff;
      const qty = Math.max(1, Math.floor(acc));
      acc -= qty;
      const items = { [oreKey]: qty };
      for (let i = 0; i < qty; i++)
        for (const [gemKey, gem] of Object.entries(GameData.gems))
          if (Math.random() < gem.drop_rate) items[gemKey] = (items[gemKey] || 0) + 1;
      this._petRoll(items, opts.petDrop);

      frames.push(this._frame(minute, xpBefore, currentXp, levelBefore, levelAfter, items, xpGain));
    }
    return this._result(frames, opts.agilityLevel);
  },

  /** Woodcutting: fixed tree target; always yields that tree's log. */
  simulateWoodcutting(treeData, startXp, opts) {
    const eff = opts.toolEfficiency || 1;
    const petBoost = opts.petBoostPct || 0;
    let currentXp = startXp, acc = 0;
    const frames = [];
    for (let minute = 1; minute <= 60; minute++) {
      const xpBefore = currentXp;
      const levelBefore = this.levelForXp(currentXp);
      const baseXp = Math.floor(treeData.xp_per_log * eff);
      const xpGain = Math.floor(baseXp * (1 + petBoost / 100));
      currentXp += xpGain;
      const levelAfter = this.levelForXp(currentXp);

      acc += eff;
      const qty = Math.max(1, Math.floor(acc));
      acc -= qty;
      const items = { [treeData.log_name]: qty };
      this._petRoll(items, opts.petDrop);

      frames.push(this._frame(minute, xpBefore, currentXp, levelBefore, levelAfter, items, xpGain));
    }
    return this._result(frames, opts.agilityLevel);
  },

  /** Fishing: fixed catch target, plus a 20% chance/frame of rolling the junk table. */
  simulateFishing(fishKey, fishData, startXp, opts) {
    const eff = opts.toolEfficiency || 1;
    let currentXp = startXp, acc = 0;
    const frames = [];
    for (let minute = 1; minute <= 60; minute++) {
      const xpBefore = currentXp;
      const levelBefore = this.levelForXp(currentXp);
      const xpGain = Math.floor(fishData.xp_per_catch * eff);
      currentXp += xpGain;
      const levelAfter = this.levelForXp(currentXp);

      acc += eff;
      const qty = Math.max(1, Math.floor(acc));
      acc -= qty;
      const items = {};
      if (GameData.fishingSkill && Math.random() > 0.8) {
        const dropTable = Util.tierFor(GameData.fishingSkill.drop_tables, levelBefore);
        for (const entry of dropTable)
          if (Math.random() < entry.chance) items[entry.item] = (items[entry.item] || 0) + 1;
        if (Object.keys(items).length === 0) items[fishKey] = qty;
      } else {
        items[fishKey] = qty;
      }
      this._petRoll(items, opts.petDrop);

      frames.push(this._frame(minute, xpBefore, currentXp, levelBefore, levelAfter, items, xpGain));
    }
    return this._result(frames, opts.agilityLevel);
  },

  /** Thieving: one pickpocket attempt per frame; failure stuns the next frame. */
  simulateThieving(npc, startXp, thievingLevel, opts) {
    const eff = opts.toolEfficiency || 1;
    const successChance = Util.clamp(0.40 + (thievingLevel - npc.level_required) * 0.02 * eff, 0.10, 0.95);
    let currentXp = startXp, stunNext = false;
    const frames = [];
    for (let minute = 1; minute <= 60; minute++) {
      const xpBefore = currentXp;
      const levelBefore = this.levelForXp(currentXp);

      if (stunNext || Math.random() >= successChance) {
        stunNext = !stunNext; // a fresh failure stuns; a stun frame just recovers
        frames.push(this._frame(minute, xpBefore, xpBefore, levelBefore, levelBefore, {}, 0));
        continue;
      }
      const xpGain = npc.base_xp;
      currentXp += xpGain;
      const levelAfter = this.levelForXp(currentXp);

      const items = { coins: Util.randInt(npc.coins_min, npc.coins_max) };
      for (const entry of (npc.loot_table || []))
        if (Math.random() < entry.chance) {
          const q = entry.min_qty && entry.max_qty ? Util.randInt(entry.min_qty, entry.max_qty) : 1;
          items[entry.item] = (items[entry.item] || 0) + q;
        }
      this._petRoll(items, opts.petDrop);

      frames.push(this._frame(minute, xpBefore, currentXp, levelBefore, levelAfter, items, xpGain));
    }
    return this._result(frames, opts.agilityLevel);
  },

  /** Agility: lap-based; success chance grows with level above the course requirement. */
  simulateAgility(course, startXp, agilityLevel, opts) {
    const eff = opts.toolEfficiency || 1;
    const successRate = Math.min(0.95, 0.80 + (agilityLevel - course.level_required) * 0.02);
    const lapsPerMinute = Math.max(1, Math.round(2 * eff));
    let currentXp = startXp;
    const frames = [];
    for (let minute = 1; minute <= 60; minute++) {
      const xpBefore = currentXp;
      const levelBefore = this.levelForXp(currentXp);
      let successes = 0;
      for (let i = 0; i < lapsPerMinute; i++) if (Math.random() < successRate) successes++;
      const xpGain = successes * course.xp_per_success;
      currentXp += xpGain;
      const levelAfter = this.levelForXp(currentXp);
      frames.push(this._frame(minute, xpBefore, currentXp, levelBefore, levelAfter, {}, xpGain));
    }
    return this._result(frames, opts.agilityLevel);
  },

  /**
   * Port of QueuedSessionStarter.buildCraftFrames: bucket `qty` batches across
   * min(qty, 60) frames. XP per batch scales with efficiency; item output does not
   * (efficiency instead shortens the session, set by the engine).
   */
  simulateCraft(startXp, qty, xpPerItem, outputQty, outputKey, eff, petDrop) {
    const frameCount = Math.min(qty, 60);
    const frames = [];
    let xp = startXp;
    // Pet drop: the app rolls once per frame (up to 60) and attaches it to the last frame
    let petItem = null;
    if (petDrop && petDrop.key) {
      for (let i = 0; i < 60; i++) if (Math.random() < petDrop.chance) { petItem = petDrop.key; break; }
    }
    for (let bucket = 0; bucket < frameCount; bucket++) {
      const inBucket = Math.floor((bucket + 1) * qty / frameCount) - Math.floor(bucket * qty / frameCount);
      const levelBefore = this.levelForXp(xp);
      const gain = Math.floor(xpPerItem * inBucket * eff);
      xp += gain;
      const levelAfter = this.levelForXp(xp);
      frames.push({
        minute: bucket + 1, xpGain: gain, xpBefore: xp - gain, xpAfter: xp,
        levelBefore, levelAfter, items: outputKey ? { [outputKey]: outputQty * inBucket } : {},
        leveledUp: levelAfter > levelBefore, kills: inBucket, died: false,
      });
    }
    if (petItem && frames.length > 0) {
      const last = frames[frames.length - 1];
      last.items[petItem] = (last.items[petItem] || 0) + 1;
    }
    return frames;
  },

  /** Port of the Runecrafting loop: level ≥50 doubles, ≥75 triples rune output & XP. */
  simulateRunecrafting(runeKey, runeData, qty, startXp) {
    const frameCount = Math.min(qty, 60);
    const frames = [];
    let xp = startXp;
    for (let bucket = 0; bucket < frameCount; bucket++) {
      const inBucket = Math.floor((bucket + 1) * qty / frameCount) - Math.floor(bucket * qty / frameCount);
      const levelBefore = this.levelForXp(xp);
      let gain = 0, runes = 0;
      for (let i = 0; i < inBucket; i++) {
        const level = this.levelForXp(xp);
        const mult = level >= 75 ? 3 : level >= 50 ? 2 : 1;
        const g = Math.floor(runeData.xp_per_rune * mult);
        xp += g; gain += g; runes += mult;
      }
      const levelAfter = this.levelForXp(xp);
      frames.push({
        minute: bucket + 1, xpGain: gain, xpBefore: xp - gain, xpAfter: xp,
        levelBefore, levelAfter, items: { [runeKey]: runes },
        leveledUp: levelAfter > levelBefore, kills: inBucket, died: false,
      });
    }
    return frames;
  },

  /* ----------------------------- Combat ----------------------------- */

  /**
   * Tick-by-tick dungeon combat, ported from CombatSimulator.simulateDungeon.
   * Player attacks every `attackSpeedSec`; the enemy retaliates on a fixed 2.4s
   * clock. Food is auto-eaten (best tier first) at <=50% HP or on big hits.
   */
  simulateDungeon(dungeon, ctx, enemiesOverride) {
    const enemies = enemiesOverride || GameData.enemies;
    const speed = Util.clamp(ctx.attackSpeedSec || this.BASE_ATTACK_SPEED_SEC, 1.2, this.BASE_ATTACK_SPEED_SEC);
    const ticksPerFrame = Math.round(60 / speed);
    const eatFraction = 0.5;

    const effAttack = ctx.attack + (ctx.potions?.attack || 0);
    const effStrength = ctx.strength + (ctx.potions?.strength || 0);
    const effDefence = ctx.defense + (ctx.potions?.defense || 0);
    const effRanged = ctx.ranged + (ctx.potions?.ranged || 0);
    const effMagic = ctx.magic + (ctx.potions?.magic || 0);

    const spawnPool = [];
    for (const s of dungeon.enemy_spawns) for (let i = 0; i < s.weight; i++) spawnPool.push(s.enemy);
    if (spawnPool.length === 0) return this._result([], ctx.agilityLevel);

    const maxHp = ctx.hitpoints * 10;
    let currentHp = maxHp;

    const foodSupply = { ...ctx.food };
    const foodOrder = Object.keys(ctx.food)
      .filter(k => GameData.foodHeals[k] != null)
      .sort((a, b) => GameData.foodHeals[b] - GameData.foodHeals[a]);
    let totalFoodEaten = 0;

    const arrowTiers = ctx.arrows ? Object.entries(ctx.arrows) : [];
    let arrowIdx = 0;
    let arrowsLeft = arrowTiers[0] ? arrowTiers[0][1] : (ctx.style === 'ranged' ? 0 : Infinity);
    let runesLeft = ctx.runes != null ? ctx.runes : Infinity;

    const frames = [];
    let carryoverKey = null, carryoverHp = 0, enemyClock = 0;

    for (let minute = 1; minute <= 60; minute++) {
      const frameItems = {}, frameXpBySkill = {}, frameFood = {}, frameArrows = {};
      let frameXp = 0, frameRunesUsed = 0;

      const enemyKey = carryoverKey || spawnPool[Math.floor(Math.random() * spawnPool.length)];
      carryoverKey = null;
      const enemy = enemies[enemyKey];
      if (!enemy) continue;

      let playerMaxHit, playerEffAtk, enemyDefStat;
      if (ctx.style === 'ranged') {
        playerMaxHit = this._rangedMaxHit(effRanged, ctx.rangedStrBonus, 0);
        playerEffAtk = effRanged + ctx.weaponAtkBonus;
        enemyDefStat = enemy.defensive_stats.ranged_defense;
      } else if (ctx.style === 'magic') {
        playerMaxHit = Math.max(1, ctx.spellMaxHit);
        playerEffAtk = effMagic + ctx.weaponAtkBonus;
        enemyDefStat = enemy.defensive_stats.magic_defense;
      } else {
        const effStr = effStrength + ctx.weaponStrBonus;
        playerMaxHit = Math.max(1, Math.floor(1 + effStr * (ctx.weaponStrBonus + 64) / 640));
        playerEffAtk = effAttack + ctx.weaponAtkBonus;
        enemyDefStat = ctx.style === 'strength' ? enemy.defensive_stats.strength_defense : enemy.defensive_stats.attack_defense;
      }

      const playerHitChance = Util.clamp(
        playerEffAtk > enemyDefStat
          ? 1 - enemyDefStat / (2 * Math.max(1, playerEffAtk))
          : playerEffAtk / (2 * Math.max(1, enemyDefStat)), 0.15, 0.95);

      const enemyEffStr = enemy.combat_stats.strength_level + enemy.combat_stats.strength_bonus;
      const enemyMaxHit = enemyEffStr === 0 ? 0 : Math.max(0, Math.floor(1 + enemyEffStr * (enemy.combat_stats.strength_bonus + 64) / 640));
      const enemyEffAtk = enemy.combat_stats.attack_level + enemy.combat_stats.attack_bonus;
      const enemyHitChance = Util.clamp(
        enemyEffAtk > effDefence
          ? 1 - effDefence / (2 * Math.max(1, enemyEffAtk))
          : enemyEffAtk / (2 * Math.max(1, effDefence)), 0.10, 0.95);

      const savedCarry = carryoverHp; carryoverHp = 0;
      let enemyHp = savedCarry > 0 ? savedCarry : enemy.hp;
      let kills = 0;
      const pHits = [], eHits = [], pHeals = [];

      for (let tick = 0; tick < ticksPerFrame; tick++) {
        let pDmg = 0;
        if (ctx.style === 'ranged') {
          while (arrowsLeft === 0 && arrowIdx + 1 < arrowTiers.length) {
            arrowIdx++; arrowsLeft = arrowTiers[arrowIdx][1];
          }
          if (arrowsLeft > 0) {
            const key = arrowTiers[arrowIdx][0];
            arrowsLeft--;
            frameArrows[key] = (frameArrows[key] || 0) + 1;
            playerMaxHit = this._rangedMaxHit(effRanged, ctx.rangedStrBonus, GameData.arrowBonuses[key] || 0);
            if (Math.random() < playerHitChance) pDmg = Util.randInt(0, playerMaxHit);
          }
        } else if (ctx.style === 'magic') {
          if (runesLeft >= ctx.runeCost) {
            if (ctx.runeKey) { runesLeft -= ctx.runeCost; frameRunesUsed++; }
            if (Math.random() < playerHitChance) pDmg = Util.randInt(0, playerMaxHit);
          }
        } else {
          if (Math.random() < playerHitChance) pDmg = Util.randInt(0, playerMaxHit);
        }

        pHits.push(pDmg);
        enemyHp -= pDmg;
        if (enemyHp <= 0) {
          kills++;
          for (const d of (enemy.always_drops || [])) frameItems[d.item] = (frameItems[d.item] || 0) + (d.quantity || 1);
          for (const d of (enemy.drop_table || [])) {
            if (Math.random() < d.chance) {
              const q = d.quantity_min >= d.quantity_max ? d.quantity_min : Util.randInt(d.quantity_min, d.quantity_max);
              frameItems[d.item] = (frameItems[d.item] || 0) + q;
            }
          }
          const baseXp = enemy.xp_drops.combat || 0;
          const xp = ctx.petBoostPct ? Math.floor(baseXp * (1 + ctx.petBoostPct / 100)) : baseXp;
          for (const [skill, sxp] of Object.entries(this._distributeXp(xp, ctx.style)))
            frameXpBySkill[skill] = (frameXpBySkill[skill] || 0) + sxp;
          frameXp += xp;
          enemyHp = enemy.hp;
        }

        enemyClock += speed;
        let eDmg = 0;
        while (enemyClock >= this.BASE_ATTACK_SPEED_SEC - 1e-9) {
          enemyClock -= this.BASE_ATTACK_SPEED_SEC;
          if (Math.random() < enemyHitChance) eDmg += Util.randInt(0, enemyMaxHit);
        }
        eHits.push(eDmg);
        currentHp -= eDmg;

        if (currentHp <= 0 && !dungeon.safe_zone) { pHeals.push(0); break; }

        const hpBeforeEating = currentHp;
        let ate = true;
        while (ate && totalFoodEaten < 300) {
          ate = false;
          const foodKey = foodOrder.find(k => (foodSupply[k] || 0) > 0);
          if (!foodKey) break;
          const heal = GameData.foodHeals[foodKey];
          if (currentHp <= enemyMaxHit || currentHp <= maxHp * eatFraction) {
            currentHp = Math.min(maxHp, currentHp + heal);
            foodSupply[foodKey]--;
            frameFood[foodKey] = (frameFood[foodKey] || 0) + 1;
            totalFoodEaten++;
            ate = true;
          }
        }
        pHeals.push(currentHp - hpBeforeEating);
      }

      const freshlyKilled = kills > 0 && enemyHp === enemy.hp;
      carryoverKey = enemyHp > 0 && !freshlyKilled ? enemyKey : null;
      carryoverHp = enemyHp > 0 && !freshlyKilled ? enemyHp : 0;

      if (dungeon.safe_zone) currentHp = Math.max(1, currentHp);
      const died = currentHp <= 0;

      frames.push({
        minute, xpGain: frameXp, xpBySkill: frameXpBySkill, items: frameItems,
        kills, killsByEnemy: kills > 0 ? { [enemyKey]: kills } : {},
        died, foodConsumed: frameFood, arrowsConsumed: frameArrows,
        runesConsumed: ctx.runeKey && frameRunesUsed > 0 ? { [ctx.runeKey]: frameRunesUsed * ctx.runeCost } : {},
        enemyKey, hpAfter: Math.max(0, currentHp), maxHp,
        playerHits: pHits, enemyHits: eHits, playerHeals: pHeals,
      });
      if (died) break;
    }

    // Dungeon rare drops: rolled once per completed run
    const last = frames[frames.length - 1];
    if (last && !last.died && dungeon.rare_drops && dungeon.rare_drops.length) {
      for (const rare of dungeon.rare_drops)
        if (Math.random() < rare.chance) last.items[rare.item] = (last.items[rare.item] || 0) + 1;
    }

    return this._result(frames, ctx.agilityLevel);
  },

  _rangedMaxHit(effRanged, gearBonus, arrowBonus) {
    const str = gearBonus + arrowBonus;
    const eff = effRanged + str;
    return Math.max(1, Math.floor(1 + eff * (str + 64) / 640));
  },

  _distributeXp(totalXp, style) {
    const hp = Math.floor(totalXp * 0.15);
    const def = Math.floor(totalXp * 0.15);
    const main = totalXp - hp - def;
    const mainSkill = { strength: 'strength', ranged: 'ranged', magic: 'magic', defense: 'defense' }[style] || 'attack';
    return { [mainSkill]: main, hitpoints: hp, defense: def };
  },

  /** Port of CombatSimulator.estimateSurvival for dungeon difficulty badges. */
  estimateSurvival(dungeon, defense, hitpoints, totalFoodHeal) {
    if (!dungeon.enemy_spawns || dungeon.enemy_spawns.length === 0) return 'LIKELY';
    const pool = (defense || 0) + hitpoints * 10 + totalFoodHeal;
    const totalWeight = dungeon.enemy_spawns.reduce((s, x) => s + x.weight, 0) || 1;
    let weightedDPM = 0;
    for (const spawn of dungeon.enemy_spawns) {
      const enemy = GameData.enemies[spawn.enemy];
      if (!enemy) continue;
      const weight = spawn.weight / totalWeight;
      const effStr = enemy.combat_stats.strength_level + enemy.combat_stats.strength_bonus;
      const maxHit = effStr === 0 ? 0 : Math.max(0, Math.floor(1 + effStr * (enemy.combat_stats.strength_bonus + 64) / 640));
      const effAtk = enemy.combat_stats.attack_level + enemy.combat_stats.attack_bonus;
      const hit = Util.clamp(
        effAtk > defense ? 1 - defense / (2 * Math.max(1, effAtk)) : effAtk / (2 * Math.max(1, defense)), 0.10, 0.95);
      weightedDPM += weight * ((maxHit / 2) * hit / this.BASE_ATTACK_SPEED_SEC * 60);
    }
    const ratio = pool / Math.max(1, weightedDPM * 60);
    return ratio >= 1.2 ? 'LIKELY' : ratio >= 0.6 ? 'RISKY' : 'UNLIKELY';
  },

  /* -------------------------- Mercantile routes ------------------------- */

  /**
   * Port of MercantileSimulator: a 60-frame caravan run. One coin total is
   * rolled from the route's coin range × 60 and split across the frames; each
   * frame rolls XP from the route's XP range for the starting level.
   */
  simulateMercantile(route, startXp, opts) {
    const level = this.levelForXp(startXp);
    const xpRange = Util.tierFor(route.xp_ranges, level);
    const coinRange = Util.tierFor(route.coin_ranges, level);
    let currentXp = startXp;
    const frames = [];
    const totalCoins = Util.randInt(coinRange.min * 60, coinRange.max * 60);
    const baseShare = Math.floor(totalCoins / 60);
    const remainder = totalCoins % 60;

    for (let minute = 1; minute <= 60; minute++) {
      const xpBefore = currentXp;
      const levelBefore = this.levelForXp(currentXp);
      const xpGain = Util.randInt(xpRange.min, xpRange.max);
      currentXp += xpGain;
      const levelAfter = this.levelForXp(currentXp);
      const coinReturn = baseShare + (minute <= remainder ? 1 : 0);
      const items = { coins: coinReturn };
      this._petRoll(items, opts.petDrop);
      frames.push(this._frame(minute, xpBefore, currentXp, levelBefore, levelAfter, items, xpGain));
    }
    return this._result(frames, opts.agilityLevel);
  },

  /* ------------------------ Skilling dungeons ------------------------ */

  /**
   * Port of SkillingDungeonSimulator: like gathering, but XP and the drop
   * table come from the expedition's tiered ranges, and each frame rolls a
   * lore note (`note_<key>`) handled at collect time.
   */
  simulateSkillingDungeon(dungeonKey, dungeon, startXp, opts) {
    const eff = opts.toolEfficiency || 1;
    const petBoost = opts.petBoostPct || 0;
    let currentXp = startXp;
    const frames = [];
    const noteKey = 'note_' + dungeonKey;

    for (let minute = 1; minute <= 60; minute++) {
      const xpBefore = currentXp;
      const levelBefore = this.levelForXp(currentXp);
      const xpRange = Util.tierFor(dungeon.xp_ranges, levelBefore);
      const baseXp = Math.floor(Util.randInt(xpRange.min, xpRange.max) * eff);
      const xpGain = petBoost > 0 ? Math.floor(baseXp * (1 + petBoost / 100)) : baseXp;
      currentXp += xpGain;
      const levelAfter = this.levelForXp(currentXp);

      const dropTable = dungeon.drop_tables && Object.keys(dungeon.drop_tables).length
        ? Util.tierFor(dungeon.drop_tables, levelBefore) : [];
      const items = {};
      for (const entry of dropTable)
        if (Math.random() < entry.chance) items[entry.item] = (items[entry.item] || 0) + 1;
      if (Math.random() < (dungeon.note_chance_per_frame || 0))
        items[noteKey] = (items[noteKey] || 0) + 1;
      this._petRoll(items, opts.petDrop);

      frames.push(this._frame(minute, xpBefore, currentXp, levelBefore, levelAfter, items, xpGain));
    }
    return this._result(frames, opts.agilityLevel);
  },

  /* ----------------------------- Raid bosses ----------------------------- */

  /**
   * Port of CombatSimulator.simulateBoss: a single fight vs one big HP pool.
   * The fight runs for at most `duration_minutes` frames; if neither side is
   * dead by then a DPS-comparison fallback decides the winner. Win/lose loot
   * and XP rewards are attached to the final frame.
   */
  simulateBoss(boss, bossKey, ctx) {
    const speed = Util.clamp(ctx.attackSpeedSec || this.BASE_ATTACK_SPEED_SEC, 1.2, this.BASE_ATTACK_SPEED_SEC);
    const ticksPerFrame = Math.round(60 / speed);
    const eatFraction = 0.5;

    const effAttack = ctx.attack + (ctx.potions?.attack || 0);
    const effStrength = ctx.strength + (ctx.potions?.strength || 0);
    const effDefence = ctx.defense + (ctx.potions?.defense || 0) + (ctx.blessingDefBonus || 0);
    const effRanged = ctx.ranged + (ctx.potions?.ranged || 0);
    const effMagic = ctx.magic + (ctx.potions?.magic || 0);

    let playerMax, effAtk, bossDefence;
    if (ctx.style === 'ranged') {
      playerMax = this._rangedMaxHit(effRanged, ctx.rangedStrBonus, 0);
      effAtk = effRanged + ctx.weaponAtkBonus;
      bossDefence = boss.defensive_stats.ranged_defense;
    } else if (ctx.style === 'magic') {
      playerMax = Math.max(1, ctx.spellMaxHit);
      effAtk = effMagic + ctx.weaponAtkBonus;
      bossDefence = boss.defensive_stats.magic_defense;
    } else {
      const effStr = effStrength + ctx.weaponStrBonus;
      playerMax = Math.max(1, Math.floor(1 + effStr * (ctx.weaponStrBonus + 64) / 640));
      effAtk = effAttack + ctx.weaponAtkBonus;
      bossDefence = ctx.style === 'strength' ? boss.defensive_stats.strength_defense : boss.defensive_stats.attack_defense;
    }

    const playerHitChance = Util.clamp(
      effAtk > bossDefence ? 1 - bossDefence / (2 * Math.max(1, effAtk)) : effAtk / (2 * Math.max(1, bossDefence)),
      0.10, 0.95);

    const bossEffStr = boss.combat_stats.strength_level + boss.combat_stats.strength_bonus;
    const bossMax = bossEffStr === 0 ? 0 : Math.max(0, Math.floor(1 + bossEffStr * (boss.combat_stats.strength_bonus + 64) / 640));
    const bossEffAtk = boss.combat_stats.attack_level + boss.combat_stats.attack_bonus;
    const bossHitChance = Util.clamp(
      bossEffAtk > effDefence ? 1 - effDefence / (2 * Math.max(1, bossEffAtk)) : bossEffAtk / (2 * Math.max(1, effDefence)),
      0.10, 0.95);

    const maxHp = ctx.hitpoints * 10;
    let currentHp = maxHp;
    let currentBossHp = boss.hp;
    const maxFrames = boss.duration_minutes;
    const frames = [];
    let won = false;

    const foodSupply = { ...ctx.food };
    const foodOrder = Object.keys(ctx.food)
      .filter(k => GameData.foodHeals[k] != null)
      .sort((a, b) => GameData.foodHeals[b] - GameData.foodHeals[a]);
    let totalFoodEaten = 0;

    const arrowTiers = ctx.arrows ? Object.entries(ctx.arrows) : [];
    let arrowIdx = 0;
    let arrowsLeft = arrowTiers[0] ? arrowTiers[0][1] : (ctx.style === 'ranged' ? 0 : Infinity);
    let runesLeft = ctx.runes != null ? ctx.runes : Infinity;
    let bossClock = 0;

    outer:
    while (frames.length < maxFrames) {
      const pHits = [], eHits = [], pHeals = [];
      const frameFood = {}, frameArrows = {};
      let frameRunesUsed = 0;

      for (let tick = 0; tick < ticksPerFrame; tick++) {
        let pDmg = 0;
        if (ctx.style === 'ranged') {
          while (arrowsLeft === 0 && arrowIdx + 1 < arrowTiers.length) {
            arrowIdx++; arrowsLeft = arrowTiers[arrowIdx][1];
          }
          if (arrowsLeft > 0) {
            const key = arrowTiers[arrowIdx][0];
            arrowsLeft--;
            frameArrows[key] = (frameArrows[key] || 0) + 1;
            playerMax = this._rangedMaxHit(effRanged, ctx.rangedStrBonus, GameData.arrowBonuses[key] || 0);
            if (Math.random() < playerHitChance) pDmg = Util.randInt(0, playerMax);
          }
        } else if (ctx.style === 'magic') {
          if (runesLeft >= ctx.runeCost) {
            if (ctx.runeKey) { runesLeft -= ctx.runeCost; frameRunesUsed++; }
            if (Math.random() < playerHitChance) pDmg = Util.randInt(0, playerMax);
          }
        } else {
          if (Math.random() < playerHitChance) pDmg = Util.randInt(0, playerMax);
        }

        currentBossHp -= pDmg;
        pHits.push(pDmg);
        if (currentBossHp <= 0) {
          won = true;
          frames.push(this._bossFrame(frames.length, bossKey, pHits, eHits, pHeals, currentHp, maxHp,
            frameFood, frameArrows, ctx.runeKey, frameRunesUsed, ctx.runeCost, 1));
          break outer;
        }

        bossClock += speed;
        let bDmg = 0;
        while (bossClock >= this.BASE_ATTACK_SPEED_SEC - 1e-9) {
          bossClock -= this.BASE_ATTACK_SPEED_SEC;
          if (Math.random() < bossHitChance) bDmg += Util.randInt(0, bossMax);
        }
        currentHp = Math.max(0, currentHp - bDmg);
        eHits.push(bDmg);

        // Death is checked before eating (food can't revive a 0-HP player)
        if (currentHp <= 0) {
          pHeals.push(0);
          frames.push(this._bossFrame(frames.length, bossKey, pHits, eHits, pHeals, 0, maxHp,
            frameFood, frameArrows, ctx.runeKey, frameRunesUsed, ctx.runeCost, 0));
          break outer;
        }

        const hpBeforeEating = currentHp;
        let ate = true;
        while (ate && totalFoodEaten < 300) {
          ate = false;
          const foodKey = foodOrder.find(k => (foodSupply[k] || 0) > 0);
          if (!foodKey) break;
          const heal = GameData.foodHeals[foodKey];
          if (currentHp <= bossMax || currentHp <= maxHp * eatFraction) {
            currentHp = Math.min(maxHp, currentHp + heal);
            foodSupply[foodKey]--;
            frameFood[foodKey] = (frameFood[foodKey] || 0) + 1;
            totalFoodEaten++;
            ate = true;
          }
        }
        pHeals.push(currentHp - hpBeforeEating);
      }

      if (frames.length < maxFrames && currentHp > 0 && currentBossHp > 0) {
        frames.push(this._bossFrame(frames.length, bossKey, pHits, eHits, pHeals, currentHp, maxHp,
          frameFood, frameArrows, ctx.runeKey, frameRunesUsed, ctx.runeCost, 0));
      }
    }

    // DPS fallback when the frame cap is hit with neither side dead
    if (frames.length === 0 || (frames[frames.length - 1].kills === 0 && currentBossHp > 0 && currentHp > 0)) {
      const playerDps = (playerMax / 2) * playerHitChance / speed;
      const bossDps = (bossMax / 2) * bossHitChance / this.BASE_ATTACK_SPEED_SEC;
      won = playerDps > 0 && bossDps > 0
        ? (boss.hp / playerDps) <= (maxHp / bossDps)
        : playerDps >= bossDps;
      const stub = this._bossFrame(frames.length, bossKey, [], [], [], won ? 1 : 0, maxHp, {}, {}, null, 0, 1, won ? 1 : 0);
      if (frames.length === 0) frames.push(stub); else frames[frames.length - 1] = stub;
    }

    // Attach loot + XP rewards to the final frame (win: full; loss: 10% XP, no loot)
    const items = {};
    const xpBySkill = {};
    if (won) {
      items.coins = Util.randInt(boss.common_loot.coins_min, boss.common_loot.coins_max);
      for (const [item, range] of Object.entries(boss.common_loot.items || {}))
        items[item] = range.min >= range.max ? range.min : Util.randInt(range.min, range.max);
      for (const rare of (boss.rare_drops || []))
        if (Math.random() < rare.chance) items[rare.item] = (items[rare.item] || 0) + 1;
      if (boss.pet && Math.random() < boss.pet.chance) items[boss.pet.id] = 1;
      for (const [skill, xp] of Object.entries(boss.xp_rewards || {})) xpBySkill[skill] = xp;
    } else {
      for (const [skill, xp] of Object.entries(boss.xp_rewards || {})) xpBySkill[skill] = Math.max(1, Math.floor(xp * 0.1));
    }
    const last = frames[frames.length - 1];
    const totalXp = Object.values(xpBySkill).reduce((a, b) => a + b, 0);
    last.xpGain = totalXp;
    last.items = items;
    last.xpBySkill = xpBySkill;
    last.killsByEnemy = won ? { [bossKey]: 1 } : {};
    last.combatStyle = ctx.style;
    return frames;
  },

  _bossFrame(minute, bossKey, pHits, eHits, pHeals, hpAfter, maxHp, frameFood, frameArrows, runeKey, frameRunesUsed, runeCost, kills) {
    return {
      minute, xpGain: 0, xpBefore: 0, xpAfter: 0, levelBefore: 0, levelAfter: 0,
      kills, killsByEnemy: {}, died: hpAfter <= 0,
      enemyKey: bossKey, playerHits: pHits, enemyHits: eHits, playerHeals: pHeals,
      hpAfter, maxHp, items: {}, xpBySkill: {},
      foodConsumed: frameFood, arrowsConsumed: frameArrows,
      runesConsumed: runeKey && frameRunesUsed > 0 ? { [runeKey]: frameRunesUsed * runeCost } : {},
    };
  },

  /* ----------------------------- Carnival ----------------------------- */

  /** Port of CarnivalSimulator: ticket drop per frame + small skill XP. */
  simulateCarnival(activityKey, relevantSkillLevel, petBoostPct, agilityLevel, tierBonus) {
    const chance = Math.min(1, 0.15 + Util.clamp(relevantSkillLevel - 1, 0, 98) * (0.20 / 98) + (tierBonus || 0));
    const baseXp = { archery_range: 10, strongman_competition: 8, wizards_duel: 12, fishing_derby: 9 }[activityKey] || 8;
    const skillKey = { archery_range: 'ranged', strongman_competition: 'strength', wizards_duel: 'magic', fishing_derby: 'fishing' }[activityKey] || 'ranged';
    const frames = [];
    for (let minute = 1; minute <= 60; minute++) {
      const tickets = Math.random() < chance ? 1 : 0;
      const xpGain = Math.floor(baseXp * (1 + (petBoostPct || 0) / 100));
      frames.push({
        minute, xpGain, xpBefore: 0, xpAfter: 0, levelBefore: relevantSkillLevel, levelAfter: relevantSkillLevel,
        items: tickets > 0 ? { carnival_ticket: tickets } : {},
        leveledUp: false, kills: 0, died: false,
        xpBySkill: { [skillKey]: xpGain },
      });
    }
    return this._result(frames, agilityLevel);
  },

  /* ----------------------------- Tower ----------------------------- */

  TOWER_TIERS: [
    { max: 20, spawns: [['goblin', 40], ['skeleton', 30], ['zombie', 30]] },
    { max: 40, spawns: [['orc_warrior', 40], ['dark_wizard', 30], ['bandit', 30]] },
    { max: 60, spawns: [['cave_troll', 35], ['shadow_beast', 35], ['demon', 30]] },
    { max: 80, spawns: [['forge_demon', 35], ['shadow_assassin', 35], ['abyssal_leech', 30]] },
    { max: 100, spawns: [['void_stalker', 35], ['void_guardian', 35], ['abyssal_lord', 30]] },
    { max: Infinity, spawns: [['void_archon', 35], ['eternal_sentinel', 35], ['abyssal_lord', 30]] },
  ],

  TOWER_MILESTONES: [
    { floor: 10, type: 'item', item: 'tower_ring' },
    { floor: 20, type: 'xp', amount: 1 },
    { floor: 30, type: 'coins', amount: 5000 },
    { floor: 40, type: 'item', item: 'tower_shield' },
    { floor: 50, type: 'item', item: 'tower_amulet' },
    { floor: 60, type: 'hp', amount: 5 },
    { floor: 70, type: 'xp', amount: 2 },
    { floor: 80, type: 'coins', amount: 25000 },
    { floor: 90, type: 'item', item: 'tower_helm' },
    { floor: 100, type: 'pet', item: 'tower_pet' },
    { floor: 110, type: 'coinDrops', amount: 1 },
    { floor: 120, type: 'item', item: 'tower_body' },
    { floor: 130, type: 'xp', amount: 2 },
    { floor: 140, type: 'coins', amount: 100000 },
    { floor: 150, type: 'items', items: ['tower_legs', 'tower_boots', 'tower_plateskirt'] },
    { floor: 160, type: 'hp', amount: 5 },
    { floor: 170, type: 'coinDrops', amount: 1 },
    { floor: 180, type: 'item', item: 'tower_sword' },
    { floor: 190, type: 'xp', amount: 2 },
    { floor: 200, type: 'item', item: 'tower_cape', coins: 500000 },
    { floor: 210, type: 'hp', amount: 5 },
    { floor: 220, type: 'item', item: 'tower_crossbow' },
    { floor: 230, type: 'coinDrops', amount: 1 },
    { floor: 240, type: 'xp', amount: 2 },
    { floor: 250, type: 'item', item: 'void_staff', coins: 1000000 },
  ],

  towerTierSpawns(floor) {
    for (const t of this.TOWER_TIERS) if (floor <= t.max) return t.spawns;
    return this.TOWER_TIERS[this.TOWER_TIERS.length - 1].spawns;
  },

  /** DungeonData-shaped object for a tower floor. */
  buildTowerFloor(floor) {
    return {
      name: 'tower_floor_' + floor,
      display_name: 'Tower Floor ' + floor,
      description: 'Endless gauntlet — floor ' + floor,
      recommended_level: Math.min(200, floor * 2),
      encounter_rate: 0.65,
      enemy_spawns: this.towerTierSpawns(floor).map(([enemy, weight]) => ({ enemy, weight })),
    };
  },

  /** Enemies scaled beyond floor 100: HP toward 10x, stats toward +30% at floor 250. */
  scaledTowerEnemies(floor) {
    const progress = floor <= 100 ? 0 : (Util.clamp(floor, 101, 250) - 100) / 150;
    const hpMult = 1 + progress * 9;
    const statMult = 1 + progress * 0.3;
    const relevant = new Set(this.towerTierSpawns(floor).map(x => x[0]));
    const out = {};
    for (const [key, e] of Object.entries(GameData.enemies)) {
      if (!relevant.has(key)) { out[key] = e; continue; }
      out[key] = {
        ...e,
        hp: Math.max(1, Math.floor(e.hp * hpMult)),
        combat_stats: {
          ...e.combat_stats,
          attack_bonus: Math.floor(e.combat_stats.attack_bonus * statMult),
          strength_bonus: Math.floor(e.combat_stats.strength_bonus * statMult),
        },
        defensive_stats: {
          ...e.defensive_stats,
          attack_defense: Math.floor(e.defensive_stats.attack_defense * statMult),
          strength_defense: Math.floor(e.defensive_stats.strength_defense * statMult),
          ranged_defense: Math.floor(e.defensive_stats.ranged_defense * statMult),
          magic_defense: Math.floor(e.defensive_stats.magic_defense * statMult),
        },
      };
    }
    return out;
  },

  /* ---------------------------- shared ---------------------------- */

  _frame(minute, xpBefore, xpAfter, levelBefore, levelAfter, items, xpGain) {
    return {
      minute, xpGain, xpBefore, xpAfter, levelBefore, levelAfter,
      items, leveledUp: levelAfter > levelBefore, kills: 0, died: false,
    };
  },

  _result(frames, agilityLevel) {
    return { frames, durationMs: this.sessionDurationMs(agilityLevel || 1) };
  },
};

/* Export for Node-based tests (no-op in the browser) */
if (typeof module !== "undefined" && module.exports) module.exports = { Sim };
