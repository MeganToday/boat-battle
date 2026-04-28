class AI {
  constructor(game, difficultyIndex) {
    this.game = game;
    this.difficultyIndex = Math.max(0, Math.min(6, difficultyIndex));
    this.diffMult = CONFIG.DIFFICULTY_MULT[this.difficultyIndex];
    this.decisionTimer = 0;
    this.decisionInterval = 2.5 - this.difficultyIndex * 0.25;
    this.aggressionTimer = this.diffMult.aggressionDelay;
    this.expansionTimer = 8;
    this.state = 'building'; // building | expanding | attacking | defending
    this.targetIsland = null;
    this.attackTarget = null;
  }

  get boats() { return this.game.boats.filter(b => b.team === 'ai' && b.hp > 0 && !b.dead); }
  get base() { return this.game.aiBase; }
  get playerBase() { return this.game.playerBase; }

  update(dt) {
    this.decisionTimer -= dt;
    this.aggressionTimer -= dt;
    this.expansionTimer -= dt;

    // Auto-build
    this._autoBuild();

    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.decisionInterval;
      this._decide();
    }

    // Execute orders
    this._executeOrders(dt);
  }

  _autoBuild() {
    const base = this.base;
    const myBoats = this.boats;
    const oilUsed = myBoats.reduce((s, b) => s + CONFIG.BOATS[b.type].oilCost, 0);
    const oilCap = this.game.calcOilSupply('ai');

    // Each workshop queue independently
    for (let s = 0; s < base.buildQueues.length; s++) {
      const queue = base.buildQueues[s];
      if (queue.length >= 3) continue;

      const availOil = oilCap - oilUsed;
      const strategy = this.diffMult.strategyScore;

      // Pick build type based on strategy score
      let boatType;
      const rand = Math.random();
      if (strategy < 0.3) {
        boatType = rand < 0.7 ? 'scout' : 'smallBattlecruiser';
      } else if (strategy < 0.6) {
        boatType = rand < 0.3 ? 'scout' : rand < 0.7 ? 'smallBattlecruiser' : 'mediumBattlecruiser';
      } else {
        boatType = rand < 0.15 ? 'scout' : rand < 0.45 ? 'smallBattlecruiser' :
          rand < 0.75 ? 'mediumBattlecruiser' : 'submarine';
      }

      const cfg = CONFIG.BOATS[boatType];
      if (availOil >= cfg.oilCost) {
        base.queueBuild(boatType, s);
      }
    }

    // Buy extra workshop if beneficial
    if (base.extraWorkshops < base.maxWorkshops - 1 && this.game.aiGold > 300) {
      base.addWorkshop();
      this.game.aiGold -= 200;
    }
  }

  _decide() {
    const myBoats = this.boats;
    const combatBoats = myBoats.filter(b => b.type !== 'scout');
    const playerBoats = this.game.boats.filter(b => b.team === 'player' && b.hp > 0 && !b.dead);

    // Check if under attack
    const baseUnderAttack = playerBoats.some(b =>
      Math.hypot(b.x - this.base.x, b.y - this.base.y) < 500
    );

    if (baseUnderAttack && combatBoats.length > 0) {
      this.state = 'defending';
    } else if (this.aggressionTimer <= 0 && combatBoats.length >= 3) {
      this.state = 'attacking';
    } else if (this.expansionTimer <= 0) {
      this.state = 'expanding';
      this.expansionTimer = 20 - this.difficultyIndex * 2;
    } else {
      this.state = 'building';
    }

    // Pick island to expand to
    if (this.state === 'expanding') {
      const neutralOrPlayer = this.game.islands.filter(i => i.team !== 'ai');
      if (neutralOrPlayer.length > 0) {
        neutralOrPlayer.sort((a, b) =>
          Math.hypot(a.x - this.base.x, a.y - this.base.y) -
          Math.hypot(b.x - this.base.x, b.y - this.base.y)
        );
        this.targetIsland = neutralOrPlayer[0];
      }
    }

    // Pick attack target
    if (this.state === 'attacking') {
      if (this.diffMult.strategyScore > 0.6 && playerBoats.length > 0) {
        // Smart: attack player boats first
        playerBoats.sort((a, b) => a.hp - b.hp);
        this.attackTarget = playerBoats[0];
      } else {
        // Dumb: just rush the base
        this.attackTarget = this.playerBase;
      }
    }
  }

  _executeOrders(dt) {
    const myBoats = this.boats;
    const combatBoats = myBoats.filter(b => b.type !== 'scout');
    const scouts = myBoats.filter(b => b.type === 'scout');

    // Scouts patrol
    for (const scout of scouts) {
      if (scout.state === 'idle' || !scout.moveTarget) {
        const px = CONFIG.MAP_WIDTH / 2 + (Math.random() - 0.5) * CONFIG.MAP_WIDTH * 0.4;
        const py = (Math.random()) * CONFIG.MAP_HEIGHT;
        scout.moveTarget = { x: Math.max(100, Math.min(CONFIG.MAP_WIDTH - 100, px)), y: Math.max(100, Math.min(CONFIG.MAP_HEIGHT - 100, py)) };
        scout.state = 'moving';
      }
    }

    if (this.state === 'expanding' && this.targetIsland) {
      const capableBoats = combatBoats.filter(b => b.canCapture && b.state === 'idle');
      if (capableBoats.length > 0) {
        capableBoats[0].captureIsland(this.targetIsland);
      }
    }

    if (this.state === 'attacking' && this.attackTarget) {
      const target = this.attackTarget;
      if (target.hp <= 0 || target.dead) {
        this.attackTarget = null;
        this.aggressionTimer = this.diffMult.aggressionDelay * 0.5;
        this.state = 'building';
        return;
      }
      const attackers = combatBoats.filter(b => b.state === 'idle' || b.state === 'moving');
      for (const boat of attackers) {
        boat.attackMove(target);
      }
    }

    if (this.state === 'defending') {
      const defenders = combatBoats.filter(b => !b.captureTarget);
      for (const boat of defenders) {
        boat.moveTarget = { x: this.base.x + (Math.random() - 0.5) * 200, y: this.base.y + (Math.random() - 0.5) * 200 };
        boat.state = 'moving';
      }
    }

    // AI occasionally uses abilities
    if (Math.random() < 0.02 * this.diffMult.strategyScore) {
      const candidates = combatBoats.filter(b => b.abilityCooldown <= 0 && !b.abilityActive);
      if (candidates.length > 0) {
        candidates[Math.floor(Math.random() * candidates.length)].useAbility(this.game);
      }
    }
  }
}
