const Menu = {
  currentGame: null,

  init() {
    this._refreshMainMenu();
    this._bindButtons();
  },

  _bindButtons() {
    // Battle
    on('btn-adaptive-ai', 'click', () => this.startGame('adaptive'));
    on('btn-practice', 'click', () => this.startGame('practice'));

    // Settings modals
    on('btn-adaptive-settings', 'click', () => this._openModal('modal-adaptive-settings'));
    on('btn-practice-settings', 'click', () => this._openModal('modal-practice-settings'));
    on('btn-close-adaptive-settings', 'click', () => this._closeModal('modal-adaptive-settings'));
    on('btn-close-practice-settings', 'click', () => this._closeModal('modal-practice-settings'));

    // Adaptive difficulty controls
    on('btn-difficulty-down', 'click', () => this._adjustDifficulty(-1));
    on('btn-difficulty-up', 'click', () => this._adjustDifficulty(1));

    // Practice difficulty
    on('practice-difficulty', 'change', (e) => {
      Storage.set('practiceMode', e.target.value);
    });

    // Upgrades
    on('btn-upgrades', 'click', () => this.showScreen('upgrades-screen'));
    on('btn-back-upgrades', 'click', () => this.showScreen('main-menu'));

    // Captains
    on('btn-captains', 'click', () => {
      const state = Storage.load();
      if (!state.captainsUnlocked) return;
      this.showScreen('captains-screen');
      this._renderCaptains();
    });
    on('btn-back-captains', 'click', () => this.showScreen('main-menu'));

    // Surrender in game
    on('btn-surrender', 'click', () => {
      if (this.currentGame && confirm('Surrender the battle?')) this.currentGame.surrender();
    });

    // Post-match
    on('btn-return-menu', 'click', () => {
      this.showScreen('main-menu');
      this._refreshMainMenu();
    });
    on('btn-play-again', 'click', () => {
      const state = Storage.load();
      if (this.currentGame) {
        const mode = this.currentGame.mode;
        const diff = state.adaptiveDifficultyIndex;
        const prac = state.practiceMode;
        this.showScreen('game-screen');
        this._launchGame(mode, diff, prac);
      }
    });

    this._renderUpgrades();
  },

  _refreshMainMenu() {
    const state = Storage.load();
    const stageIdx = Math.min(state.adaptiveDifficultyIndex, CONFIG.DIFFICULTY_STAGES.length - 1);
    const stage = CONFIG.DIFFICULTY_STAGES[stageIdx];
    const winsNeeded = stage.winsRequired === Infinity ? '∞' : stage.winsRequired;

    setText('ai-stage-display', `Stage: ${stage.name}`);
    setText('ai-wins-display', `Wins: ${state.adaptiveWinsAtStage}/${winsNeeded}`);
    setText('upgrade-currency', state.upgradeCurrency);
    setText('captain-currency-display', state.captainCurrency);
    setText('captains-progress', `Progress: ${state.adaptiveTotalWins}/3`);
    setText('difficulty-label', stage.name);
    setText('modal-wins-display', `${state.adaptiveWinsAtStage}/${winsNeeded}`);

    const practiceEl = document.getElementById('practice-difficulty');
    if (practiceEl) practiceEl.value = state.practiceMode;

    // Unlock captains section
    const captainSection = document.getElementById('section-captains');
    const captainBtn = document.getElementById('btn-captains');
    if (state.captainsUnlocked) {
      captainSection?.classList.remove('locked');
      if (captainBtn) { captainBtn.disabled = false; captainBtn.textContent = 'Open Captains'; }
    } else {
      captainSection?.classList.add('locked');
    }

    // Upgrade currency display
    setText('upgrade-currency-upgrades', state.upgradeCurrency);
  },

  startGame(mode) {
    const state = Storage.load();
    this.showScreen('game-screen');
    this._launchGame(mode, state.adaptiveDifficultyIndex, state.practiceMode);
  },

  _launchGame(mode, diffIdx, practiceDiff) {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    this.currentGame = new Game(canvas, mode, diffIdx, practiceDiff);
    window.currentGame = this.currentGame;
    if (window.HUD) HUD.update(this.currentGame);
  },

  showPostMatch(game) {
    const state = Storage.load();
    const won = game.winner === 'player';
    const updates = {};

    // Currency rewards
    if (won) {
      updates.upgradeCurrency = state.upgradeCurrency + CONFIG.WIN_UPGRADE_CURRENCY;
      updates.captainCurrency = state.captainCurrency + CONFIG.WIN_CAPTAIN_CURRENCY;

      if (game.mode === 'adaptive') {
        updates.adaptiveTotalWins = state.adaptiveTotalWins + 1;
        const stageIdx = state.adaptiveDifficultyIndex;
        const stage = CONFIG.DIFFICULTY_STAGES[stageIdx];
        const newWins = state.adaptiveWinsAtStage + 1;

        if (newWins >= stage.winsRequired && stageIdx < CONFIG.DIFFICULTY_STAGES.length - 1) {
          updates.adaptiveDifficultyIndex = stageIdx + 1;
          updates.adaptiveWinsAtStage = 0;
        } else {
          updates.adaptiveWinsAtStage = newWins;
        }

        if ((updates.adaptiveTotalWins || state.adaptiveTotalWins + 1) >= 3) {
          updates.captainsUnlocked = true;
        }
      }
    } else {
      updates.upgradeCurrency = state.upgradeCurrency + CONFIG.LOSS_UPGRADE_CURRENCY;
      // Set back adaptive difficulty slightly on loss
      if (game.mode === 'adaptive') {
        const newWins = Math.max(0, state.adaptiveWinsAtStage - 1);
        updates.adaptiveWinsAtStage = newWins;
      }
    }

    Storage.update(updates);
    this.showScreen('post-match-screen');

    setText('post-match-result', won ? '⚓ VICTORY!' : '💀 DEFEAT');
    const resultEl = document.getElementById('post-match-result');
    if (resultEl) resultEl.style.color = won ? '#4fc3f7' : '#ef5350';

    const mins = Math.floor(game.gameTime / 60);
    const secs = Math.floor(game.gameTime % 60);

    const statsEl = document.getElementById('post-match-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat-row"><span>Match Time</span><span>${mins}:${String(secs).padStart(2,'0')}</span></div>
        <div class="stat-row"><span>Boats Sunk</span><span>${game.stats.boatsSunk}</span></div>
        <div class="stat-row"><span>Boats Lost</span><span>${game.stats.boatsLost}</span></div>
        <div class="stat-row"><span>Damage Dealt</span><span>${Math.floor(game.stats.damageDealt)}</span></div>
        <div class="stat-row"><span>Islands Captured</span><span>${game.stats.islandsCaptured}</span></div>
        <div class="stat-row"><span>Gold Earned</span><span>${Math.floor(game.stats.goldEarned)}</span></div>
      `;
    }

    const state2 = Storage.load();
    const rewardsEl = document.getElementById('post-match-rewards');
    if (rewardsEl) {
      rewardsEl.innerHTML = `
        <div class="reward-item">⚙ +${won ? CONFIG.WIN_UPGRADE_CURRENCY : CONFIG.LOSS_UPGRADE_CURRENCY} Upgrade Points (Total: ${state2.upgradeCurrency})</div>
        ${won ? `<div class="reward-item">⚓ +${CONFIG.WIN_CAPTAIN_CURRENCY} Captain Credits (Total: ${state2.captainCurrency})</div>` : ''}
        ${won && game.mode === 'adaptive' ? `<div class="reward-item stage-note">AI Stage: ${CONFIG.DIFFICULTY_STAGES[state2.adaptiveDifficultyIndex]?.name || 'Grand Admiral'}</div>` : ''}
        ${updates.captainsUnlocked && !state.captainsUnlocked ? `<div class="reward-item unlock">🔓 Captains Section Unlocked!</div>` : ''}
      `;
    }
  },

  _adjustDifficulty(dir) {
    const state = Storage.load();
    const newIdx = Math.max(0, Math.min(CONFIG.DIFFICULTY_STAGES.length - 1, state.adaptiveDifficultyIndex + dir));
    Storage.update({ adaptiveDifficultyIndex: newIdx, adaptiveWinsAtStage: 0 });
    this._refreshMainMenu();
  },

  _openModal(id) {
    this._refreshMainMenu();
    document.getElementById(id)?.classList.remove('hidden');
  },

  _closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
  },

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
  },

  _renderUpgrades() {
    const grid = document.getElementById('upgrades-grid');
    if (!grid) return;
    const state = Storage.load();

    const upgrades = [
      { id: 'hull1', name: 'Reinforced Hull I', desc: '+20% HP for all boats', cost: 60, category: 'All Ships', icon: '🛡' },
      { id: 'hull2', name: 'Reinforced Hull II', desc: '+40% HP for all boats', cost: 150, requires: 'hull1', category: 'All Ships', icon: '🛡' },
      { id: 'weapons1', name: 'Enhanced Cannons I', desc: '+15% damage for all boats', cost: 75, category: 'All Ships', icon: '💥' },
      { id: 'weapons2', name: 'Enhanced Cannons II', desc: '+30% damage for all boats', cost: 180, requires: 'weapons1', category: 'All Ships', icon: '💥' },
      { id: 'scout_vision', name: 'Scout Optics', desc: 'Scout vision range +50%', cost: 50, category: 'Scout', icon: '🔭' },
      { id: 'sub_stealth', name: 'Deep Stealth', desc: 'Submarine can dive closer to enemies before detection', cost: 90, category: 'Submarine', icon: '🌊' },
      { id: 'base_turret', name: 'Base Turrets', desc: 'Unlock defensive turret purchase for base', cost: 120, category: 'Base', icon: '🏰' },
      { id: 'income_boost', name: 'Trade Routes', desc: '+25% income from all islands', cost: 100, category: 'Economy', icon: '💰' },
    ];

    grid.innerHTML = '';
    for (const upg of upgrades) {
      const owned = state.upgrades[upg.id];
      const reqMet = !upg.requires || state.upgrades[upg.requires];
      const canAfford = state.upgradeCurrency >= upg.cost;
      const div = document.createElement('div');
      div.className = `upgrade-card ${owned ? 'owned' : reqMet && canAfford ? 'available' : 'locked-card'}`;
      div.innerHTML = `
        <div class="upg-icon">${upg.icon}</div>
        <div class="upg-cat">${upg.category}</div>
        <div class="upg-name">${upg.name}</div>
        <div class="upg-desc">${upg.desc}</div>
        <div class="upg-cost">${owned ? '✓ Owned' : `${upg.cost} ⚙`}</div>
        ${!owned && reqMet ? `<button class="btn-buy-upg ${canAfford ? '' : 'disabled'}" data-id="${upg.id}" data-cost="${upg.cost}">Buy</button>` : ''}
        ${upg.requires && !reqMet ? `<div class="upg-req">Requires: ${upgrades.find(u => u.id === upg.requires)?.name}</div>` : ''}
      `;
      grid.appendChild(div);
    }

    grid.querySelectorAll('.btn-buy-upg').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const cost = parseInt(btn.dataset.cost);
        const s = Storage.load();
        if (s.upgradeCurrency < cost || s.upgrades[id]) return;
        s.upgrades[id] = true;
        s.upgradeCurrency -= cost;
        Storage.save(s);
        setText('upgrade-currency-upgrades', s.upgradeCurrency);
        this._renderUpgrades();
      });
    });
  },

  _renderCaptains() {
    const content = document.getElementById('captains-content');
    if (!content) return;
    const state = Storage.load();

    content.innerHTML = `
      <div class="captains-info">
        <p>Assign captains to ships before battle to gain bonuses. More captains coming soon!</p>
      </div>
      <div class="captains-shop">
        <h3>Captain Shop</h3>
        <div class="captain-cards">
          <div class="captain-card">
            <div class="cap-art">⚓</div>
            <div class="cap-name">Admiral Thorne</div>
            <div class="cap-desc">+12% attack speed to assigned ship</div>
            <div class="cap-cost">100 ⚓</div>
            <button class="btn-cap ${state.captainCurrency >= 100 ? '' : 'disabled'}">Hire</button>
          </div>
          <div class="captain-card">
            <div class="cap-art">🧭</div>
            <div class="cap-name">Navigator Iris</div>
            <div class="cap-desc">+20% movement speed to assigned ship</div>
            <div class="cap-cost">120 ⚓</div>
            <button class="btn-cap ${state.captainCurrency >= 120 ? '' : 'disabled'}">Hire</button>
          </div>
          <div class="captain-card">
            <div class="cap-art">🔱</div>
            <div class="cap-name">Captain Dread</div>
            <div class="cap-desc">+15% damage, -10% HP to assigned ship</div>
            <div class="cap-cost">150 ⚓</div>
            <button class="btn-cap ${state.captainCurrency >= 150 ? '' : 'disabled'}">Hire</button>
          </div>
        </div>
      </div>
      <div class="captains-coming-soon"><p>⚓ Full captain system — assigning captains to boats, synergy bonuses, level-up during battle — coming in the next update!</p></div>
    `;
  },
};

function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}
