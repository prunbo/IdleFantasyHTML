/* ------------------------------------------------------------------ *
 * ui-town.js — Town screen (Slayer, Guilds, Carnival, Infinite Tower),
 * farming patches UI, herblore recipes, and the pets collection card.
 * Loaded after ui.js; extends the UI object.
 * ------------------------------------------------------------------ */
'use strict';

(() => {
  const T = () => Util.el('div', 'card-sub');
  // Localized string with English fallback (locales from the Android app)
  const tt = (key, args, fb) => (typeof I18n !== 'undefined' && I18n.has(key)) ? I18n.t(key, args) : fb;

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
      { key: 'slayer', label: '🗡️ ' + tt('slayer_title', null, 'Slayer Master') },
      { key: 'guilds', label: '🏛️ ' + tt('guild_hall_title', null, 'Guild Hall') },
      { key: 'church', label: '⛪ ' + tt('church_title', null, 'Church') },
      { key: 'inn', label: '🍺 ' + tt('inn_title', null, 'Inn') },
      { key: 'builder', label: '🏗️ ' + tt('builder_title', null, "Builder's Workshop") },
      { key: 'expeditions', label: '🧭 ' + tt('nav_expeditions', null, 'Expeditions') },
      { key: 'event', label: '🎉 ' + tt('seasonal_event_title', null, 'Event') },
      { key: 'carnival', label: '🎡 ' + tt('carnival_title', null, 'Carnival') },
      { key: 'tower', label: '🗼 ' + tt('tower_title', null, 'Infinite Tower') },
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
      case 'church': wrap.appendChild(this._renderChurch()); break;
      case 'inn': wrap.appendChild(this._renderInn()); break;
      case 'builder': wrap.appendChild(this._renderBuilder()); break;
      case 'expeditions': wrap.appendChild(this._renderExpeditions()); break;
      case 'event': wrap.appendChild(this._renderSeasonal()); break;
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
    if (cd > 0) throwBtn.dataset.cooldownAt = String(State.state.carnivalCooldowns.ring_toss || 0);
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
    // Ring toss cooldown countdown (live re-enable)
    const btn = document.getElementById('ring-toss-btn');
    if (btn && btn.dataset && btn.dataset.cooldownAt) {
      const left = parseInt(btn.dataset.cooldownAt, 10) - Date.now();
      if (left > 0) btn.textContent = `Cooldown ${Util.fmtTime(left)}`;
      else { btn.textContent = 'Throw!'; btn.disabled = false; delete btn.dataset.cooldownAt; }
    }
    // Farming patch timers
    const timers = document.querySelectorAll('[data-patch-timer]');
    timers.forEach(el => {
      const patch = State.state.farmingPatches[parseInt(el.dataset.patchTimer, 10) - 1];
      if (!patch) return;
      const left = Systems.patchTimeLeftMs(patch);
      el.textContent = left > 0 ? `🌱 ${Util.fmtTime(left)} left` : '✅ Ready to harvest!';
    });
    // Worker job countdowns + collect buttons
    document.querySelectorAll('[data-worker-timer]').forEach(el => {
      const slot = parseInt(el.dataset.workerTimer, 10);
      const sess = Systems.Inn.workerSession(slot);
      if (!sess) return;
      const left = sess.endsAt - Date.now();
      el.textContent = left > 0 ? Util.fmtTime(left) + ' left' : '✅ Job done';
    });
    // Seasonal minigame cooldown
    const mg = document.getElementById('seasonal-mg-cd');
    if (mg) {
      const left = (State.state.seasonal.minigameCooldownAt || 0) - Date.now();
      mg.textContent = left > 0 ? `⏳ cooldown ${Util.fmtTime(left)}` : '✅ ready';
    }
    // Blessing countdown
    const blessEl = document.getElementById('blessing-countdown');
    if (blessEl && State.state.church.blessingKey) {
      const left = State.state.church.blessingExpiresAt - Date.now();
      blessEl.textContent = left > 0 ? Util.fmtTime(left) + ' left' : 'expired';
    }
  };

  /* ------------------------------ Tower ------------------------------ */

  UI._renderTower = function () {
    const wrap = Util.el('div');
    const t = State.state.tower;

    const card = Util.el('div', 'card');
    const floor = t.current + 1;
    const enemies = [...new Set(Sim.towerTierSpawns(floor).map(([k]) => GameData.enemies[k]?.display_name || k))].join(', ');
    // Survival estimate badge (same math as the dungeon list)
    let ratingTag = '';
    try {
      const ctxT = State.combatContext();
      const foodHeal = Object.entries(ctxT.food).reduce((sm, [k, v]) => sm + (GameData.foodHeals[k] || 0) * v, 0);
      const rating = Sim.estimateSurvival(Sim.buildTowerFloor(floor), ctxT.defense, ctxT.hitpoints, foodHeal);
      ratingTag = `<span class="tag ${{ LIKELY: 'green', RISKY: 'orange', UNLIKELY: 'red' }[rating]}">${{ LIKELY: 'Likely survive', RISKY: 'Risky', UNLIKELY: 'Unlikely' }[rating]}</span>`;
    } catch (e) { /* non-fatal */ }
    card.appendChild(Util.el('h2', null, `🗼 Infinite Tower <span class="tag blue">Floor ${t.current}</span> <span class="tag gold">Best ${t.best}</span> ${ratingTag}`));
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

    // Bulk actions
    const bulkRow = Util.el('div');
    bulkRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px';
    const bulkSel = Util.el('select', 'fancy');
    bulkSel.innerHTML = Object.values(GameData.crops).filter(c => c.id !== 'magic_bean').map(c =>
      `<option value="${c.id}" ${State.level('farming') < c.farming_level_required ? 'disabled' : ''}>${c.emoji} ${c.display_name} (${Util.fmt(State.count(c.seed_name))} seeds)</option>`).join('');
    const plantAllBtn = Util.el('button', 'btn small', '🌱 Plant all patches');
    plantAllBtn.onclick = () => {
      const planted = Systems.plantAll(bulkSel.value, false);
      if (planted > 0) this.toast(`Planted ${planted}× ${GameData.crops[bulkSel.value].display_name}!`, 'success');
      else this.toast('No patches planted — check seeds and empty patches.', 'error');
      this.render();
    };
    const harvestAllBtn = Util.el('button', 'btn small success', '🌾 Harvest all ready');
    harvestAllBtn.onclick = () => {
      const results = Systems.harvestAll();
      if (!results.length) { this.toast('Nothing is ready to harvest.', 'error'); return; }
      const totalXp = results.reduce((a, r) => a + r.xp, 0);
      const byCrop = {};
      results.forEach(r => byCrop[r.crop] = (byCrop[r.crop] || 0) + r.yield);
      const desc = Object.entries(byCrop).map(([k, v]) => `${v}× ${GameData.name(k)}`).join(', ');
      this.toast(`Harvested ${desc} (+${Util.fmt(totalXp)} XP)`, 'success');
      this.render();
    };
    const seedShopBtn = Util.el('button', 'btn small secondary', '🛒 Buy seeds');
    seedShopBtn.onclick = () => { this.tab = 'shop'; this._setTab(); };
    bulkRow.appendChild(bulkSel);
    bulkRow.appendChild(plantAllBtn);
    bulkRow.appendChild(harvestAllBtn);
    bulkRow.appendChild(seedShopBtn);
    card.appendChild(bulkRow);

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

  /* ================================================================ *
   *  CHURCH
   * ================================================================ */

  UI._renderChurch = function () {
    const wrap = Util.el('div');
    const card = Util.el('div', 'card');
    const lvl = State.level('prayer');
    card.appendChild(Util.el('h2', null, `⛪ ${tt('church_title', null, 'Church')} <span class="tag blue">${tt('skill_prayer', null, 'Prayer')} ${lvl}</span>`));
    card.appendChild(Util.el('p', 'card-sub',
      'Blessings are paid for with bones (bigger bones count for more) and last ' +
      Util.fmtTime(State.blessingDurationMs()) + '. One blessing at a time — activating the same one again extends it.'));

    const active = State.activeBlessing();
    if (active) {
      const effect = active.type === 'XP' ? `×${active.mag.toFixed(2)} XP`
        : active.type === 'DEFENSE' ? `+${active.mag} Defense` : `+${Math.round(active.mag * 100)}% coins`;
      const box = Util.el('div', 'row quest-row complete');
      box.innerHTML = `
        <div class="row-icon">✨</div>
        <div class="row-main">
          <div class="row-name">${Util.esc(GameData.blessingName(active))} <span class="tag green">${effect}</span></div>
          <div class="row-sub"><span id="blessing-countdown">${Util.fmtTime(State.state.church.blessingExpiresAt - Date.now())} left</span></div>
        </div>
        <div class="row-actions"><button class="btn small secondary" data-act="deactivate">Deactivate</button></div>`;
      const deactBtn = box.querySelector('[data-act=deactivate]');
      if (deactBtn) deactBtn.onclick = () => {
        this.confirm('Deactivate blessing?', 'Are you sure? You will not get your bones back.', 'Deactivate', () => {
          Systems.Church.deactivate();
          this.toast('Blessing deactivated.');
          this.render();
        });
      };
      card.appendChild(box);
    } else {
      card.appendChild(Util.el('div', 'empty-note', 'No active blessing. A Defense blessing toughens dungeon runs; XP blessings speed every skill; Coin blessings fatten loot.'));
    }

    card.appendChild(Util.el('p', 'card-sub',
      `Bone bank: <b>${Util.fmt(State.totalBoneXp())} bone-XP</b> — ${State.count('bones') || 0}× bones · ${State.count('big_bones') || 0}× big · ${State.count('giant_bones') || 0}× giant · ${State.count('dragon_bone') || 0}× dragon`));

    for (const [label, type] of [['✨ ' + tt('church_section_xp', null, 'XP Blessings'), 'XP'], ['🛡️ ' + tt('church_section_defense', null, 'Defense Blessings'), 'DEFENSE'], ['🪙 ' + tt('church_section_coins', null, 'Coin Blessings'), 'COINS']]) {
      card.appendChild(Util.el('h3', 'skills-group-header', label));
      const list = Util.el('div', 'row-list');
      for (const b of GameData.BLESSINGS.filter(x => x.type === type)) {
        const locked = lvl < b.lvl;
        const isActive = active && active.key === b.key;
        const cost = Systems.Church.boneCostFor(b);
        const effect = type === 'XP' ? `×${b.mag.toFixed(2)} XP` : type === 'DEFENSE' ? `+${b.mag} Defense` : `+${Math.round(b.mag * 100)}% coins`;
        const row = Util.el('div', 'row' + (locked ? ' locked' : ''));
        row.innerHTML = `
          <div class="row-icon">${type === 'XP' ? '✨' : type === 'DEFENSE' ? '🛡️' : '🪙'}</div>
          <div class="row-main">
            <div class="row-name">${Util.esc(GameData.blessingName(b))} ${isActive ? '<span class="tag green">Active</span>' : ''}</div>
            <div class="row-sub">${effect} · ${Util.fmtTime(State.blessingDurationMs())}${locked ? ` · 🔒 Prayer ${b.lvl}` : ''}</div>
          </div>
          <div class="row-actions">
            <span class="tag">${cost} bones</span>
            <button class="btn small">${isActive ? tt('btn_extend', null, 'Extend') : tt('church_activate', null, 'Activate')}</button>
          </div>`;
        const btn = row.querySelector('button');
        if (btn) btn.disabled = locked || (active && active.key !== b.key);
        if (btn && !btn.disabled) btn.onclick = () => {
          const r = Systems.Church.activate(b.key);
          if (r.error) this.toast(r.error, 'error');
          else { this.toast(`${GameData.blessingName(b)} activated!`, 'success'); State.save(); }
          this.render();
        };
        list.appendChild(row);
      }
      card.appendChild(list);
    }

    wrap.appendChild(card);
    return wrap;
  };

  /* ================================================================ *
   *  INN — hire workers + daily food menu
   * ================================================================ */

  UI._renderInn = function () {
    const wrap = Util.el('div');

    const hireCard = Util.el('div', 'card');
    hireCard.appendChild(Util.el('h2', null, '🍺 ' + tt('inn_title', null, 'Inn')));
    hireCard.appendChild(Util.el('p', 'card-sub',
      tt('inn_desc', null, 'Hire a worker to train skills for you in parallel. One job per hire — after collecting their results the worker moves on. Inn building tiers boost worker XP.')));
    const grid = Util.el('div', 'grid-2');
    const slotDefs = [
      { slot: 1, tiers: ['long_laborer'], header: '🧹 Long Laborer slot' },
      { slot: 2, tiers: ['apprentice', 'journeyman', 'master'], header: '🛠️ Skilled Worker slot' },
    ];
    for (const sd of slotDefs) {
      const box = Util.el('div');
      box.appendChild(Util.el('h3', 'skills-group-header', sd.header));
      const list = Util.el('div', 'row-list');
      const hired = State.state.inn.workers[sd.slot];
      if (hired) {
        const tier = Systems.Inn.tier(hired.tier);
        const sess = hired.session;
        const done = sess && Date.now() >= sess.endsAt;
        const row = Util.el('div', 'row quest-row complete');
        row.innerHTML = `
          <div class="row-icon">🍺</div>
          <div class="row-main">
            <div class="row-name">${Util.esc(hired.name)} <span class="tag blue">${Util.prettify(hired.tier)}</span></div>
            <div class="row-sub">${sess
              ? (done ? '✅ <b>Job done — collect below</b>' : `Working: ${Util.esc(sess.label)} · <span data-worker-timer="${sd.slot}">${Util.fmtTime(sess.endsAt - Date.now())}</span> left`)
              : 'Idle — assign a job below'}</div>
          </div>
          <div class="row-actions"></div>`;
        const actions = row.querySelector('.row-actions');
        if (sess && done && actions) {
          const collectBtn = Util.el('button', 'btn small success', '📦 ' + tt('btn_collect', null, 'Collect Rewards'));
          collectBtn.onclick = () => this._collectWorkerFlow(sd.slot);
          actions.appendChild(collectBtn);
        }
        if (!sess && actions) {
          const dismissBtn = Util.el('button', 'btn small secondary', tt('worker_dismiss_btn', null, 'Dismiss'));
          dismissBtn.onclick = () => {
            Systems.Inn.dismiss(sd.slot);
            this.render();
          };
          actions.appendChild(dismissBtn);
        }
        list.appendChild(row);
      }
      for (const tierKey of sd.tiers) {
        const tier = Systems.Inn.tier(tierKey);
        const occupied = !!hired;
        const row = Util.el('div', 'row' + (occupied ? ' locked' : ''));
        row.innerHTML = `
          <div class="row-icon">${tierKey === 'master' ? '🎩' : tierKey === 'journeyman' ? '🛠️' : tierKey === 'apprentice' ? '🔧' : '🧹'}</div>
          <div class="row-main">
            <div class="row-name">${Util.prettify(tierKey)}</div>
            <div class="row-sub">${tier.hours}h gathering at ${tier.efficiency}× (loot & XP ×${tier.hours * tier.efficiency}) · crafting cap ${tier.maxCraftQty === Infinity ? 'none' : tier.maxCraftQty}/session</div>
          </div>
          <div class="row-actions"><span class="tag gold">${Util.fmt(tier.hireCost)} 🪙</span><button class="btn small">${tt('inn_hire', null, 'Hire')}</button></div>`;
        const btn = row.querySelector('button');
        if (btn) btn.disabled = occupied || State.state.coins < tier.hireCost;
        if (btn) btn.onclick = () => {
          const r = Systems.Inn.hire(tierKey);
          if (r.error) this.toast(r.error, 'error');
          else { this.toast(`${r.worker.name} the ${Util.prettify(tierKey)} is hired! Assign them a job.`, 'success'); State.save(); }
          this.render();
        };
        list.appendChild(row);
      }
      box.appendChild(list);
      grid.appendChild(box);
    }
    hireCard.appendChild(grid);
    wrap.appendChild(hireCard);

    // Job assignment per idle hired worker
    for (const slot of [1, 2]) {
      const worker = State.state.inn.workers[slot];
      if (!worker || worker.session) continue;
      const jobCard = Util.el('div', 'card');
      jobCard.appendChild(Util.el('h2', null, `📋 Assign a job — ${Util.esc(worker.name)}`));
      const sel = Util.el('select', 'fancy');
      sel.style.width = '100%';
      for (const g of this._workerActivityOptions()) {
        const og = document.createElement('optgroup');
        og.label = g.label;
        for (const opt of g.options) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.text;
          o.disabled = !!opt.disabled;
          og.appendChild(o);
        }
        sel.appendChild(og);
      }
      const startBtn = Util.el('button', 'btn', '🚀 ' + tt('web_start_job', null, 'Start job'));
      startBtn.style.marginTop = '8px';
      startBtn.onclick = () => {
        const [kind, skill, key] = sel.value.split('::');
        if (!key) { this.toast('Pick an activity first.', 'error'); return; }
        const workerOpt = { worker: { slot, tier: Systems.Inn.tier(worker.tier) } };
        const r = kind === 'dungeon' ? Engine.startDungeonSession(key, workerOpt)
          : kind === 'boss' ? Systems.Bosses.start(key, workerOpt)
          : Engine.startSkillSession(skill, key, undefined, workerOpt);
        if (r.error) this.toast(r.error, 'error');
        else { this.toast(`${worker.name} started: ${r.session.label}`, 'success'); State.save(); }
        this.render();
      };
      jobCard.appendChild(sel);
      jobCard.appendChild(startBtn);
      wrap.appendChild(jobCard);
    }

    // Daily food menu
    const foodCard = Util.el('div', 'card');
    foodCard.appendChild(Util.el('h2', null, '🍲 ' + tt('inn_daily_menu', null, 'Daily Menu')));
    foodCard.appendChild(Util.el('p', 'card-sub', 'Bulk food for dungeon runs — rotates daily at 6am.'));
    const foods = Systems.Inn.dailyFoods();
    const flist = Util.el('div', 'row-list');
    for (const f of foods) {
      const row = Util.el('div', 'row');
      row.innerHTML = `
        <div class="row-icon">🍲</div>
        <div class="row-main">
          <div class="row-name">${Util.esc(f.name)} <span class="tag green">heals ${f.heal * 10} HP</span></div>
          <div class="row-sub">${f.price} 🪙 each · you have ${Util.fmt(State.count(f.key))}</div>
        </div>
        <div class="row-actions">
          <button class="btn small secondary" data-q="10">×10</button>
          <button class="btn small secondary" data-q="100">×100</button>
        </div>`;
      (row.querySelectorAll('button') || []).forEach(b => b.onclick = () => {
        const qty = parseInt(b.dataset.q, 10);
        const r = Systems.Inn.buyFood(f.key, f.price, qty);
        if (r.error) this.toast(r.error, 'error');
        else this.toast(`Bought ${qty}× ${f.name}`, 'success');
        this.render();
      });
      flist.appendChild(row);
    }
    foodCard.appendChild(flist);
    wrap.appendChild(foodCard);

    return wrap;
  };

  /** Activity picker options for a hired worker. */
  UI._workerActivityOptions = function () {
    const groups = [];
    const push = (label, rows) => { if (rows.length) groups.push({ label, options: rows }); };
    const lvlOk = (skill, req) => State.level(skill) >= req;
    push('⛏️ Mining', Object.entries(GameData.ores).map(([k, o]) => ({ value: `skill::mining::${k}`, text: o.display_name, disabled: !lvlOk('mining', o.level_required) })));
    push('🪓 Woodcutting', Object.entries(GameData.trees).map(([k, tr]) => ({ value: `skill::woodcutting::${k}`, text: tr.display_name, disabled: !lvlOk('woodcutting', tr.level_required) })));
    push('🎣 Fishing', Object.entries(GameData.fish).map(([k, f]) => ({ value: `skill::fishing::${k}`, text: GameData.name(k), disabled: !lvlOk('fishing', f.level_required) })));
    push('🗝️ Thieving', GameData.thievingNpcs.map(n => ({ value: `skill::thieving::${n.key}`, text: n.display_name, disabled: !lvlOk('thieving', n.level_required) })));
    push('🏃 Agility', Object.entries(GameData.agilityCourses).map(([k, c]) => ({ value: `skill::agility::${k}`, text: c.display_name, disabled: !lvlOk('agility', c.level_required) })));
    push('🛒 Mercantile', GameData.tradeRouteList.map(r => ({ value: `skill::mercantile::${r.id}`, text: `${r.display_name} (${Util.fmt(r.coin_cost)} 🪙)`, disabled: !lvlOk('mercantile', r.level_required) })));
    push('🍳 Cooking', Object.values(GameData.recipes.cooking).filter(r => State.count(r.raw_item) > 0).map(r => ({ value: `skill::cooking::${r.id}`, text: `${r.display_name} (${Util.fmt(State.count(r.raw_item))} raw)` })));
    push('🔥 Firemaking', Object.entries(GameData.logs).filter(([k]) => State.count(k) > 0).map(([k]) => ({ value: `skill::firemaking::${k}`, text: GameData.name(k) })));
    push('🔨 Smithing', Object.entries(GameData.recipes.smithing).map(([k, r]) => ({ value: `skill::smithing::${k}`, text: r.display_name, disabled: !lvlOk('smithing', r.level_required) })));
    push('🏹 Fletching', Object.entries(GameData.recipes.fletching).map(([k, r]) => ({ value: `skill::fletching::${k}`, text: r.display_name, disabled: !lvlOk('fletching', r.level_required) })));
    push('💎 Crafting', Object.entries(GameData.recipes.crafting).map(([k, r]) => ({ value: `skill::crafting::${k}`, text: r.display_name, disabled: !lvlOk('crafting', r.level_required) })));
    push('🏗️ Construction', Object.entries(GameData.recipes.construction).map(([k, r]) => ({ value: `skill::construction::${k}`, text: r.display_name, disabled: !lvlOk('construction', r.level_required) })));
    push('✨ Runecrafting', Object.entries(GameData.runes).map(([k, r]) => ({ value: `skill::runecrafting::${k}`, text: r.display_name, disabled: !lvlOk('runecrafting', r.level_required) })));
    push('🧪 Herblore', Object.entries(GameData.herbloreRecipes).map(([k, r]) => ({ value: `skill::herblore::${k}`, text: r.display_name, disabled: !lvlOk('herblore', r.level_required) })));
    push('🙏 Prayer', Object.entries(GameData.bones).filter(([k]) => State.count(k) > 0).map(([k, b]) => ({ value: `skill::prayer::${k}`, text: `${b.display_name} ×${Util.fmt(State.count(k))}` })));
    push('🏰 Dungeons (uses your gear)', GameData.dungeonList().filter(d => State.dungeonUnlocked(d.name)).map(d => ({ value: `dungeon::combat::${d.name}`, text: `${d.display_name} (lvl ${d.recommended_level})` })));
    push('🐉 Raid Bosses (uses your gear)', Systems.Bosses.list().filter(([, b]) => Systems.combatLevel() >= b.combat_level_required).map(([k, b]) => ({ value: `boss::boss::${k}`, text: b.display_name })));
    return groups;
  };

  /** Collect modal for a finished worker job. */
  UI._collectWorkerFlow = function (slot) {
    const r = Systems.Inn.collect(slot);
    if (r.error) { this.toast(r.error, 'error'); return; }
    const s = r.summary;
    const xpRows = Object.entries(s.xpBySkill).map(([k, v]) =>
      `<div class="rw"><span>${GameData.skillDefs.find(d => d.key === k)?.name || Util.prettify(k)} XP</span><b>+${Util.fmt(v)}</b></div>`).join('');
    const itemRows = Object.entries(s.items).sort((a, b) => b[1] - a[1]).slice(0, 14)
      .map(([k, v]) => `<div class="rw"><span>${GameData.name(k)}</span><b>+${Util.fmt(v)}</b></div>`).join('');
    this.modal(`
      <h2>🍺 ${Util.esc(s.name)} finished the job!</h2>
      ${s.leveled?.length ? `<p class="card-sub" style="color:var(--accent)">⬆️ Level up: ${s.leveled.map(l => Util.esc(l)).join(' · ')}</p>` : ''}
      ${s.petsGained?.length ? `<p class="card-sub" style="color:var(--green)">🐾 A pet has joined you: ${s.petsGained.map(k => GameData.pets[k]?.display_name || k).join(', ')}!</p>` : ''}
      <div class="reward-list">${xpRows || ''}${itemRows || ''}${s.coins ? `<div class="rw"><span>Coins</span><b>+${Util.fmt(s.coins)}</b></div>` : ''}</div>
      <div class="modal-actions"><button class="btn" data-act="close">Nice!</button></div>`,
    m => { m.querySelector('[data-act=close]').onclick = () => this.closeModal(); });
    State.save();
    this.render();
  };

  /* ================================================================ *
   *  BUILDER'S WORKSHOP
   * ================================================================ */

  UI._renderBuilder = function () {
    const wrap = Util.el('div');
    const card = Util.el('div', 'card');
    const lvl = State.level('construction');
    card.appendChild(Util.el('h2', null, '🏗️ ' + tt('builder_title', null, "Builder's Workshop")));
    card.appendChild(Util.el('p', 'card-sub',
      `Spend planks, nails, stone and coins to upgrade town buildings. Builder's discount: <b>${(Systems.Town.discountPerMille() / 10).toFixed(1)}%</b> off coin & material costs (0.5% per Construction level).`));

    const BONUS_TXT = {
      worker_xp: v => `+${Math.round(v * 100)}% worker XP`,
      guild_quest_reduction: v => `−${Math.round(v * 100)}% guild requirements`,
      extra_blessing_hrs: v => `+${v}h blessing duration`,
      extra_carnival_games: v => `+${v} carnival game${v > 1 ? 's' : ''}`,
      carnival_cooldown_mult: v => `${v}× carnival cooldown`,
      idle_ticket_bonus_chance: v => `+${Math.round(v * 100)}% idle tickets`,
      farm_plots: v => `+${v} farm plot${v > 1 ? 's' : ''}`,
      queue_slots: v => `+${v} queue slot${v > 1 ? 's' : ''}`,
      passive_cape_category: v => `+${v} passive cape categor${v > 1 ? 'ies' : 'y'}`,
      secondary_material_save_chance: v => `${Math.round(v * 100)}% material save`,
      player_session_speed_reduction: v => `−${Math.round(v * 100)}% session time`,
    };
    const bonusTxt = b => Object.entries(b).map(([k, v]) => (BONUS_TXT[k] || (x => `${k}: ${x}`))(v)).join(' · ');

    const list = Util.el('div', 'row-list');
    for (const [key, building] of Object.entries(GameData.townBuildings)) {
      const meta = Systems.Town.BUILDING_META[key] || { icon: '🏠' };
      const tier = Systems.Town.currentTier(key);
      const maxed = tier >= building.tiers.length;
      const next = maxed ? null : building.tiers[tier];
      const row = Util.el('div', 'row');
      const matsHtml = maxed ? '' : Object.entries(next.materials || {})
        .map(([m, q]) => {
          const need = Systems.Town.discountedQty(q);
          return `<span class="${State.count(m) >= need ? 'mat-ok' : 'mat-missing'}">${need}× ${GameData.name(m)} (${Util.fmt(State.count(m))})</span>`;
        }).join(' · ');
      const coinCost = maxed ? 0 : Systems.Town.discountedCoins(next.coin_cost);
      const locked = !maxed && lvl < next.construction_level_required;
      row.innerHTML = `
        <div class="row-icon">${meta.icon}</div>
        <div class="row-main">
          <div class="row-name">${Util.esc(Systems.Town.buildingName(key))} <span class="tag blue">tier ${tier}/${building.tiers.length}</span></div>
          <div class="row-sub">${tier > 0 ? 'Now: <b>' + bonusTxt(building.tiers[tier - 1].bonuses) + '</b>' : 'Not built yet'}${!maxed ? `<br>Next (🔒 Construction ${next.construction_level_required}): <b>${bonusTxt(next.bonuses)}</b> · ${matsHtml} · <b>${Util.fmt(coinCost)} 🪙</b>` : ' · <b>fully upgraded!</b>'}</div>
        </div>
        <div class="row-actions"><button class="btn small ${maxed || locked ? 'secondary' : ''}" ${maxed || locked ? 'disabled' : ''}>${maxed ? '✔️' : tt('town_upgrade_btn', null, 'Upgrade')}</button></div>`;
      const btn = row.querySelector('button');
      if (btn && !maxed && !locked) btn.onclick = () => {
        const res = Systems.Town.upgrade(key);
        if (res.error) this.toast(res.error, 'error');
        else { this.toast(`${Systems.Town.buildingName(key)} upgraded to tier ${tier + 1}!`, 'success'); State.save(); }
        this.render();
      };
      list.appendChild(row);
    }
    card.appendChild(list);
    wrap.appendChild(card);
    return wrap;
  };

  /* ================================================================ *
   *  EXPEDITIONS — skilling dungeons
   * ================================================================ */

  UI._renderExpeditions = function () {
    const wrap = Util.el('div');
    const card = Util.el('div', 'card');
    card.appendChild(Util.el('h2', null, '🧭 ' + tt('nav_expeditions', null, 'Expeditions')));
    card.appendChild(Util.el('p', 'card-sub',
      tt('web_expeditions_desc', null, 'Non-combat skilling dungeons. Besides XP and drops, every minute can uncover a lore note — find them all to unlock the combat dungeon hidden beyond.')));

    const list = Util.el('div', 'row-list');
    for (const sd of GameData.skillingDungeonList) {
      const avail = Systems.Expeditions.available(sd.name);
      const notes = Systems.Expeditions.notesFound(sd.name);
      const done = notes >= sd.note_threshold;
      const pct = Util.clamp((notes / sd.note_threshold) * 100, 0, 100);
      const unlockedDungeon = GameData.dungeons[sd.unlock_dungeon];
      const row = Util.el('div', 'row' + (avail.ok ? '' : ' locked'));
      row.innerHTML = `
        <div class="row-icon">${{ mining: '⛏️', woodcutting: '🪓', fishing: '🎣', agility: '🏃', thieving: '🗝️' }[sd.skill] || '🧭'}</div>
        <div class="row-main">
          <div class="row-name">${Util.esc(sd.display_name)} <span class="tag blue">${Util.prettify(sd.skill)} ${sd.level_required}</span>${done ? ' <span class="tag green">notes complete</span>' : ''}</div>
          <div class="row-sub">${Util.esc(sd.description || '')}</div>
          <div class="row-sub">📜 ${tt('expedition_lore_notes', [notes, sd.note_threshold], notes + ' / ' + sd.note_threshold + ' lore notes')} → unlocks ${Util.esc(unlockedDungeon?.display_name || sd.unlock_dungeon)}</div>
          <div class="qbar"><div style="width:${pct}%"></div></div>
          ${!avail.ok ? `<div class="row-sub mat-missing">🔒 ${Util.esc(avail.reason)}</div>` : ''}
        </div>
        <div class="row-actions"><button class="btn small" ${avail.ok ? '' : 'disabled'}>${tt('expedition_explore_button', null, 'Explore')}</button></div>`;
      const btn = row.querySelector('button');
      if (btn) btn.onclick = () => this._tryStart(() => Systems.Expeditions.start(sd.name));
      list.appendChild(row);
    }
    card.appendChild(list);
    wrap.appendChild(card);
    return wrap;
  };

  /* ================================================================ *
   *  SEASONAL EVENT
   * ================================================================ */

  UI._renderSeasonal = function () {
    const wrap = Util.el('div');
    const event = Systems.Seasonal.activeEvent();
    if (!event) {
      const card = Util.el('div', 'card');
      card.appendChild(Util.el('h2', null, '🎉 ' + tt('seasonal_event_title', null, 'Seasonal Event')));
      const upcoming = Object.values(GameData.seasonalEvents)
        .filter(e => e.start_ms > Date.now())
        .sort((a, b) => a.start_ms - b.start_ms)[0];
      card.appendChild(Util.el('div', 'empty-note', upcoming
        ? `No event right now. <b>${Util.esc(upcoming.display_name)}</b> begins in ${Util.fmtTime(upcoming.start_ms - Date.now())}.`
        : 'No event right now — check back around the solstice and the harvest.'));
      wrap.appendChild(card);
      return wrap;
    }

    Systems.Seasonal.ensureBountySlots();
    const tokens = Systems.Seasonal.tokens(event.id);

    const head = Util.el('div', 'card');
    head.style.borderColor = 'var(--gold)';
    head.appendChild(Util.el('h2', null, `🎉 ${Util.esc(event.display_name)}`));
    head.appendChild(Util.el('p', 'card-sub', `Ends in ${Util.fmtTime(event.end_ms - Date.now())} · tokens unlock reward tiers; the banner lands at ${event.token_goal}.`));
    const track = Util.el('div', 'row quest-row complete');
    track.innerHTML = `
      <div class="row-icon">🎟️</div>
      <div class="row-main">
        <div class="row-name">Tokens: <b>${tokens}</b> / ${event.token_goal}${State.state.seasonal.bannersEarned.includes(event.id) ? ' <span class="tag gold">banner earned!</span>' : ''}</div>
        <div class="qbar"><div style="width:${Util.clamp((tokens / event.token_goal) * 100, 0, 100)}%"></div></div>
        <div class="row-sub">Earn tokens from the Bounty Board, event expeditions (${Systems.Seasonal.expeditionKeys(event).map(k => Util.esc(GameData.dungeons[k]?.display_name || k)).join(', ')}), the event boss (${Util.esc(GameData.raidBosses[event.boss_key]?.display_name || '')}), and the minigame.</div>
      </div>`;
    head.appendChild(track);

    if (event.reward_tiers?.length) {
      head.appendChild(Util.el('h3', 'skills-group-header', '🎁 Reward track'));
      const claimed = State.state.seasonal.rewardTiersClaimed[event.id] || [];
      const tierList = Util.el('div', 'row-list');
      for (const tier of event.reward_tiers) {
        const isClaimed = claimed.includes(tier.tokens);
        const can = !isClaimed && tokens >= tier.tokens;
        const row = Util.el('div', 'row quest-row' + (can ? ' complete' : ''));
        row.innerHTML = `
          <div class="row-icon">${isClaimed ? '✅' : can ? '🎁' : '🎟️'}</div>
          <div class="row-main">
            <div class="row-name">${tier.tokens} tokens — ${Util.esc(tier.description)}</div>
            <div class="qbar"><div style="width:${Util.clamp((tokens / tier.tokens) * 100, 0, 100)}%"></div></div>
          </div>
          <div class="row-actions"><button class="btn small ${can ? 'success' : 'secondary'}" ${can ? '' : 'disabled'}>${isClaimed ? 'Claimed' : 'Claim'}</button></div>`;
        const btn = row.querySelector('button');
        if (btn && can) btn.onclick = () => {
          const r = Systems.Seasonal.claimRewardTier(event, tier);
          if (r.error) this.toast(r.error, 'error');
          else { this.toast(`Claimed: ${tier.description}`, 'success'); State.save(); }
          this.render();
        };
        tierList.appendChild(row);
      }
      head.appendChild(tierList);
    }
    wrap.appendChild(head);

    if (event.pillars.includes('bounty')) {
      const bounty = Util.el('div', 'card');
      bounty.appendChild(Util.el('h2', null, '📜 Bounty Board'));
      bounty.appendChild(Util.el('p', 'card-sub', 'One task per type; claiming awards a token and a fresh task rotates in after the cooldown.'));
      const list = Util.el('div', 'row-list');
      for (const { task, progress, cooldownUntil } of Systems.Seasonal.bountyTasks()) {
        const onCd = cooldownUntil != null && cooldownUntil > Date.now();
        const complete = progress >= task.amount;
        const pct = Util.clamp((progress / task.amount) * 100, 0, 100);
        const row = Util.el('div', 'row quest-row' + (complete && !onCd ? ' complete' : ''));
        row.innerHTML = `
          <div class="row-icon">${{ gather: '🌾', craft: '⚒️', kill: '💀', turn_in: '📦' }[task.type] || '📜'}</div>
          <div class="row-main">
            <div class="row-name">${Util.esc(task.display_name)}</div>
            <div class="row-sub">${Util.esc(task.hint || '')}</div>
            <div class="qbar"><div style="width:${pct}%"></div></div>
            <div class="row-sub">${Util.fmt(Math.min(progress, task.amount))} / ${Util.fmt(task.amount)}</div>
          </div>
          <div class="row-actions">${onCd ? `<span class="tag">⏳ ${Util.fmtTime(cooldownUntil - Date.now())}</span>` : `<button class="btn small ${complete ? 'success' : 'secondary'}" ${complete ? '' : 'disabled'}>Claim +1🎟️</button>`}</div>`;
        const btn = row.querySelector('button');
        if (btn && complete) btn.onclick = () => {
          const r = Systems.Seasonal.claimBountyTask(task.id);
          if (r.error) this.toast(r.error, 'error');
          else { this.toast('Bounty claimed — +1 token! 🎟️', 'success'); State.save(); }
          this.render();
        };
        list.appendChild(row);
      }
      bounty.appendChild(list);
      wrap.appendChild(bounty);
    }

    if (event.night_market?.length) {
      const market = Util.el('div', 'card');
      market.appendChild(Util.el('h2', null, '🌙 ' + tt('seasonal_market_title', null, 'Night Market')));
      const list = Util.el('div', 'row-list');
      for (const offer of event.night_market) {
        const bought = State.state.seasonal.marketPurchases[event.id + ':' + offer.id] || 0;
        const limited = offer.limit != null && bought >= offer.limit;
        const itemsTxt = Object.entries(offer.items || {}).map(([k, v]) => `${v}× ${GameData.name(k)}`).join(', ');
        const effectTxt = offer.effect === 'skip_bounty_cooldowns' ? 'Instantly rotates all bounty slots'
          : offer.effect === 'skip_minigame_cooldown' ? 'Resets the minigame cooldown' : '';
        const row = Util.el('div', 'row');
        row.innerHTML = `
          <div class="row-icon">🌙</div>
          <div class="row-main">
            <div class="row-name">${Util.esc(offer.display_name)}${offer.limit != null ? ` <span class="tag">limit ${offer.limit}</span>` : ''}</div>
            <div class="row-sub">${[itemsTxt, effectTxt].filter(Boolean).join(' · ') || 'Utility'}${bought ? ` · bought ${bought}×` : ''}</div>
          </div>
          <div class="row-actions"><span class="tag gold">${Util.fmt(offer.coin_cost)} 🪙</span><button class="btn small" ${limited ? 'disabled' : ''}>${limited ? 'Sold out' : 'Buy'}</button></div>`;
        const btn = row.querySelector('button');
        if (btn && !limited) btn.onclick = () => {
          const r = Systems.Seasonal.purchaseMarketOffer(event, offer);
          if (r.error) this.toast(r.error, 'error');
          else { this.toast(`Bought ${offer.display_name}`, 'success'); State.save(); }
          this.render();
        };
        list.appendChild(row);
      }
      market.appendChild(list);
      wrap.appendChild(market);
    }

    const mg = event.minigame;
    if (mg && event.pillars.includes('minigame')) {
      const card = Util.el('div', 'card');
      card.appendChild(Util.el('h2', null, `${mg.emoji || '🎮'} ${Util.esc(mg.display_name)}`));
      const onCd = Systems.Seasonal.minigameOnCooldown();
      const easy = State.state.seasonal.minigameEasyMode;
      card.appendChild(Util.el('p', 'card-sub',
        mg.type === 'sequence'
          ? `Simon says with lanterns: repeat each round's longer sequence. ${mg.hits_required}/${mg.rounds} rounds correct wins a token.`
          : `Whack-a-mole: tap the lit ${mg.emoji || '🔥'} before it fades — ${mg.rounds} rounds, ${mg.hits_required} hits needed for a token.`));
      const row = Util.el('div', 'row');
      row.innerHTML = `
        <div class="row-icon">${mg.emoji || '🎮'}</div>
        <div class="row-main"><div class="row-sub"><span id="seasonal-mg-cd">${onCd ? `⏳ cooldown ${Util.fmtTime(State.state.seasonal.minigameCooldownAt - Date.now())}` : '✅ ready'}</span></div></div>
        <div class="row-actions">
          <button class="btn small secondary" data-act="easy">${easy ? '✔️ Easy mode' : 'Easy mode'}</button>
          <button class="btn small" data-act="play" ${onCd ? 'disabled' : ''}>Play</button>
        </div>`;
      const easyBtn = row.querySelector('[data-act=easy]');
      if (easyBtn) easyBtn.onclick = () => {
        State.state.seasonal.minigameEasyMode = !State.state.seasonal.minigameEasyMode;
        State.save();
        this.render();
      };
      const playBtn = row.querySelector('[data-act=play]');
      if (playBtn) playBtn.onclick = () => this._playSeasonalMinigame(event);
      card.appendChild(row);
      wrap.appendChild(card);
    }

    return wrap;
  };

  /** Whack-a-mole / sequence minigame (port of the Hub minigame screens). */
  UI._playSeasonalMinigame = function (event) {
    const mg = event.minigame;
    const easy = State.state.seasonal.minigameEasyMode;
    const visibleMs = easy ? (mg.visible_ms_easy || mg.visible_ms) : mg.visible_ms;
    const isSequence = mg.type === 'sequence';
    const emoji = mg.emoji || '🔥';
    const holes = Math.max(3, Math.min(12, mg.hole_count || 9));
    const rounds = mg.rounds || 8;
    const need = mg.hits_required || rounds - 1;

    let round = 0, hits = 0, seq = [], seqIdx = 0, showing = false;
    let timers = [];
    const clearTimers = () => { timers.forEach(t => clearTimeout(t)); timers = []; };

    this.modal(`
      <h2>${emoji} ${Util.esc(mg.display_name)}</h2>
      <p class="card-sub" id="mg-status">Round 1 / ${rounds} — hits 0/${need}</p>
      <div class="mg-board" id="mg-board" style="display:grid;grid-template-columns:repeat(${Math.ceil(holes / 2)},1fr);gap:8px;margin:10px 0"></div>
      <div class="modal-actions">
        <button class="btn secondary" data-act="quit">Quit</button>
      </div>`, m => {
      const board = m.querySelector('#mg-board');
      const status = m.querySelector('#mg-status');
      m.querySelector('[data-act=quit]').onclick = () => { clearTimers(); this.closeModal(); this.render(); };
      const cells = [];
      for (let i = 0; i < holes; i++) {
        const c = Util.el('button', 'btn secondary');
        c.style.cssText = 'aspect-ratio:1;font-size:24px;padding:0';
        c.textContent = '·';
        c.onclick = () => tap(i);
        board.appendChild(c);
        cells.push(c);
      }

      const finish = won => {
        clearTimers();
        const res = Systems.Seasonal.submitMinigame(won);
        status.textContent = won
          ? `🎉 You win — +1 token! Cooldown ${res.resumesAt ? Util.fmtTime(res.resumesAt - Date.now()) : ''}`
          : `😅 Short by ${need - hits} — cooldown ${res.resumesAt ? Util.fmtTime(res.resumesAt - Date.now()) : ''}`;
        State.save();
        timers.push(setTimeout(() => { this.closeModal(); this.render(); }, 1800));
      };

      const updateStatus = () => { status.textContent = `Round ${Math.min(round + 1, rounds)} / ${rounds} — hits ${hits}/${need}`; };

      const playSeqRound = () => {
        updateStatus();
        seq = [...seq, Math.floor(Math.random() * holes)];
        seqIdx = 0;
        showing = true;
        seq.forEach((h, i) => {
          timers.push(setTimeout(() => { cells[h].textContent = emoji; cells[h].classList.add('active'); }, i * visibleMs));
          timers.push(setTimeout(() => { cells[h].textContent = '·'; cells[h].classList.remove('active'); }, i * visibleMs + visibleMs * 0.6));
        });
        timers.push(setTimeout(() => { showing = false; }, seq.length * visibleMs + 100));
      };

      const playWhackRound = () => {
        updateStatus();
        showing = false;
        const h = Math.floor(Math.random() * holes);
        timers.push(setTimeout(() => {
          cells[h].textContent = emoji; cells[h].classList.add('active');
          cells[h].dataset.mole = '1';
          timers.push(setTimeout(() => {
            if (cells[h].dataset.mole === '1') {
              cells[h].dataset.mole = ''; cells[h].textContent = '·'; cells[h].classList.remove('active');
              endRound(false);
            }
          }, visibleMs));
        }, 250 + Math.random() * 400));
      };

      const endRound = hit => {
        if (hit) hits++;
        round++;
        cells.forEach(c => { c.textContent = '·'; c.classList.remove('active'); delete c.dataset.mole; });
        updateStatus();
        if (round >= rounds) { finish(hits >= need); return; }
        if (isSequence && hits + (rounds - round) < need) { finish(false); return; }
        timers.push(setTimeout(() => (isSequence ? playSeqRound : playWhackRound)(), 500));
      };

      const tap = i => {
        if (isSequence) {
          if (showing) return;
          if (seq[seqIdx] === i) {
            cells[i].textContent = emoji;
            timers.push(setTimeout(() => { cells[i].textContent = '·'; }, 150));
            seqIdx++;
            if (seqIdx >= seq.length) {
              hits++; round++; updateStatus();
              if (round >= rounds) { finish(hits >= need); return; }
              timers.push(setTimeout(playSeqRound, 600));
            }
          } else {
            cells.forEach(c => c.style.opacity = '0.4');
            finish(false);
          }
        } else if (cells[i].dataset.mole === '1') {
          cells[i].dataset.mole = '';
          endRound(true);
        }
      };

      (isSequence ? playSeqRound : playWhackRound)();
    });
  };

  const _origRenderCharacter = UI.renderCharacter.bind(UI);
  UI.renderCharacter = function () {
    const wrap = _origRenderCharacter();
    const card = Util.el('div', 'card');
    card.appendChild(Util.el('h2', null, `🐾 Pets <span class="tag blue">${State.state.petsOwned.length}/${Object.keys(GameData.pets).length}</span>`));
    card.appendChild(Util.el('p', 'card-sub', 'Rare companions from training, raids, the Tower and the Carnival. Every pet you own passively boosts its skill\'s XP — they stack!'));
    const grid = Util.el('div', 'skills-grid');
    const owned = new Set(State.state.petsOwned);
    // Web-obtainable pets first, then the raid/event exclusives
    const webPets = Object.values(GameData.pets).filter(p =>
      !String(p.source).includes('raid') && !String(p.source).includes('event') && !String(p.source).includes('Monument'));
    const otherPets = Object.values(GameData.pets).filter(p => !webPets.includes(p));
    for (const p of [...webPets, ...otherPets]) {
      const has = owned.has(p.id);
      const tile = Util.el('div', 'skill-tile' + (has ? '' : ' pet-locked'));
      tile.title = has ? `${p.description} — ${p.source}` : `Found via: ${p.source}`;
      tile.innerHTML = has
        ? `<div class="sk-emoji">${p.emoji || '🐾'}</div><div class="sk-name">${p.display_name}</div><div class="sk-level" style="font-size:12px">+${p.boost_percent}% ${Util.prettify(p.boosted_skill)}</div>`
        : `<div class="sk-emoji">❓</div><div class="sk-name">???</div><div class="sk-level" style="font-size:10px;color:var(--muted)">${p.source.length > 26 ? p.source.slice(0, 26) + '…' : p.source}</div>`;
      grid.appendChild(tile);
    }
    card.appendChild(grid);
    wrap.appendChild(card);
    return wrap;
  };

})();

/* Export for Node-based tests (no-op in the browser) */
if (typeof module !== 'undefined' && module.exports) module.exports = { UITown: true };
