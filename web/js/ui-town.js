/* ------------------------------------------------------------------ *
 * ui-town.js — Town screen (Slayer, Guilds, Carnival, Infinite Tower),
 * farming patches UI, herblore recipes, and the pets collection card.
 * Loaded after ui.js; extends the UI object.
 * ------------------------------------------------------------------ */
'use strict';

(() => {
  const T = () => Util.el('div', 'card-sub');

  UI.townView = 'slayer'; // slayer | guilds | carnival | tower
  UI.guildView = 'mining';
  UI.townRngPosition = 0.5;
  UI.ringTossPlaying = false;
  UI.ringTossHard = false;
  UI.ringTossAnim = null;

  /* ================================================================ *
   *  TOWN screen
   * ================================================================ */

  UI.renderTown = function () {
    Systems.ensureDailies();
    const wrap = Util.el('div');

    const nav = Util.el('div', 'style-row');
    nav.style.marginBottom = '12px';
    const tabs = [
      { key: 'slayer', label: '🗡️ Slayer Master' },
      { key: 'guilds', label: '🏛️ Guild Hall' },
      { key: 'carnival', label: '🎡 Carnival' },
      { key: 'tower', label: '🗼 Infinite Tower' },
    ];
    for (const t of tabs) {
      const b = Util.el('button', 'style-btn' + (this.townView === t.key ? ' active' : ''), t.label);
      b.onclick = () => { this.townView = t.key; this.render(); };
      nav.appendChild(b);
    }
    wrap.appendChild(nav);

    switch (this.townView) {
      case 'slayer': wrap.appendChild(this._renderSlayer()); break;
      case 'guilds': wrap.appendChild(this._renderGuilds()); break;
      case 'carnival': wrap.appendChild(this._renderCarnival()); break;
      case 'tower': wrap.appendChild(this._renderTower()); break;
    }
    return wrap;
  };

  /* ------------------------------ Slayer ------------------------------ */

  UI._renderSlayer = function () {
    const wrap = Util.el('div');
    const st = State.state.slayer;
    const lvl = State.level('slayer');

    const card = Util.el('div', 'card');
    card.appendChild(Util.el('h2', null, `🗡️ Slayer Master <span class="tag blue">Slayer ${lvl}</span>`));
    card.appendChild(Util.el('p', 'card-sub', 'Take a task, then kill that enemy in any dungeon. On-task kills earn Slayer XP; completed tasks earn Slayer points for the shop below.'));

    // Active task
    if (st.activeTask) {
      const task = st.activeTask;
      const enemy = GameData.enemies[task.enemyKey];
      const pct = Util.clamp((task.killsCompleted / task.targetKills) * 100, 0, 100);
      const taskBox = Util.el('div', 'row quest-row complete');
      taskBox.innerHTML = `
        <div class="row-icon">💀</div>
        <div class="row-main">
          <div class="row-name">Task: slay ${enemy?.display_name || Util.prettify(task.enemyKey)}</div>
          <div class="row-sub">${task.killsCompleted} / ${task.targetKills} killed · ${task.xpPerKill} Slayer XP per kill · ${task.taskPoints} points on completion</div>
          <div class="qbar"><div style="width:${pct}%"></div></div>
        </div>`;
      card.appendChild(taskBox);
    } else {
      card.appendChild(Util.el('div', 'empty-note', 'No active task. Ask the Slayer Master for one!'));
    }

    const actions = Util.el('div', 'row-actions');
    actions.style.marginTop = '10px';
    actions.style.justifyContent = 'flex-start';
    const btnNew = Util.el('button', 'btn small', st.activeTask ? 'Task active' : 'Request task');
    btnNew.disabled = !!st.activeTask;
    btnNew.onclick = () => {
      const r = Systems.assignTask();
      if (r.error) this.toast(r.error, 'error'); else this.toast(`New task: slay ${GameData.enemies[r.task.enemyKey]?.display_name}!`, 'success');
      this.render();
    };
    actions.appendChild(btnNew);

    const btnForetel = Util.el('button', 'btn small secondary', `Foretell next (${[10, 25, 50][st.foretelled.length] ?? 50} bone units)`);
    btnForetel.disabled = st.foretelled.length >= 3;
    btnForetel.title = 'Queue a specific upcoming task by paying bones (1 unit = 10 bone XP)';
    btnForetel.onclick = () => {
      const r = Systems.foretelTask();
      if (r.error) this.toast(r.error, 'error'); else this.toast(`Foretold: ${GameData.enemies[r.task.enemyKey]?.display_name} (${r.task.targetKills} kills)`, 'success');
      this.render();
    };
    actions.appendChild(btnForetel);

    const btnSkip = Util.el('button', 'btn small secondary', `Skip (30 pts)`);
    btnSkip.disabled = !st.activeTask;
    btnSkip.onclick = () => {
      const r = Systems.skipTask();
      if (r.error) this.toast(r.error, 'error'); else this.toast('Task skipped — new task assigned.');
      this.render();
    };
    actions.appendChild(btnSkip);
    card.appendChild(actions);

    // Foretell queue
    if (st.foretelled.length) {
      const q = T();
      q.style.marginTop = '8px';
      q.innerHTML = '<b>Foretold queue:</b> ' + st.foretelled.map(t =>
        `${GameData.enemies[t.enemyKey]?.display_name || t.enemyKey} (${t.killsCompleted}/${t.targetKills})`).join(' → ');
      card.appendChild(q);
    }

    // Bone info
    const bones = T();
    bones.style.marginTop = '8px';
    const boneCounts = ['bones', 'big_bones', 'giant_bones', 'dragon_bone'].map(k => `${Util.fmt(State.count(k))}× ${GameData.name(k)}`).join(', ');
    bones.innerHTML = `🦴 Bone bank: ${boneCounts} (total ${Systems.totalBoneXp()} bone XP)`;
    card.appendChild(bones);

    // Points + shop
    const shopCard = Util.el('div', 'card');
    shopCard.appendChild(Util.el('h2', null, `🛒 Slayer Shop <span class="tag gold">${st.points} points</span>`));
    const list = Util.el('div', 'row-list');
    for (const entry of Systems.SLAYER_SHOP) {
      const eq = GameData.equipment[entry.key];
      const row = Util.el('div', 'row');
      const label = entry.name || GameData.name(entry.key);
      const sub = entry.xp
        ? `Grants ${Util.fmt(entry.xp)} XP to a skill of your choice`
        : (eq ? Object.entries({ 'attack_bonus': 'atk', 'strength_bonus': 'str', 'defense_bonus': 'def', 'ranged_attack_bonus': 'rng atk', 'magic_attack_bonus': 'mag atk' }).filter(([f]) => eq[f]).map(([f, n]) => `+${eq[f]} ${n}`).join(' · ') : '');
      row.innerHTML = `
        <div class="row-icon">${entry.xp ? '🏮' : '🔧'}</div>
        <div class="row-main">
          <div class="row-name">${Util.esc(label)}</div>
          <div class="row-sub">${sub}</div>
        </div>`;
      const btn = Util.el('button', 'btn small', `${entry.cost} pts`);
      btn.disabled = st.points < entry.cost;
      btn.onclick = () => {
        if (entry.xp) {
          this._pickSkill(skill => {
            const r = Systems.buySlayerItem(entry.key, skill);
            if (r.error) this.toast(r.error, 'error'); else this.toast(`Lamp used: +${Util.fmt(entry.xp)} ${Util.prettify(skill)} XP`, 'success');
            this.render();
          });
        } else {
          const r = Systems.buySlayerItem(entry.key);
          if (r.error) this.toast(r.error, 'error'); else this.toast(`Bought ${label}!`, 'success');
          this.render();
        }
      };
      const act = Util.el('div', 'row-actions');
      act.appendChild(btn);
      row.appendChild(act);
      list.appendChild(row);
    }
    shopCard.appendChild(list);

    wrap.appendChild(card);
    wrap.appendChild(shopCard);
    return wrap;
  };

  /** Modal: pick a skill for an XP lamp. */
  UI._pickSkill = function (onPick) {
    const options = GameData.skillDefs.map(d =>
      `<option value="${d.key}">${d.icon} ${d.name} (${State.level(d.key)})</option>`).join('');
    this.modal(`
      <h2>🏮 Choose a skill</h2>
      <p class="card-sub">The lamp's XP will be granted to the selected skill.</p>
      <select class="fancy" style="width:100%">${options}</select>
      <div class="modal-actions">
        <button class="btn secondary" data-act="cancel">Cancel</button>
        <button class="btn" data-act="ok">Use lamp</button>
      </div>`, m => {
        m.querySelector('[data-act=cancel]').onclick = () => this.closeModal();
        m.querySelector('[data-act=ok]').onclick = () => {
          const skill = m.querySelector('select').value;
          this.closeModal();
          onPick(skill);
        };
      });
  };

  /* ------------------------------ Guilds ------------------------------ */

  UI._renderGuilds = function () {
    const wrap = Util.el('div');

    // Guild grid
    const gridCard = Util.el('div', 'card');
    gridCard.appendChild(Util.el('h2', null, '🏛️ Guild Hall'));
    gridCard.appendChild(Util.el('p', 'card-sub', '20 guilds cover every skill. Advance by completing progression quests (tracked automatically) and claiming daily requests. Rank 10 awards the guild cape.'));
    const grid = Util.el('div', 'skills-grid');
    for (const guild of Systems.GUILDS) {
      const unlocked = Systems.guildUnlocked(guild);
      const level = Systems.guildLevel(guild);
      const tile = Util.el('div', 'skill-tile' + (unlocked ? '' : ' locked'));
      tile.style.opacity = unlocked ? 1 : 0.55;
      tile.innerHTML = `<div class="sk-emoji">${Systems.GUILD_ICONS[guild] || '🏛️'}</div>
        <div class="sk-name">${Util.prettify(guild)}</div>
        <div class="sk-level">${unlocked ? 'Rank ' + level : '🔒'}</div>`;
      tile.onclick = () => { this.guildView = guild; this.townView = 'guilds'; this.render(); };
      grid.appendChild(tile);
    }
    gridCard.appendChild(grid);
    wrap.appendChild(gridCard);

    // Selected guild detail
    const guild = this.guildView;
    const level = Systems.guildLevel(guild);
    const g = State.state.guilds;
    const detail = Util.el('div', 'card');
    detail.appendChild(Util.el('h2', null, `${Systems.GUILD_ICONS[guild] || '🏛️'} ${Util.prettify(guild)} Guild <span class="tag blue">Rank ${level}</span>`));

    if (!Systems.guildUnlocked(guild)) {
      detail.appendChild(Util.el('div', 'empty-note', 'This guild has no activity yet — complete the first progression quest below to join and unlock daily requests. Quest progress is tracked automatically as you play.'));
    }

    // Tier progress
    const tierNeed = Systems.DAILIES_PER_TIER[level];
    if (tierNeed != null) {
      const done = g.tierCounts[guild + ':' + level] || 0;
      const tierSub = T();
      tierSub.innerHTML = `Next rank: finish this rank's quests <b>and</b> claim <b>${done}/${tierNeed}</b> daily requests.`;
      detail.appendChild(tierSub);
    } else {
      const done = T();
      done.innerHTML = '🏆 Maximum rank reached!';
      detail.appendChild(done);
    }

    // Progression quests (current tier first, then locked tiers)
    const qList = Util.el('div', 'row-list');
    const quests = Systems._guildQuests(guild);
    const completed = Systems._completedQuestIds();
    for (const q of quests) {
      const row = g.progress[q.id];
      const prog = row?.progress || 0;
      const claimed = completed.has(q.id);
      const gated = q.guild_level_required > level;
      const pct = Util.clamp((prog / q.amount) * 100, 0, 100);
      const el = Util.el('div', 'row quest-row' + (claimed ? ' claimed' : '') + (prog >= q.amount && !claimed ? ' complete' : ''));
      const rw = q.rewards || {};
      el.innerHTML = `
        <div class="row-icon">${claimed ? '✅' : gated ? '🔒' : prog >= q.amount ? '🎁' : '📜'}</div>
        <div class="row-main">
          <div class="row-name">${Util.esc(q.name)} ${gated && !claimed ? `<span class="tag">rank ${q.guild_level_required}</span>` : ''}</div>
          <div class="row-sub">${Util.esc(q.description)} · ${rw.coins ? Util.fmt(rw.coins) + ' 🪙 ' : ''}${rw.xp ? Util.fmt(rw.xp) + ' ' + Util.prettify(rw.xp_skill || guild) + ' XP ' : ''}${Object.entries(rw.items || {}).map(([k, v]) => `${v}× ${GameData.name(k)}`).join(', ')}</div>
          <div class="qbar"><div style="width:${pct}%"></div></div>
          <div class="row-sub">${Util.fmt(Math.min(prog, q.amount))} / ${Util.fmt(q.amount)}</div>
        </div>`;
      const btn = Util.el('button', 'btn small' + (!claimed && prog >= q.amount ? ' success' : ' secondary'), 'Claim');
      btn.disabled = claimed || prog < q.amount;
      btn.onclick = () => {
        const r = Systems.claimGuildQuest(q.id);
        if (r.error) this.toast(r.error, 'error'); else this.toast(`Quest claimed: ${q.name}!`, 'success');
        this.render();
      };
      const act = Util.el('div', 'row-actions');
      act.appendChild(btn);
      el.appendChild(act);
      qList.appendChild(el);
    }
    detail.appendChild(qList);

    // Daily requests
    const dailyCard = Util.el('div', 'card');
    dailyCard.appendChild(Util.el('h2', null, '📝 Daily Requests'));
    const dailies = Systems.guildDailiesFor(guild);
    if (!dailies.length) {
      dailyCard.appendChild(Util.el('div', 'empty-note', 'No daily requests — join the guild by claiming its first progression quest. New requests appear every morning.'));
    }
    const dList = Util.el('div', 'row-list');
    for (const t of dailies) {
      const prog = g.dailyProgress[t.id] || 0;
      const claimed = g.dailyClaimed.includes(t.id);
      const pct = Util.clamp((prog / t.amount) * 100, 0, 100);
      const el = Util.el('div', 'row quest-row' + (claimed ? ' claimed' : '') + (prog >= t.amount && !claimed ? ' complete' : ''));
      const rw = t.rewards || {};
      el.innerHTML = `
        <div class="row-icon">${claimed ? '✅' : prog >= t.amount ? '🎁' : '📝'}</div>
        <div class="row-main">
          <div class="row-name">${Util.esc(t.name)}</div>
          <div class="row-sub">${Util.esc(t.description)} · ${rw.coins ? Util.fmt(rw.coins) + ' 🪙 ' : ''}${rw.xp ? Util.fmt(rw.xp) + ' ' + Util.prettify(rw.xp_skill || guild) + ' XP ' : ''}${Object.entries(rw.items || {}).map(([k, v]) => `${v}× ${GameData.name(k)}`).join(', ')}</div>
          <div class="qbar"><div style="width:${pct}%"></div></div>
          <div class="row-sub">${Util.fmt(Math.min(prog, t.amount))} / ${Util.fmt(t.amount)}</div>
        </div>`;
      const btn = Util.el('button', 'btn small' + (!claimed && prog >= t.amount ? ' success' : ' secondary'), 'Claim');
      btn.disabled = claimed || prog < t.amount;
      btn.onclick = () => {
        const r = Systems.claimGuildDaily(t.id);
        if (r.error) this.toast(r.error, 'error'); else this.toast('Daily reward claimed!', 'success');
        this.render();
      };
      const act = Util.el('div', 'row-actions');
      act.appendChild(btn);
      el.appendChild(act);
      dList.appendChild(el);
    }
    dailyCard.appendChild(dList);

    wrap.appendChild(detail);
    wrap.appendChild(dailyCard);
    return wrap;
  };

  /* ------------------------------ Carnival ------------------------------ */

  UI._renderCarnival = function () {
    const wrap = Util.el('div');
    const tickets = Systems.ticketBalance();

    const card = Util.el('div', 'card');
    card.appendChild(Util.el('h2', null, `🎡 Carnival <span class="tag gold">🎟️ ${Util.fmt(tickets)} tickets</span>`));
    card.appendChild(Util.el('p', 'card-sub', 'Idle minigames convert your skill levels into tickets over a full session. Spend tickets in the prize shop below.'));

    const list = Util.el('div', 'row-list');
    for (const game of Systems.CARNIVAL_GAMES) {
      const lvl = State.level(game.skill);
      const chance = 0.15 + Util.clamp(lvl - 1, 0, 98) * (0.20 / 98) + Systems.carnivalTierBonus();
      const est = Math.floor(60 * Math.min(1, chance));
      const row = Util.el('div', 'row');
      row.innerHTML = `
        <div class="row-icon">${game.icon}</div>
        <div class="row-main">
          <div class="row-name">${game.name} <span class="tag blue">${Util.prettify(game.skill)} ${lvl}</span></div>
          <div class="row-sub">~${est} tickets per session · trains ${Util.prettify(game.skill)} slowly</div>
        </div>`;
      const btn = Util.el('button', 'btn small', 'Play');
      btn.disabled = Engine.hasSession();
      btn.onclick = () => this._tryStart(() => Systems.startCarnivalSession(game.key));
      const act = Util.el('div', 'row-actions');
      act.appendChild(btn);
      row.appendChild(act);
      list.appendChild(row);
    }
    card.appendChild(list);
    wrap.appendChild(card);

    // Ring toss
    const ringCard = Util.el('div', 'card');
    ringCard.appendChild(Util.el('h2', null, '🎯 Ring Toss'));
    ringCard.appendChild(Util.el('p', 'card-sub', 'Time your throw — land the marker inside the bottle zone. Normal: 2 tickets · Hard: 7 tickets. 10-minute cooldown.'));
    const cd = (State.state.carnivalCooldowns.ring_toss || 0) - Date.now();
    const zone = this.ringTossHard ? [52, 57] : [45, 55];
    const ringBox = Util.el('div');
    ringBox.id = 'ring-toss-box';
    ringBox.style.position = 'relative';
    ringBox.style.height = '54px';
    ringBox.style.background = 'var(--bg-3)';
    ringBox.style.border = '1px solid var(--border)';
    ringBox.style.borderRadius = '10px';
    ringBox.style.overflow = 'hidden';
    ringBox.style.margin = '10px 0';
    const zoneEl = Util.el('div');
    zoneEl.style.position = 'absolute';
    zoneEl.style.top = '0'; zoneEl.style.bottom = '0';
    zoneEl.style.left = zone[0] + '%'; zoneEl.style.width = (zone[1] - zone[0]) + '%';
    zoneEl.style.background = 'linear-gradient(180deg, rgba(110,231,160,.35), rgba(110,231,160,.15))';
    zoneEl.style.border = '1px dashed var(--green)';
    zoneEl.innerHTML = '<div style="text-align:center;font-size:10px;color:var(--green)">🍾</div>';
    ringBox.appendChild(zoneEl);
    const marker = Util.el('div');
    marker.id = 'ring-toss-marker';
    marker.style.position = 'absolute';
    marker.style.top = '0'; marker.style.bottom = '0';
    marker.style.width = '4px';
    marker.style.background = 'var(--gold)';
    marker.style.left = '0%';
    ringBox.appendChild(marker);
    ringCard.appendChild(ringBox);

    const ringActions = Util.el('div', 'row-actions');
    ringActions.style.justifyContent = 'flex-start';
    const diffBtn = Util.el('button', 'btn small secondary', this.ringTossHard ? 'Difficulty: HARD' : 'Difficulty: Normal');
    diffBtn.onclick = () => { this.ringTossHard = !this.ringTossHard; this.render(); };
    ringActions.appendChild(diffBtn);
    const throwBtn = Util.el('button', 'btn small', cd > 0 ? `Cooldown ${Util.fmtTime(cd)}` : 'Throw!');
    throwBtn.id = 'ring-toss-btn';
    throwBtn.disabled = cd > 0;
    throwBtn.onclick = () => this._throwRing(ringBox, marker);
    ringActions.appendChild(throwBtn);
    ringCard.appendChild(ringActions);
    wrap.appendChild(ringCard);

    // Prize shop
    const prizeCard = Util.el('div', 'card');
    prizeCard.appendChild(Util.el('h2', null, '🎁 Carnival Prizes'));
    const pList = Util.el('div', 'row-list');
    for (const prize of Object.values(GameData.carnivalPrizes)) {
      const row = Util.el('div', 'row');
      const owned = prize.type === 'pet' && State.state.petsOwned.includes(prize.key);
      row.innerHTML = `
        <div class="row-icon">${prize.type === 'pet' ? '🐾' : prize.type === 'xp_lamp' ? '🏮' : '🎁'}</div>
        <div class="row-main">
          <div class="row-name">${prize.display_name} ${owned ? '<span class="tag green">owned</span>' : ''}</div>
          <div class="row-sub">${prize.description}</div>
        </div>`;
      const btn = Util.el('button', 'btn small', `${prize.ticket_cost} 🎟️`);
      btn.disabled = tickets < prize.ticket_cost || owned;
      btn.onclick = () => {
        if (prize.type === 'xp_lamp') {
          this._pickSkill(skill => {
            const r = Systems.redeemPrize(prize.key, skill);
            if (r.error) this.toast(r.error, 'error'); else this.toast('Lamp redeemed!', 'success');
            this.render();
          });
        } else {
          const r = Systems.redeemPrize(prize.key);
          if (r.error) this.toast(r.error, 'error'); else this.toast(`${prize.display_name} redeemed!`, 'success');
          this.render();
        }
      };
      const act = Util.el('div', 'row-actions');
      act.appendChild(btn);
      row.appendChild(act);
      pList.appendChild(row);
    }
    prizeCard.appendChild(pList);
    wrap.appendChild(prizeCard);
    return wrap;
  };

  UI._throwRing = function (box, marker) {
    if (this.ringTossPlaying) return;
    this.ringTossPlaying = true;
    const btn = document.getElementById('ring-toss-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Tap to release!'; }

    let dir = 1, pos = 0;
    const step = () => {
      pos += dir * 1.8;
      if (pos >= 100) { pos = 100; dir = -1; }
      if (pos <= 0) { pos = 0; dir = 1; }
      marker.style.left = pos + '%';
      this.ringTossAnim = requestAnimationFrame(step);
    };
    this.ringTossAnim = requestAnimationFrame(step);

    const release = () => {
      if (!this.ringTossPlaying) return;
      this.ringTossPlaying = false;
      cancelAnimationFrame(this.ringTossAnim);
      const markerEl = document.getElementById('ring-toss-marker');
      const position = markerEl ? parseFloat(markerEl.style.left) / 100 : 0.5;
      const r = Systems.playRingToss(position, this.ringTossHard);
      if (r.error) this.toast(r.error, 'error');
      else this.toast(r.won ? `Ring landed! +${r.tickets} tickets 🎟️` : 'The ring bounced off…', r.won ? 'success' : 'error');
      this.render();
    };
    if (btn) btn.onclick = release;
    box.onclick = release;
  };

  UI.updateTownLive = function () {
    // Ring toss cooldown countdown
    const btn = document.getElementById('ring-toss-btn');
    if (btn && btn.dataset.cooldownAt) {
      const left = parseInt(btn.dataset.cooldownAt, 10) - Date.now();
      if (left > 0) btn.textContent = `Cooldown ${Util.fmtTime(left)}`;
    }
    // Farming patch timers
    const timers = document.querySelectorAll('[data-patch-timer]');
    timers.forEach(el => {
      const patch = State.state.farmingPatches[parseInt(el.dataset.patchTimer, 10) - 1];
      if (!patch) return;
      const left = Systems.patchTimeLeftMs(patch);
      el.textContent = left > 0 ? `🌱 ${Util.fmtTime(left)} left` : '✅ Ready to harvest!';
    });
  };

  /* ------------------------------ Tower ------------------------------ */

  UI._renderTower = function () {
    const wrap = Util.el('div');
    const t = State.state.tower;

    const card = Util.el('div', 'card');
    card.appendChild(Util.el('h2', null, `🗼 Infinite Tower <span class="tag blue">Floor ${t.current}</span> <span class="tag gold">Best ${t.best}</span>`));
    const floor = t.current + 1;
    const enemies = [...new Set(Sim.towerTierSpawns(floor).map(([k]) => GameData.enemies[k]?.display_name || k))].join(', ');
    const progress = floor <= 100 ? 0 : (Util.clamp(floor, 101, 250) - 100) / 150;
    card.appendChild(Util.el('p', 'card-sub',
      `Climb one floor per session. Next up — floor ${floor}: ${enemies}. ` +
      (progress > 0 ? `Beyond floor 100 enemies scale up to ~${Math.round((1 + progress * 9) * 10) / 10}× HP at floor 250.` : 'Every 10 floors unlocks a milestone reward.') +
      ` Bonuses: +${t.xpBonus}% XP · +${t.coinBonus}% coins · +${t.hpBonus * 10} max HP. Dying drops you to a checkpoint (every 25 floors of your best run).`));

    const btn = Util.el('button', 'btn full', Engine.hasSession() ? 'A session is already running' : `⚔️ Climb floor ${floor}`);
    btn.disabled = Engine.hasSession() || !!Engine.validateStyle(State.state.combatStyle);
    btn.style.maxWidth = '340px';
    btn.style.margin = '6px auto 0';
    btn.style.display = 'block';
    btn.onclick = () => this._tryStart(() => Systems.startTowerSession());
    card.appendChild(btn);
    wrap.appendChild(card);

    // Milestones
    const msCard = Util.el('div', 'card');
    msCard.appendChild(Util.el('h2', null, '🏆 Milestones'));
    const list = Util.el('div', 'row-list');
    for (const m of Sim.TOWER_MILESTONES) {
      const claimable = t.best >= m.floor && !t.claimed.includes(m.floor);
      const claimed = t.claimed.includes(m.floor);
      const descFn = {
        item: () => GameData.name(m.item),
        items: () => (m.items || []).map(k => GameData.name(k)).join(', '),
        pet: () => `${GameData.pets[m.item]?.display_name} pet`,
        coins: () => `${Util.fmt(m.amount)} coins`,
        xp: () => `+${m.amount}% XP (tower)`,
        hp: () => `+${m.amount * 10} max HP`,
        coinDrops: () => `+${m.amount}% coins (tower)`,
      };
      const desc = (descFn[m.type] ? descFn[m.type]() : '') + (m.coins ? ` + ${Util.fmt(m.coins)} coins` : '');
      const row = Util.el('div', 'row quest-row' + (claimed ? ' claimed' : ''));
      row.innerHTML = `
        <div class="row-icon">${claimed ? '✅' : claimable ? '🎁' : '🔒'}</div>
        <div class="row-main">
          <div class="row-name">Floor ${m.floor}</div>
          <div class="row-sub">${desc}</div>
        </div>`;
      const btn2 = Util.el('button', 'btn small' + (claimable ? ' success' : ' secondary'), claimable ? 'Claim' : 'Locked');
      btn2.disabled = !claimable;
      btn2.onclick = () => {
        const r = Systems.claimTowerMilestone(m.floor);
        if (r.error) this.toast(r.error, 'error'); else this.toast(`Milestone claimed: ${r.notes.join(', ')}`, 'success');
        this.render();
      };
      const act = Util.el('div', 'row-actions');
      act.appendChild(btn2);
      row.appendChild(act);
      list.appendChild(row);
    }
    msCard.appendChild(list);
    wrap.appendChild(msCard);
    return wrap;
  };

  /* ================================================================ *
   *  FARMING patches UI (Skills → Farming)
   * ================================================================ */

  UI.renderFarming = function () {
    const card = Util.el('div', 'card');
    const patchCount = State.patchCount();
    card.appendChild(Util.el('h2', null, `🌾 Farm <span class="tag blue">${patchCount} patches</span>`));
    card.appendChild(Util.el('p', 'card-sub', 'Crops grow in real time — plant, leave, come back. Buy seeds at the 🛒 Shop. Ashes from Firemaking work as fertilizer for bigger yields.'));

    // Plant-all crop picker state
    const grid = Util.el('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(240px, 1fr))';
    grid.style.gap = '8px';

    for (let i = 1; i <= 5; i++) {
      const patch = State.state.farmingPatches[i - 1];
      const box = Util.el('div', 'equip-slot' + (patch ? ' filled' : ''));
      box.style.minHeight = '108px';
      if (i > patchCount) {
        box.style.opacity = '.4';
        box.innerHTML = `<div class="slot-name">Patch ${i}</div><div class="slot-item">🔒 Farming ${i <= 4 ? 20 : 40}</div>`;
        grid.appendChild(box);
        continue;
      }
      if (!patch) {
        // Empty patch: crop select + plant button
        const cropOpts = Object.values(GameData.crops)
          .filter(c => c.id !== 'magic_bean')
          .map(c => {
            const lvlOk = State.level('farming') >= c.farming_level_required;
            const seeds = State.count(c.seed_name);
            return `<option value="${c.id}" ${(!lvlOk || seeds < 1) ? 'disabled' : ''}>${c.emoji} ${c.display_name} — ${seeds} seeds${!lvlOk ? ' (Farming ' + c.farming_level_required + ')' : ''}</option>`;
          }).join('');
        const beanOpt = State.count('magic_bean') > 0 ? `<option value="magic_bean">🫘 Magic Bean</option>` : '';
        box.innerHTML = `<div class="slot-name">Patch ${i} — empty</div>`;
        const sel = Util.el('select', 'fancy');
        sel.style.margin = '4px 0';
        sel.innerHTML = cropOpts + beanOpt;
        const row = Util.el('div');
        row.style.display = 'flex';
        row.style.gap = '6px';
        const plantBtn = Util.el('button', 'btn small', 'Plant');
        const fertBtn = Util.el('button', 'btn small secondary', '🌱 Fertilize');
        fertBtn.title = 'Use 1 ash as fertilizer for a bigger yield';
        let useFert = false;
        fertBtn.onclick = () => { useFert = !useFert; fertBtn.classList.toggle('active', useFert); fertBtn.style.borderColor = useFert ? 'var(--green)' : ''; };
        plantBtn.onclick = () => {
          const r = Systems.plantCrop(i, sel.value, useFert);
          if (r.error) this.toast(r.error, 'error'); else this.toast(`Planted ${GameData.crops[sel.value].display_name}!`, 'success');
          this.render();
        };
        row.appendChild(plantBtn); row.appendChild(fertBtn);
        box.appendChild(sel);
        box.appendChild(row);
      } else {
        const crop = GameData.crops[patch.crop];
        const ready = Systems.cropReady(patch);
        const left = Systems.patchTimeLeftMs(patch);
        const totalTime = crop.growth_time_hours * 3600000;
        const pct = Util.clamp(100 - (left / totalTime) * 100, 0, 100);
        const isBean = patch.crop === 'magic_bean';
        box.innerHTML = `
          <div class="slot-name">Patch ${i}</div>
          <div class="slot-item">${crop.emoji} ${crop.display_name}${patch.fert ? ' <span class="tag green">fertilized</span>' : ''}</div>
          <div data-patch-timer="${i}" style="font-size:12px;color:var(--muted)">${ready ? '✅ Ready!' : '🌱 ' + Util.fmtTime(left) + ' left'}</div>
          <div class="sk-xpbar" style="margin-top:6px"><div style="width:${pct}%;height:100%;background:var(--green)"></div></div>`;
        const btnRow = Util.el('div');
        btnRow.style.marginTop = '6px';
        const harvestBtn = Util.el('button', 'btn small' + (ready ? ' success' : ' secondary'), isBean ? (ready ? '🫘 Climb beanstalk' : 'Growing…') : (ready ? '🌾 Harvest' : 'Growing…'));
        harvestBtn.disabled = !ready;
        harvestBtn.onclick = () => {
          const r = Systems.harvestPatch(i);
          if (r.error) { this.toast(r.error, 'error'); return; }
          if (r.bean) this.toast('🫘 You climb the towering beanstalk…', 'success');
          else this.toast(`Harvested ${r.yield}× ${GameData.name(r.crop)} (+${Util.fmt(r.xp)} XP)`, 'success');
          this.render();
        };
        btnRow.appendChild(harvestBtn);
        box.appendChild(btnRow);
      }
      grid.appendChild(box);
    }
    card.appendChild(grid);
    return card;
  };

  /* ================================================================ *
   *  Herblore recipes (Skills → Herblore) — extends _skillActivityRows
   * ================================================================ */

  const _origSkillRows = UI._skillActivityRows.bind(UI);
  UI._skillActivityRows = function (skillKey, busy) {
    if (skillKey === 'herblore') {
      const rows = [];
      for (const [key, recipe] of Object.entries(GameData.herbloreRecipes)) {
        const lvl = State.level('herblore');
        const locked = lvl < recipe.level_required;
        let maxQty = 500;
        for (const [mat, need] of Object.entries(recipe.materials || {}))
          maxQty = Math.min(maxQty, Math.floor((State.count(mat) || 0) / need));
        const mats = Object.entries(recipe.materials || {})
          .map(([m, n]) => `<span class="${State.count(m) >= n ? 'mat-ok' : 'mat-missing'}">${n}× ${GameData.name(m)} (${Util.fmt(State.count(m))})</span>`)
          .join(' · ');
        const effects = Object.entries(recipe.effects || {}).map(([k, v]) => `+${v} ${k}`).join(', ');
        rows.push(this._startRow({
          icon: '🧪', name: recipe.display_name,
          sub: `${mats} · ${effects}` + (locked ? ` · 🔒 Herblore ${recipe.level_required}` : ''),
          locked: locked || maxQty < 1,
          lockedReason: locked ? `Requires Herblore ${recipe.level_required}` : 'Not enough materials — farm crops and fight monsters',
          extra: maxQty > 60 ? this._qtyPicker('hl_' + key, maxQty) : null,
          onStart: () => this._tryStart(() => Engine.startSkillSession('herblore', key, this.qtySelections['hl_' + key])),
        }));
      }
      return rows;
    }
    return _origSkillRows(skillKey, busy);
  };

  /* ================================================================ *
   *  Pets card (Character tab) — extends renderCharacter
   * ================================================================ */

  const _origRenderCharacter = UI.renderCharacter.bind(UI);
  UI.renderCharacter = function () {
    const wrap = _origRenderCharacter();
    const card = Util.el('div', 'card');
    card.appendChild(Util.el('h2', null, `🐾 Pets <span class="tag blue">${State.state.petsOwned.length}/${Object.keys(GameData.pets).length}</span>`));
    card.appendChild(Util.el('p', 'card-sub', 'Rare companions from training, raids, the Tower and the Carnival. Every pet you own passively boosts its skill\'s XP — they stack!'));
    if (!State.state.petsOwned.length) {
      card.appendChild(Util.el('div', 'empty-note', 'No pets yet. Rare drops from gathering and crafting sessions (≈6% per session), Tower floor 100, and Carnival prizes.'));
    } else {
      const grid = Util.el('div', 'skills-grid');
      for (const id of State.state.petsOwned) {
        const p = GameData.pets[id];
        if (!p) continue;
        const tile = Util.el('div', 'skill-tile');
        tile.title = p.source;
        tile.innerHTML = `<div class="sk-emoji">${p.emoji || '🐾'}</div><div class="sk-name">${p.display_name}</div><div class="sk-level" style="font-size:12px">+${p.boost_percent}% ${Util.prettify(p.boosted_skill)}</div>`;
        grid.appendChild(tile);
      }
      card.appendChild(grid);
    }
    wrap.appendChild(card);
    return wrap;
  };

})();

/* Export for Node-based tests (no-op in the browser) */
if (typeof module !== 'undefined' && module.exports) module.exports = { UITown: true };
