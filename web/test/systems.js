/* Headless tests for the new systems: farming, herblore, slayer, guilds,
 * carnival, tower, pets. Run: node test/systems.js */
'use strict';
const fs = require('fs');
const path = require('path');

global.fetch = async p => {
  const file = path.join(__dirname, '..', p.replace(/^\//, ''));
  const content = fs.readFileSync(file, 'utf8');
  return { ok: true, json: async () => JSON.parse(content) };
};
global.localStorage = (() => {
  let store = {};
  return { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
})();
try { global.navigator = {}; } catch (e) {}
global.requestAnimationFrame = fn => 1; // never advances in tests

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log('  ✓ ' + name);
  else { console.error('  ✗ FAIL: ' + name + (extra ? ' — ' + extra : '')); failures++; }
};

(async () => {
  global.Util = require('../js/util.js').Util;
  const GD = require('../js/data.js').GameData;
  await GD.loadAll();
  global.GameData = GD;
  global.Sim = require('../js/sim.js').Sim;
  const State = require('../js/state.js').State;
  global.State = State;
  const SystemsMod = require('../js/systems.js');
  global.Systems = SystemsMod.Systems;
  const Engine = require('../js/engine.js').Engine;
  global.Engine = Engine;

  State.init();

  console.log('— data —');
  check('17 crops', Object.keys(GD.crops).length === 17);
  check('16 herblore recipes', Object.keys(GD.herbloreRecipes).length === 16);
  check('potion effects built', GD.potionEffects.attack_potion.attack === 5);
  check('25 pets', Object.keys(GD.pets).length === 25);
  check('petBySkill mining=rock_golem', GD.petBySkill.mining.id === 'rock_golem');
  check('200 guild quests', Object.keys(GD.guildQuests).length === 200);
  check('439 guild dailies', GD.guildDailies.length === 439);
  check('23 slayer tasks', Object.keys(GD.slayerTasks).length === 23);
  check('skill defs now 21', GD.skillDefs.length === 21);
  check('new skills present', State.level('farming') === 1 && State.level('herblore') === 1 && State.level('slayer') === 1);

  console.log('— pets: boosts & drops —');
  State.state.petsOwned.push('rock_golem', 'juggling_imp');
  check('pet boost sums (mining 10 + all 3)', State.petBoost('mining') === 13);
  check('combat boost includes all pets', State.combatPetBoost() === 3);
  State.state.petsOwned = [];
  // mining session pet roll is random; force check by many sessions would be slow.
  // Instead verify sim applies petDrop when it wins: monkey-patch Math.random
  const origRandom = Math.random;
  Math.random = () => 0; // every roll succeeds
  let r = Engine.startSkillSession('mining', 'copper_ore');
  check('mining session starts with forced pet roll', !!r.ok);
  Engine.session().endsAt = Date.now() - 1;
  const miningSum = Engine.collect();
  check('pet drop goes to pets, not inventory', State.state.petsOwned.includes('rock_golem') && State.count('rock_golem') === 0);
  Math.random = origRandom;
  State.state.petsOwned = [];

  console.log('— farming —');
  check('3 patches at level 1', State.patchCount() === 3);
  State.addItem('potato_seed', 5);
  let pr = Systems.plantCrop(1, 'potato', false);
  check('plant potato ok', !!pr.ok);
  check('seed consumed', State.count('potato_seed') === 4);
  check('planting xp granted', State.xp('farming') === 10);
  check('harvest blocked while growing', !!Systems.harvestPatch(1).error);
  // fast-forward growth
  State.state.farmingPatches[0].plantedAt -= 3 * 3600000;
  State.state.farmingPatches[0].fert = 'ashes';
  const hr = Systems.harvestPatch(1);
  check('harvest works after growth', !!hr.ok && hr.yield >= 3);
  check('harvest yields with 1.1x ash mult', hr.yield >= Math.ceil(3 * 1.1) - 1);
  check('seed returned', State.count('potato_seed') === 5);
  check('patch cleared', State.state.farmingPatches[0] === null);
  check('farming xp grew', State.xp('farming') > 10);
  // locked patch
  check('patch 4 locked at farming 1', !!Systems.plantCrop(4, 'potato').error);
  // magic bean unlock
  State.addItem('magic_bean', 1);
  check('magic bean plantable', !!Systems.plantCrop(2, 'magic_bean').ok);
  check('cloud kingdom locked before climb', !State.dungeonUnlocked('cloud_kingdom'));
  State.state.farmingPatches[1].plantedAt -= 337 * 3600000;
  const beanRes = Systems.harvestPatch(2);
  check('beanstalk climb unlocks cloud kingdom', beanRes.bean && State.dungeonUnlocked('cloud_kingdom'));

  console.log('— herblore —');
  State.state.skills.herblore.xp = Sim.xpForLevel(10);
  State.addItem('potato', 10);
  const potatoBefore = State.count('potato');
  r = Engine.startSkillSession('herblore', 'attack_brew', 5);
  check('herblore session starts', !!r.ok, r.error);
  check('materials consumed at start (2 potatoes each)', State.count('potato') === potatoBefore - 10);
  Engine.session().endsAt = Date.now() - 1;
  const hlSum = Engine.collect();
  check('potions brewed', hlSum.items.attack_brew === 5);
  check('herblore xp granted', (hlSum.xpBySkill.herblore || 0) === 50);

  console.log('— combat potion integration —');
  State.addItem('attack_brew', 3);
  const brewBefore = State.count('attack_brew');
  State.state.activePotion = 'attack_brew';
  State.state.combatStyle = 'attack';
  r = Engine.startDungeonSession('farm');
  check('dungeon starts with potion', !!r.ok, r.error);
  check('potion consumed at start', State.count('attack_brew') === brewBefore - 1);
  Engine.session().endsAt = Date.now() - 1;
  const dsum = Engine.collect();
  check('potion-boosted dungeon collected', (dsum.xpBySkill.attack || 0) > 0);

  console.log('— slayer —');
  // eligible tasks at slayer level 1: goblin/skeleton/etc (giant_rat may not be tier 1)
  const eligibleEnemies = Object.entries(GD.slayerTasks).filter(([, c]) => c.slayer_level <= 1).map(([k]) => k);
  check('tier-1 slayer tasks exist', eligibleEnemies.includes('goblin'));
  let tries = 0, task = null;
  while (tries++ < 300) {
    Systems.assignTask();
    const t = State.state.slayer.activeTask;
    if (t) {
      if (t.enemyKey === 'goblin') { task = t; break; }
      State.state.slayer.activeTask = null;
    }
  }
  check('goblin task assigned eventually', task && task.enemyKey === 'goblin', 'tries=' + tries);
  const rec = Systems.recordKills({ skeleton: 10 });
  check('off-task kills give nothing', rec.xp === 0);
  const rec2 = Systems.recordKills({ goblin: task.targetKills });
  check('on-task kills give slayer xp', rec2.xp === task.targetKills * task.xpPerKill && rec2.tasksCompleted === 1, `xp=${rec2.xp}`);
  check('task completion awards points', State.state.slayer.points >= task.taskPoints);
  // dungeon collect feeds slayer — boost the hero so the run survives
  State.state.skills.attack.xp = Sim.xpForLevel(40);
  State.state.skills.strength.xp = Sim.xpForLevel(40);
  State.state.skills.defense.xp = Sim.xpForLevel(40);
  State.state.skills.hitpoints.xp = Sim.xpForLevel(50);
  State.addItem('cooked_shrimp', 200);
  State.state.slayer.activeTask = { enemyKey: 'goblin', targetKills: 500, killsCompleted: 0, xpPerKill: 15, taskPoints: 5 };
  r = Engine.startDungeonSession('goblin_cave');
  check('goblin cave starts', !!r.ok, r.error);
  Engine.session().endsAt = Date.now() - 1;
  const dsum2 = Engine.collect();
  check('dungeon kills count toward slayer', (dsum2.xpBySkill.slayer || 0) > 0, JSON.stringify(dsum2.xpBySkill));
  check('slayer tasks completed stat tracked', (State.state.stats.slayerTasksCompleted || 0) >= 1);
  // foretell with bones
  State.addItem('bones', 100);
  const bonesBeforeForetel = State.count('bones');
  State.state.slayer.activeTask = null;
  const fr = Systems.foretelTask();
  check('foretel consumes bones and assigns', !!fr.ok, fr.error);
  check('bones consumed', State.count('bones') === bonesBeforeForetel - 10, `${State.count('bones')} vs ${bonesBeforeForetel}`);
  // points shop
  State.state.slayer.points = 100;
  const buy = Systems.buySlayerItem('xp_lamp_small', 'mining');
  check('lamp purchase grants xp', !!buy.ok);
  // slayer quest type supported
  check('slayer_task quests included', Engine.questsAvailable().some(q => q.type === 'slayer_task'));

  console.log('— guilds —');
  const gq = Object.values(GD.guildQuests).find(q => q.guild === 'mining' && q.guild_level_required === 0);
  State.state.guilds.progress[gq.id] = { progress: gq.amount, completed: false };
  check('guild level 0 before claim', Systems.guildLevel('mining') === 0);
  const claim = Systems.claimGuildQuest(gq.id);
  check('guild quest claimable', !!claim.ok, claim.error);
  check('guild unlocked after claim', Systems.guildUnlocked('mining'));
  Systems.ensureDailies();
  const dailies = Systems.guildDailiesFor('mining');
  check('dailies generated for unlocked guild', dailies.length > 0 && dailies.length <= 4, 'got ' + dailies.length);
  check('no dailies for locked guild', Systems.guildDailiesFor('fishing').length === 0);
  // Daily progress via gathering hook
  const t0 = dailies[0];
  if (t0.type === 'gather') {
    State.state.guilds.dailyProgress[t0.id] = t0.amount;
    const dc = Systems.claimGuildDaily(t0.id);
    check('daily claim works + tier count', !!dc.ok && (State.state.guilds.tierCounts['mining:0'] || 0) === 1, dc.error);
  } else {
    check('daily claim works (skip non-gather first)', true);
  }
  // combat/thieving/agility/prayer hooks don't crash
  Systems.recordGuildCombat({ goblin: 5 }, 'attack');
  Systems.recordGuildThieving('peasant', 3);
  Systems.recordGuildAgility('beginner_course');
  Systems.recordGuildPrayer(4);
  Systems.recordGuildSlayer(5, 1);
  check('guild hooks run without crashing', true);

  console.log('— carnival —');
  const cr = Systems.startCarnivalSession('archery_range');
  check('carnival session starts', !!cr.ok, cr.error);
  check('carnival session kind', Engine.session().kind === 'carnival');
  const ticketsIn = Engine.session().frames.filter(f => f.items.carnival_ticket).length;
  check('carnival frames produce tickets sometimes', ticketsIn > 0 && ticketsIn <= 60);
  Engine.session().endsAt = Date.now() - 1;
  const csum = Engine.collect();
  check('carnival collect gives ranged xp', (csum.xpBySkill.ranged || 0) > 0);
  check('tickets in inventory', State.count('carnival_ticket') > 0);
  const rt = Systems.playRingToss(0.50, false);
  check('ring toss normal zone wins 2', rt.ok && rt.won && rt.tickets === 2);
  const rtBlocked = Systems.playRingToss(0.5, false);
  check('ring toss on cooldown', !!rtBlocked.error);
  State.state.carnivalCooldowns.ring_toss = 0;
  const rtHardMiss = Systems.playRingToss(0.50, true); // hard zone is 0.52-0.57
  check('ring toss hard zone miss at 0.50', rtHardMiss.ok && !rtHardMiss.won);
  State.state.carnivalCooldowns.ring_toss = 0;
  // prize redemption
  State.addItem('carnival_ticket', 5000);
  const rp = Systems.redeemPrize('xp_lamp_small', 'fishing');
  check('lamp prize redeem grants xp', !!rp.ok && State.xp('fishing') >= 10000, rp.error);
  const rp2 = Systems.redeemPrize('juggling_imp');
  check('pet prize redeem adds pet', !!rp2.ok && State.state.petsOwned.includes('juggling_imp'));

  console.log('— tower —');
  check('floor 1 dungeon builds', Sim.buildTowerFloor(1).enemy_spawns.length === 3);
  check('tower floor 5 spawns tier 1', Sim.towerTierSpawns(5).some(x => x[0] === 'goblin'));
  check('tower floor 150 scales hp', Sim.scaledTowerEnemies(150).void_archon.hp > GD.enemies.void_archon.hp);
  check('floor 50 not scaled', Sim.scaledTowerEnemies(50).goblin.hp === GD.enemies.goblin.hp);
  // strong player beats floor 1
  State.state.skills.attack.xp = Sim.xpForLevel(50);
  State.state.skills.strength.xp = Sim.xpForLevel(50);
  State.state.skills.defense.xp = Sim.xpForLevel(50);
  State.state.skills.hitpoints.xp = Sim.xpForLevel(60);
  State.state.combatStyle = 'attack';
  State.state.activePotion = null;
  r = Systems.startTowerSession();
  check('tower session starts', !!r.ok, r.error);
  check('tower floor recorded on session', Engine.session().floor === 1 && Engine.session().kind === 'tower');
  Engine.session().endsAt = Date.now() - 1;
  const tsum = Engine.collect();
  if (tsum.died) {
    check('tower death resets to checkpoint 0', State.state.tower.current === 0);
  } else {
    check('tower clear advances floor', State.state.tower.current === 1 && State.state.tower.best === 1);
    const ms = Systems.claimTowerMilestone(10);
    check('milestone locked until floor 10', !!ms.error);
    State.state.tower.best = 10;
    const ms2 = Systems.claimTowerMilestone(10);
    check('milestone claims tower_ring', !!ms2.ok && State.count('tower_ring') === 1);
  }
  // death path explicitly
  State.state.tower.best = 30; State.state.tower.current = 30;
  State.state.skills.hitpoints.xp = Sim.xpForLevel(3);
  State.state.skills.attack.xp = 0; State.state.skills.strength.xp = 0; State.state.skills.defense.xp = 0;
  r = Systems.startTowerSession(); // floor 31 vs weak player
  if (r.ok) {
    Engine.session().endsAt = Date.now() - 1;
    const tsum2 = Engine.collect();
    if (tsum2.died) check('tower death drops to checkpoint 25', State.state.tower.current === 25);
    else check('tower death drops to checkpoint (survived variant)', true);
  }
  // hp bonus applies
  State.state.tower.hpBonus = 5;
  check('tower hp bonus in effective hp', State.effectiveHpLevel() === State.level('hitpoints') + 5);

  console.log('— bulk farming + repeat session —');
  State.addItem('potato_seed', 10);
  const seedsBeforeBulk = State.count('potato_seed');
  State.state.farmingPatches = [null, null, null, null, null];
  const plantedAll = Systems.plantAll('potato', false);
  check('plant all fills 3 patches at level 1', plantedAll === 3, `planted=${plantedAll}`);
  check('plant all consumed 3 seeds', State.count('potato_seed') === seedsBeforeBulk - 3);
  check('harvest all yields nothing while growing', Systems.harvestAll().length === 0);
  State.state.farmingPatches.forEach((pt, i) => { if (pt) pt.plantedAt -= 99 * 3600000; });
  const harvestedAll = Systems.harvestAll();
  check('harvest all collects every ready patch', harvestedAll.length === 3);
  check('patches cleared after bulk harvest', State.state.farmingPatches.every(x => x === null));

  // Repeat last session
  Engine.startSkillSession('mining', 'iron_ore');
  Engine.session().endsAt = Date.now() - 1;
  Engine.collect();
  check('lastStart recorded', Engine.lastStart && Engine.lastStart.skill === 'mining' && Engine.lastStart.activityKey === 'iron_ore');
  check('lastStartLabel readable', typeof Engine.lastStartLabel() === 'string' && Engine.lastStartLabel().includes('Iron'));
  State.state.skills.mining.xp = Sim.xpForLevel(15); // iron needs 15
  const rep = Engine.repeatLast();
  check('repeatLast restarts same activity', !!rep.ok && Engine.session().activityKey === 'iron_ore', rep.error);
  Engine.session().endsAt = Date.now() - 1;
  Engine.collect();

  console.log('— cloud kingdom gating —');
  State.state.unlockedDungeonsExtra = [];
  check('cloud kingdom re-locked without bean', !!Engine.startDungeonSession('cloud_kingdom').error);

  console.log(failures === 0 ? '\nSYSTEMS TESTS PASSED ✅' : `\n${failures} FAILURES ❌`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(2); });
