// ─── Base ────────────────────────────────────────────────────────────────────
class Base {
  constructor(x, y, team) {
    this.x = x;
    this.y = y;
    this.team = team;
    this.hp = CONFIG.MAIN_BASE_HP;
    this.maxHp = CONFIG.MAIN_BASE_HP;
    this.energy = 0;
    this.maxEnergy = CONFIG.MAIN_BASE_MAX_ENERGY;
    this.energyRegen = CONFIG.MAIN_BASE_ENERGY_REGEN;
    this.income = CONFIG.MAIN_BASE_INCOME;
    this.oil = CONFIG.MAIN_BASE_OIL;
    this.buildQueues = [[]]; // one queue per workshop slot
    this.extraWorkshops = 0;
    this.maxWorkshops = 2;
    this.size = 55;
    this.visionRange = 280;
    this.selected = false;
    this.lastShot = 0;
    this.defenses = []; // purchased turrets
    this.abilitySlots = [];
    this.abilityCooldowns = {};
  }

  get totalWorkshops() { return 1 + this.extraWorkshops; }

  addWorkshop() {
    if (this.extraWorkshops < this.maxWorkshops - 1) {
      this.extraWorkshops++;
      this.buildQueues.push([]);
    }
  }

  queueBuild(boatType, slotIndex = 0) {
    const queue = this.buildQueues[slotIndex];
    if (!queue || queue.length >= 5) return false;
    queue.push({ type: boatType, progress: 0 });
    return true;
  }

  update(dt, game) {
    this.energy = Math.min(this.maxEnergy, this.energy + this.energyRegen * dt);

    // Process build queues
    for (let s = 0; s < this.buildQueues.length; s++) {
      const queue = this.buildQueues[s];
      if (queue.length === 0) continue;
      const item = queue[0];
      const cfg = CONFIG.BOATS[item.type];
      const buildTime = cfg.buildTime * (game.ai && this.team === 'ai' ? game.ai.diffMult.buildMult : 1);
      item.progress += dt;
      if (item.progress >= buildTime) {
        queue.shift();
        const spawnX = this.x + (this.team === 'player' ? 1 : -1) * (this.size + 60 + Math.random() * 40);
        const spawnY = this.y + (Math.random() - 0.5) * 120;
        game.spawnBoat(item.type, this.team, spawnX, spawnY);
      }
    }
  }

  render(ctx, cam) {
    const sx = (this.x - cam.x) * cam.zoom;
    const sy = (this.y - cam.y) * cam.zoom;
    const sz = this.size * cam.zoom;

    ctx.save();
    ctx.translate(sx, sy);

    const col = this.team === 'player' ? '#1565c0' : '#b71c1c';
    const light = this.team === 'player' ? '#42a5f5' : '#ef5350';
    const dark = this.team === 'player' ? '#0d47a1' : '#7f0000';

    // Base platform
    ctx.fillStyle = col;
    ctx.strokeStyle = light;
    ctx.lineWidth = 2.5 * cam.zoom;
    ctx.beginPath();
    ctx.roundRect(-sz, -sz * 0.7, sz * 2, sz * 1.4, 8 * cam.zoom);
    ctx.fill();
    ctx.stroke();

    // Tower
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.roundRect(-sz * 0.35, -sz * 0.55, sz * 0.7, sz * 1.1, 6 * cam.zoom);
    ctx.fill();

    // Flag
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.moveTo(0, -sz * 0.55);
    ctx.lineTo(0, -sz * 1.05);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 * cam.zoom;
    ctx.stroke();
    ctx.fillStyle = this.team === 'player' ? '#bbdefb' : '#ffcdd2';
    ctx.fillRect(0, -sz * 1.05, sz * 0.3, sz * 0.18);

    // HP bar
    this.renderHpBar(ctx, cam, sz);

    if (this.selected) {
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2.5 * cam.zoom;
      ctx.setLineDash([6 * cam.zoom, 4 * cam.zoom]);
      ctx.beginPath();
      ctx.roundRect(-sz * 1.1, -sz * 0.85, sz * 2.2, sz * 1.7, 10 * cam.zoom);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  renderHpBar(ctx, cam, sz) {
    const bw = sz * 2.5;
    const bh = 6 * cam.zoom;
    const by = sz * 0.9;
    const ratio = this.hp / this.maxHp;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(-bw / 2, by, bw, bh);
    ctx.fillStyle = ratio > 0.5 ? '#4caf50' : ratio > 0.25 ? '#ff9800' : '#f44336';
    ctx.fillRect(-bw / 2, by, bw * ratio, bh);
  }
}

// ─── Island ──────────────────────────────────────────────────────────────────
class Island {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.team = 'neutral';
    this.stageIndex = 0;
    this.captureProgress = 0;
    this.capturingBoat = null;
    this.income = CONFIG.ISLAND_STAGES[0].income;
    this.oil = CONFIG.ISLAND_STAGES[0].oil;
    this.size = 38 + Math.random() * 16;
    this.selected = false;
    this.lastShot = 0;
    this.buildQueues = [[]];
    this.buildTime = 0;
    this.visionRange = 120;
    this.seed = Math.random() * 100;
    this.shape = this._genShape();
  }

  get stage() { return CONFIG.ISLAND_STAGES[this.stageIndex]; }
  get canBuild() { return this.stage.canBuild; }
  get canRepair() { return this.stage.canRepair; }
  get hasDefense() { return this.stage.hasDefense; }

  _genShape() {
    const pts = [];
    const n = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 0.75 + Math.random() * 0.35;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return pts;
  }

  update(dt, game) {
    if (this.capturingBoat) {
      const boat = this.capturingBoat;
      if (boat.hp <= 0) {
        this.capturingBoat = null;
        this.captureProgress = 0;
        return;
      }
      const dist = Math.hypot(boat.x - this.x, boat.y - this.y);
      if (dist > this.size + 20) {
        this.capturingBoat = null;
        this.captureProgress = 0;
        return;
      }
      this.captureProgress += dt;
      if (this.captureProgress >= CONFIG.ISLAND_CAPTURE_TIME) {
        this.team = boat.team;
        this.captureProgress = 0;
        this.capturingBoat = null;
        if (boat.team === 'player') game.stats.islandsCaptured++;
        this.stageIndex = 0;
        this.income = this.stage.income;
        this.oil = this.stage.oil;
      }
    }

    // Island defense
    if (this.hasDefense && this.team !== 'neutral') {
      const now = performance.now() / 1000;
      if (now - this.lastShot >= 1 / CONFIG.ISLAND_DEFENSE_RATE) {
        const enemy = game.boats.find(b =>
          b.team !== this.team && b.hp > 0 &&
          !(b.type === 'submarine' && b.state === 'submerged') &&
          Math.hypot(b.x - this.x, b.y - this.y) <= CONFIG.ISLAND_DEFENSE_RANGE
        );
        if (enemy) {
          this.lastShot = now;
          game.projectiles.push(new Projectile(
            this.x, this.y, enemy,
            CONFIG.ISLAND_DEFENSE_DAMAGE, this.team, 'cannon', true
          ));
        }
      }
    }

    // Repair nearby friendly boats
    if (this.canRepair && this.team !== 'neutral') {
      for (const boat of game.boats) {
        if (boat.team !== this.team || boat.hp >= boat.maxHp) continue;
        if (Math.hypot(boat.x - this.x, boat.y - this.y) <= this.size + 30) {
          boat.hp = Math.min(boat.maxHp, boat.hp + 15 * dt);
        }
      }
    }

    // Build queue
    if (this.canBuild && this.team !== 'neutral' && this.buildQueues[0].length > 0) {
      const item = this.buildQueues[0][0];
      const cfg = CONFIG.BOATS[item.type];
      item.progress += dt;
      if (item.progress >= cfg.buildTime) {
        this.buildQueues[0].shift();
        const angle = Math.random() * Math.PI * 2;
        game.spawnBoat(item.type, this.team, this.x + Math.cos(angle) * (this.size + 50), this.y + Math.sin(angle) * (this.size + 50));
      }
    }
  }

  upgrade(game) {
    if (this.stageIndex >= CONFIG.ISLAND_STAGES.length - 1) return false;
    const nextStage = CONFIG.ISLAND_STAGES[this.stageIndex + 1];
    if (game.playerGold < nextStage.upgradeCost) return false;
    game.playerGold -= nextStage.upgradeCost;
    this.stageIndex++;
    this.income = this.stage.income;
    this.oil = this.stage.oil;
    if (this.stageIndex >= 2) this.buildQueues = [[]];
    return true;
  }

  render(ctx, cam) {
    const sx = (this.x - cam.x) * cam.zoom;
    const sy = (this.y - cam.y) * cam.zoom;
    const sz = this.size * cam.zoom;

    ctx.save();
    ctx.translate(sx, sy);

    // Island base
    ctx.beginPath();
    const pts = this.shape;
    ctx.moveTo(pts[0].x * sz, pts[0].y * sz);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * sz, pts[i].y * sz);
    ctx.closePath();

    const terrainColor = this.team === 'neutral' ? '#5d4037' :
      this.team === 'player' ? '#2e7d32' : '#7f0000';
    ctx.fillStyle = terrainColor;
    ctx.fill();
    ctx.strokeStyle = '#795548';
    ctx.lineWidth = 1.5 * cam.zoom;
    ctx.stroke();

    // Stage indicator
    if (this.stageIndex > 0) {
      ctx.fillStyle = this.team === 'player' ? '#a5d6a7' : '#ef9a9a';
      ctx.font = `bold ${10 * cam.zoom}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.stage.name, 0, 0);
    }

    // Capture bar
    if (this.capturingBoat) {
      const ratio = this.captureProgress / CONFIG.ISLAND_CAPTURE_TIME;
      const bw = sz * 1.8;
      ctx.fillStyle = '#111';
      ctx.fillRect(-bw / 2, sz + 4 * cam.zoom, bw, 6 * cam.zoom);
      ctx.fillStyle = this.capturingBoat.team === 'player' ? '#42a5f5' : '#ef5350';
      ctx.fillRect(-bw / 2, sz + 4 * cam.zoom, bw * ratio, 6 * cam.zoom);
    }

    // Defense indicator
    if (this.hasDefense) {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 2 * cam.zoom;
      ctx.beginPath();
      ctx.arc(0, 0, CONFIG.ISLAND_DEFENSE_RANGE * cam.zoom, 0, Math.PI * 2);
      ctx.setLineDash([4 * cam.zoom, 4 * cam.zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.selected) {
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2 * cam.zoom;
      ctx.setLineDash([5 * cam.zoom, 3 * cam.zoom]);
      ctx.beginPath();
      ctx.arc(0, 0, sz + 6 * cam.zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }
}

// ─── Boat ─────────────────────────────────────────────────────────────────────
class Boat {
  constructor(type, team, x, y) {
    this.id = Math.random().toString(36).slice(2);
    this.type = type;
    this.team = team;
    this.x = x;
    this.y = y;
    const cfg = CONFIG.BOATS[type];
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.speed = cfg.speed;
    this.attackRange = cfg.attackRange;
    this.attackDamage = cfg.attackDamage;
    this.attackRate = cfg.attackRate;
    this.visionRange = cfg.visionRange;
    this.size = cfg.size;
    this.damageType = cfg.damageType;
    this.armorType = cfg.armorType;
    this.canCapture = cfg.canCapture;

    this.angle = team === 'player' ? 0 : Math.PI;
    this.vx = 0;
    this.vy = 0;

    this.target = null;
    this.moveTarget = null;
    this.attackTarget = null;
    this.state = 'idle'; // idle | moving | attacking | capturing | submerged

    this.lastAttack = 0;
    this.lastRepair = 0;

    this.selected = false;
    this.fleetGroup = null;

    this.abilityCooldown = 0;
    this.abilityActive = false;
    this.abilityTimer = 0;
    this.abilityEffect = {};

    this.captureTarget = null;

    this.isScrap = false;
    this.dead = false;
  }

  get cfg() { return CONFIG.BOATS[this.type]; }

  useAbility(game) {
    if (this.abilityCooldown > 0 || this.abilityActive) return;
    const ability = this.cfg.ability;
    if (!ability) return;

    this.abilityActive = true;
    this.abilityTimer = ability.duration;
    this.abilityCooldown = ability.cooldown;

    if (ability.id === 'lookout') {
      this.abilityEffect = { visionBoost: this.visionRange * 0.8 };
      this.visionRange += this.abilityEffect.visionBoost;
    } else if (ability.id === 'cannonade') {
      this.abilityEffect = { extraShots: 4, shotsFired: 0, shotTimer: 0 };
    } else if (ability.id === 'armorPlating') {
      this.abilityEffect = { damageReduction: 0.5 };
    } else if (ability.id === 'dive') {
      this.state = 'submerged';
      this.abilityEffect = {};
    }
  }

  update(dt, game) {
    if (this.dead) return;

    // Ability timers
    if (this.abilityCooldown > 0) this.abilityCooldown = Math.max(0, this.abilityCooldown - dt);
    if (this.abilityActive) {
      this.abilityTimer -= dt;
      const ability = this.cfg.ability;

      if (ability.id === 'cannonade' && this.abilityEffect.extraShots > this.abilityEffect.shotsFired) {
        this.abilityEffect.shotTimer -= dt;
        if (this.abilityEffect.shotTimer <= 0 && this.attackTarget && this.attackTarget.hp > 0) {
          this.abilityEffect.shotTimer = 0.5;
          this.abilityEffect.shotsFired++;
          this._fireAt(this.attackTarget, game);
        }
      }

      if (this.abilityTimer <= 0) {
        this.abilityActive = false;
        if (ability.id === 'lookout' && this.abilityEffect.visionBoost) {
          this.visionRange -= this.abilityEffect.visionBoost;
        }
        if (ability.id === 'dive') {
          this.state = 'idle';
        }
        this.abilityEffect = {};
      }
    }

    // Movement
    if (this.moveTarget && this.state !== 'submerged') {
      const dx = this.moveTarget.x - this.x;
      const dy = this.moveTarget.y - this.y;
      const dist = Math.hypot(dx, dy);
      const arrivalRadius = this.attackTarget ? this.attackRange * 0.85 : 15;

      if (dist <= arrivalRadius) {
        this.vx = 0;
        this.vy = 0;
        if (!this.attackTarget && !this.captureTarget) {
          this.state = 'idle';
          this.moveTarget = null;
        }
      } else {
        const spd = this.speed * (game.activeStorm ? CONFIG.STORM_SPEED_MULT : 1);
        this.vx = (dx / dist) * spd;
        this.vy = (dy / dist) * spd;
        this.angle = Math.atan2(dy, dx);
        this.state = 'moving';
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Clamp to map
    this.x = Math.max(20, Math.min(CONFIG.MAP_WIDTH - 20, this.x));
    this.y = Math.max(20, Math.min(CONFIG.MAP_HEIGHT - 20, this.y));

    // Auto-attack
    if (this.state !== 'submerged' && this.state !== 'capturing') {
      this._handleCombat(dt, game);
    }

    // Island capture
    if (this.captureTarget && this.state !== 'submerged') {
      const island = this.captureTarget;
      const dist = Math.hypot(this.x - island.x, this.y - island.y);
      if (dist <= island.size + 15) {
        if (island.team !== this.team) {
          island.capturingBoat = this;
          this.state = 'capturing';
          this.vx = 0;
          this.vy = 0;
        } else {
          this.captureTarget = null;
          this.state = 'idle';
        }
      }
    }
  }

  _handleCombat(dt, game) {
    const now = performance.now() / 1000;

    // Find attack target if none
    if (!this.attackTarget || this.attackTarget.hp <= 0 || this.attackTarget.dead) {
      this.attackTarget = this._findNearestEnemy(game);
    }

    if (!this.attackTarget) {
      if (!this.moveTarget) this.state = 'idle';
      return;
    }

    const enemy = this.attackTarget;
    const dist = Math.hypot(this.x - enemy.x, this.y - enemy.y);

    if (dist <= this.attackRange) {
      if (this.moveTarget && !this.captureTarget) {
        const mdist = Math.hypot(this.moveTarget.x - this.x, this.moveTarget.y - this.y);
        if (mdist < 20) { this.moveTarget = null; }
      }

      // Attack
      const rate = this.attackRate * (game.activeStorm ? 0.7 : 1);
      if (now - this.lastAttack >= 1 / rate) {
        this.lastAttack = now;
        this._fireAt(enemy, game);
        this.state = 'attacking';
      }
    } else if (!this.moveTarget) {
      // Chase
      this.moveTarget = { x: enemy.x, y: enemy.y };
    }
  }

  _findNearestEnemy(game) {
    let best = null, bestDist = Infinity;
    const entities = [...game.boats, game.getEnemyBase(this.team)].filter(Boolean);
    for (const e of entities) {
      if (!e || e.team === this.team || e.hp <= 0) continue;
      if (e instanceof Boat && e.state === 'submerged') continue;
      const dist = Math.hypot(this.x - e.x, this.y - e.y);
      if (dist < this.visionRange && dist < bestDist) {
        best = e;
        bestDist = dist;
      }
    }
    return best;
  }

  _fireAt(target, game) {
    const dmgMult = CONFIG.DAMAGE_MULT[this.damageType]?.[target.armorType] ?? 1;
    const dmg = this.attackDamage * dmgMult * (this.abilityEffect.damageReduction ? 0 : 1);
    let actualDmg = dmg;
    if (target.abilityEffect?.damageReduction) actualDmg *= (1 - target.abilityEffect.damageReduction);
    game.projectiles.push(new Projectile(this.x, this.y, target, actualDmg, this.team, this.damageType, false));
    if (this.team === 'player') game.stats.damageDealt += actualDmg;
  }

  moveTo(x, y) {
    this.moveTarget = { x, y };
    this.attackTarget = null;
    this.captureTarget = null;
    if (this.state === 'capturing' && this.captureTarget) {
      this.captureTarget.capturingBoat = null;
      this.captureTarget.captureProgress = 0;
    }
    this.state = 'moving';
  }

  attackMove(target) {
    this.attackTarget = target;
    if (target instanceof Base || target instanceof Island) {
      this.moveTarget = { x: target.x, y: target.y };
    } else {
      this.moveTarget = { x: target.x, y: target.y };
    }
    this.state = 'moving';
  }

  captureIsland(island) {
    if (!this.canCapture) return;
    if (island.team === this.team) return;
    this.captureTarget = island;
    this.attackTarget = null;
    this.moveTarget = { x: island.x, y: island.y };
    this.state = 'moving';
  }

  render(ctx, cam) {
    if (this.dead) return;

    const sx = (this.x - cam.x) * cam.zoom;
    const sy = (this.y - cam.y) * cam.zoom;
    const sc = cam.zoom;

    // Submerged: only show faint periscope to own team (handled in fog logic)
    const alpha = this.state === 'submerged' ? 0.35 : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(sx, sy);
    ctx.rotate(this.angle);

    const teamCol = this.team === 'player' ? '#4fc3f7' : '#ef5350';
    const teamDark = this.team === 'player' ? '#0d47a1' : '#7f0000';
    const sz = this.size * sc;

    if (this.type === 'scout') {
      ctx.fillStyle = teamCol;
      ctx.beginPath();
      ctx.moveTo(sz * 1.9, 0);
      ctx.lineTo(-sz, sz * 0.55);
      ctx.lineTo(-sz * 0.65, 0);
      ctx.lineTo(-sz, -sz * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = teamDark;
      ctx.lineWidth = 1.2 * sc;
      ctx.stroke();
      ctx.fillStyle = teamDark;
      ctx.fillRect(sz * 0.3, -1.5 * sc, sz * 0.9, 3 * sc);

    } else if (this.type === 'smallBattlecruiser') {
      ctx.fillStyle = teamCol;
      ctx.beginPath();
      ctx.moveTo(sz * 1.6, 0);
      ctx.lineTo(sz * 0.6, -sz * 0.75);
      ctx.lineTo(-sz * 1.1, -sz * 0.75);
      ctx.lineTo(-sz * 1.5, 0);
      ctx.lineTo(-sz * 1.1, sz * 0.75);
      ctx.lineTo(sz * 0.6, sz * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = teamDark;
      ctx.lineWidth = 1.5 * sc;
      ctx.stroke();
      // Turrets
      ctx.fillStyle = teamDark;
      ctx.beginPath(); ctx.arc(sz * 0.35, 0, sz * 0.38, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-sz * 0.45, 0, sz * 0.32, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(sz * 0.35, -2 * sc, sz, 4 * sc);
      ctx.fillRect(-sz * 0.45, -2 * sc, sz * 0.9, 4 * sc);

    } else if (this.type === 'mediumBattlecruiser') {
      ctx.fillStyle = teamCol;
      ctx.beginPath();
      ctx.moveTo(sz * 1.7, 0);
      ctx.lineTo(sz * 0.9, -sz * 0.9);
      ctx.lineTo(-sz * 1.4, -sz * 0.9);
      ctx.lineTo(-sz * 1.85, 0);
      ctx.lineTo(-sz * 1.4, sz * 0.9);
      ctx.lineTo(sz * 0.9, sz * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = teamDark;
      ctx.lineWidth = 2 * sc;
      ctx.stroke();
      // Superstructure
      ctx.fillStyle = teamDark;
      ctx.fillRect(-sz * 0.3, -sz * 0.5, sz * 0.6, sz);
      // Three turrets
      [sz * 0.8, 0, -sz * 0.9].forEach((tx) => {
        ctx.beginPath(); ctx.arc(tx, 0, sz * 0.38, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(tx, -2.5 * sc, sz * 1.05, 5 * sc);
      });

    } else if (this.type === 'submarine') {
      const subCol = this.team === 'player' ? '#37474f' : '#4a0000';
      ctx.fillStyle = subCol;
      ctx.beginPath();
      ctx.ellipse(0, 0, sz * 2.1, sz * 0.52, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this.team === 'player' ? '#546e7a' : '#7f0000';
      ctx.lineWidth = 1.5 * sc;
      ctx.stroke();
      ctx.fillStyle = this.team === 'player' ? '#455a64' : '#5c0000';
      ctx.fillRect(-sz * 0.15, -sz * 0.52, sz * 0.45, sz * 0.38);
      if (this.state === 'submerged') {
        ctx.strokeStyle = this.team === 'player' ? '#80cbc4' : '#ff6b6b';
        ctx.lineWidth = 2 * sc;
        ctx.beginPath();
        ctx.moveTo(sz * 0.15, -sz * 0.52);
        ctx.lineTo(sz * 0.15, -sz * 1.1);
        ctx.lineTo(sz * 0.5, -sz * 1.1);
        ctx.stroke();
      }
    }

    ctx.restore();
    ctx.globalAlpha = 1;

    // Ability active glow
    if (this.abilityActive && this.state !== 'submerged') {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.strokeStyle = '#ffe082';
      ctx.lineWidth = 2.5 * cam.zoom;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, this.size * 1.7 * cam.zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Selection ring
    if (this.selected) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2 * cam.zoom;
      ctx.setLineDash([5 * cam.zoom, 3 * cam.zoom]);
      ctx.beginPath();
      ctx.arc(0, 0, this.size * 1.75 * cam.zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // HP bar
    if (this.state !== 'submerged' || this.team === 'player') {
      const bw = this.size * 3 * cam.zoom;
      const bh = Math.max(3, 4 * cam.zoom);
      const bx = sx - bw / 2;
      const by = sy - (this.size * 2.3 * cam.zoom);
      const ratio = this.hp / this.maxHp;
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = ratio > 0.5 ? '#4caf50' : ratio > 0.25 ? '#ff9800' : '#f44336';
      ctx.fillRect(bx, by, bw * ratio, bh);
    }
  }
}

// ─── Projectile ──────────────────────────────────────────────────────────────
class Projectile {
  constructor(x, y, target, damage, team, dmgType, fromIsland) {
    this.x = x;
    this.y = y;
    this.target = target;
    this.damage = damage;
    this.team = team;
    this.dmgType = dmgType;
    this.fromIsland = fromIsland;
    this.speed = dmgType === 'torpedo' ? 200 : 380;
    this.dead = false;
    const dx = target.x - x;
    const dy = target.y - y;
    const dist = Math.hypot(dx, dy);
    this.vx = (dx / dist) * this.speed;
    this.vy = (dy / dist) * this.speed;
    this.size = dmgType === 'torpedo' ? 5 : 3;
    this.color = dmgType === 'torpedo' ? '#80cbc4' :
      team === 'player' ? '#fff59d' : '#ffcc02';
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const dist = Math.hypot(this.x - this.target.x, this.y - this.target.y);
    if (dist < 12) {
      this.hit();
    }
  }

  hit() {
    if (this.dead) return;
    this.dead = true;
    if (this.target.hp !== undefined) {
      this.target.hp = Math.max(0, this.target.hp - this.damage);
    }
  }

  render(ctx, cam) {
    if (this.dead) return;
    const sx = (this.x - cam.x) * cam.zoom;
    const sy = (this.y - cam.y) * cam.zoom;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(sx, sy, this.size * cam.zoom, 0, Math.PI * 2);
    ctx.fill();
    if (this.dmgType === 'torpedo') {
      ctx.strokeStyle = '#b2dfdb';
      ctx.lineWidth = 1 * cam.zoom;
      ctx.stroke();
    }
  }
}

// ─── Scrap ────────────────────────────────────────────────────────────────────
class Scrap {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.lifetime = CONFIG.SCRAP_LIFETIME;
    this.value = CONFIG.SCRAP_VALUE;
    this.collected = false;
    this.size = 10;
  }

  update(dt) {
    this.lifetime -= dt;
  }

  render(ctx, cam) {
    if (this.collected || this.lifetime <= 0) return;
    const sx = (this.x - cam.x) * cam.zoom;
    const sy = (this.y - cam.y) * cam.zoom;
    const alpha = Math.min(1, this.lifetime / 2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 1.5 * cam.zoom;
    ctx.setLineDash([3 * cam.zoom, 2 * cam.zoom]);
    ctx.beginPath();
    ctx.arc(sx, sy, this.size * cam.zoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fffde7';
    ctx.font = `${9 * cam.zoom}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', sx, sy);
    ctx.restore();
  }
}
