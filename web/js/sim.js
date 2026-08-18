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

  /** Agility bonus: sessions scale from 60 min at lvl 1 to 40 min at lvl 99. */
  sessionDurationMs(agilityLevel) {
    const fraction = Util.clamp(agilityLevel - 1, 0, 98) / 98;
    const maxReduction = 20.0;
    const minutes = 60.0 - maxReduction * fraction;
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
  simulateCraft(startXp, qty, xpPerItem, outputQty, outputKey, eff) {
    const frameCount = Math.min(qty, 60);
    const frames = [];
    let xp = startXp;
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
  simulateDungeon(dungeon, ctx) {
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
      const enemy = GameData.enemies[enemyKey];
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
          const xp = enemy.xp_drops.combat || 0;
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
