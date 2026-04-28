const HUD = {
  update(game) {
    // Top bar
    setText('hud-gold', Math.floor(game.playerGold));
    const oilCap = game.calcOilSupply('player');
    const oilUsed = game.calcOilUsed('player');
    setText('hud-oil', oilUsed);
    setText('hud-oil-max', oilCap);

    const saveState = Storage.load();
    setText('hud-upgrade-cur', saveState.upgradeCurrency);

    const stageInfo = CONFIG.DIFFICULTY_STAGES[saveState.adaptiveDifficultyIndex] || CONFIG.DIFFICULTY_STAGES[0];
    setText('hud-stage', game.mode === 'practice'
      ? `Practice (${game.practiceDifficulty})`
      : `Stage: ${stageInfo.name}`
    );

    // Oil warning
    const oilEl = document.getElementById('hud-oil');
    if (oilEl) {
      oilEl.parentElement.style.color = oilUsed >= oilCap ? '#ff6b6b' : '';
    }
  },

  updateSelection(game) {
    const nameEl = document.getElementById('selection-name');
    const statsEl = document.getElementById('selection-stats');
    const abilityEl = document.getElementById('ability-bar');
    const buildEl = document.getElementById('build-buttons');
    const queueEl = document.getElementById('queue-display');
    const prodPanel = document.getElementById('production-panel');

    if (!nameEl) return;

    const sel = game.selectedUnits;
    const bldg = game.selectedBuilding;

    // Clear
    if (statsEl) statsEl.innerHTML = '';
    if (abilityEl) abilityEl.innerHTML = '';
    if (buildEl) buildEl.innerHTML = '';
    if (queueEl) queueEl.innerHTML = '';
    if (prodPanel) prodPanel.style.display = 'none';

    if (sel.length === 0 && !bldg) {
      nameEl.textContent = 'Select a unit or building';
      return;
    }

    if (sel.length === 1) {
      const boat = sel[0];
      const cfg = CONFIG.BOATS[boat.type];
      nameEl.textContent = cfg.name;
      if (statsEl) {
        statsEl.innerHTML = `
          <span>HP: ${Math.ceil(boat.hp)}/${boat.maxHp}</span>
          <span>DMG: ${boat.attackDamage}</span>
          <span>SPD: ${boat.speed}</span>
          <span>RNG: ${boat.attackRange}</span>
          <span>Oil: ${cfg.oilCost}</span>
          ${boat.state === 'submerged' ? '<span class="status-badge sub">SUBMERGED</span>' : ''}
          ${boat.state === 'capturing' ? '<span class="status-badge cap">CAPTURING</span>' : ''}
        `;
      }
      if (abilityEl && cfg.ability) {
        const ab = cfg.ability;
        const cd = Math.ceil(boat.abilityCooldown);
        const ready = cd === 0 && !boat.abilityActive;
        abilityEl.innerHTML = `
          <button class="ability-btn ${ready ? 'ready' : 'cooldown'}" onclick="window.currentGame && window.currentGame.selectedUnits[0] && window.currentGame.selectedUnits[0].useAbility(window.currentGame)">
            <div class="ability-name">[Q] ${ab.name}</div>
            <div class="ability-desc">${ab.desc}</div>
            <div class="ability-cd">${boat.abilityActive ? 'ACTIVE' : cd > 0 ? `${cd}s` : 'Ready'}</div>
          </button>
        `;
      }
    } else if (sel.length > 1) {
      nameEl.textContent = `${sel.length} units selected`;
      if (statsEl) {
        const types = {};
        sel.forEach(b => { types[CONFIG.BOATS[b.type].name] = (types[CONFIG.BOATS[b.type].name] || 0) + 1; });
        statsEl.innerHTML = Object.entries(types).map(([k, v]) => `<span>${v}× ${k}</span>`).join('');
      }
      if (abilityEl) {
        abilityEl.innerHTML = `<button class="ability-btn ready" onclick="window.currentGame && window.currentGame.selectedUnits.forEach(b=>b.useAbility(window.currentGame))">[Q] Use Abilities</button>`;
      }
    }

    if (bldg instanceof Base && bldg.team === 'player') {
      nameEl.textContent = 'Command Base';
      if (prodPanel) prodPanel.style.display = 'flex';
      if (statsEl) {
        statsEl.innerHTML = `
          <span>HP: ${Math.ceil(bldg.hp)}/${bldg.maxHp}</span>
          <span>Income: +${bldg.income}/s</span>
          <span>Oil: +${bldg.oil}</span>
          <span>Energy: ${Math.floor(bldg.energy)}/${bldg.maxEnergy}</span>
          <span>Workshops: ${bldg.totalWorkshops}/${bldg.maxWorkshops}</span>
        `;
      }
      this._renderBuildButtons(game, bldg, buildEl, queueEl);
    }

    if (bldg instanceof Island) {
      nameEl.textContent = `${bldg.stage.name} (${bldg.team === 'neutral' ? 'Neutral' : bldg.team === 'player' ? 'Yours' : 'Enemy'})`;
      if (statsEl) {
        statsEl.innerHTML = `
          <span>Income: +${bldg.income}/s</span>
          <span>Oil: +${bldg.oil}</span>
          <span>Repairs: ${bldg.canRepair ? '✓' : '✗'}</span>
          <span>Builds: ${bldg.canBuild ? '✓' : '✗'}</span>
          <span>Defense: ${bldg.hasDefense ? '✓' : '✗'}</span>
        `;
      }
      if (bldg.team === 'player') {
        if (prodPanel) prodPanel.style.display = 'flex';
        if (bldg.stageIndex < CONFIG.ISLAND_STAGES.length - 1) {
          const next = CONFIG.ISLAND_STAGES[bldg.stageIndex + 1];
          const canAfford = game.playerGold >= next.upgradeCost;
          if (buildEl) buildEl.innerHTML = `
            <button class="build-btn upgrade-btn ${canAfford ? '' : 'disabled'}" onclick="window.currentGame && window.currentGame.upgradeIsland()">
              Upgrade to ${next.name}<br><small>${next.upgradeCost} Gold</small>
            </button>
          `;
        } else {
          if (buildEl) buildEl.innerHTML = `<span class="max-label">Fully Upgraded</span>`;
        }
        if (bldg.canBuild) {
          this._renderBuildButtons(game, bldg, null, queueEl);
        }
      }
    }
  },

  _renderBuildButtons(game, bldg, buildEl, queueEl) {
    const state = Storage.load();
    const canAffordBoat = (type) => {
      const cfg = CONFIG.BOATS[type];
      const oilCap = game.calcOilSupply('player');
      const oilUsed = game.calcOilUsed('player');
      return game.playerGold >= cfg.cost && (oilCap - oilUsed) >= cfg.oilCost;
    };

    if (buildEl) {
      buildEl.innerHTML = '';
      const isBase = bldg instanceof Base;

      if (isBase && bldg.extraWorkshops < bldg.maxWorkshops - 1) {
        const canBuy = game.playerGold >= 200;
        const ws = document.createElement('button');
        ws.className = `build-btn ${canBuy ? '' : 'disabled'}`;
        ws.innerHTML = `Add Workshop<br><small>200 Gold</small>`;
        ws.onclick = () => game.buyWorkshop();
        buildEl.appendChild(ws);
      }

      for (const id of state.unlockedBoats) {
        const cfg = CONFIG.BOATS[id];
        if (!cfg) continue;
        const afford = canAffordBoat(id);
        const btn = document.createElement('button');
        btn.className = `build-btn ${afford ? '' : 'disabled'}`;
        btn.innerHTML = `${cfg.name}<br><small>${cfg.cost}G · ${cfg.oilCost}⛽ · ${cfg.buildTime}s</small>`;
        btn.title = cfg.description;
        btn.onclick = () => game.buildBoat(id);
        buildEl.appendChild(btn);
      }
    }

    // Queue display
    if (queueEl) {
      queueEl.innerHTML = '';
      const queues = bldg.buildQueues;
      for (let s = 0; s < queues.length; s++) {
        const queue = queues[s];
        if (!queue) continue;
        const slotDiv = document.createElement('div');
        slotDiv.className = 'queue-slot';
        slotDiv.innerHTML = `<span class="slot-label">WS${s + 1}</span>`;
        for (const item of queue) {
          const cfg = CONFIG.BOATS[item.type];
          const buildTime = cfg.buildTime;
          const ratio = item.progress / buildTime;
          const div = document.createElement('div');
          div.className = 'queue-item';
          div.innerHTML = `
            <span>${cfg.name}</span>
            <div class="queue-bar"><div class="queue-fill" style="width:${Math.round(ratio*100)}%"></div></div>
          `;
          slotDiv.appendChild(div);
        }
        if (queue.length === 0) {
          slotDiv.innerHTML += `<span class="queue-empty">Empty</span>`;
        }
        queueEl.appendChild(slotDiv);
      }
    }
  },

  showGroupNotif(g, count) {
    const el = document.getElementById('fleet-groups-display');
    if (!el) return;
    const notif = document.createElement('div');
    notif.className = 'group-notif';
    notif.textContent = `Group ${g}: ${count} unit${count !== 1 ? 's' : ''}`;
    el.appendChild(notif);
    setTimeout(() => notif.remove(), 2000);
  },
};

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
