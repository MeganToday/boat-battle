class Game {
  constructor(canvas, mode, difficultyIndex, practiceDifficulty) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = mode;
    this.difficultyIndex = difficultyIndex;
    this.practiceDifficulty = practiceDifficulty || 'medium';

    this.mapW = CONFIG.MAP_WIDTH;
    this.mapH = CONFIG.MAP_HEIGHT;

    this.cam = { x: 0, y: CONFIG.MAP_HEIGHT / 2 - 400, zoom: CONFIG.ZOOM_DEFAULT };

    this.playerBase = null;
    this.aiBase = null;
    this.islands = [];
    this.boats = [];
    this.projectiles = [];
    this.scraps = [];

    this.playerGold = CONFIG.STARTING_GOLD;
    this.aiGold = CONFIG.STARTING_GOLD;
    this.incomeTimer = 0;

    this.activeStorm = null;
    this.weatherTimer = CONFIG.WEATHER_INTERVAL_MIN + Math.random() * (CONFIG.WEATHER_INTERVAL_MAX - CONFIG.WEATHER_INTERVAL_MIN);
    this.stormX = 0;
    this.stormY = 0;
    this.stormRadius = 600;
    this.stormTimeLeft = 0;

    this.selectedUnits = [];
    this.selectedBuilding = null;
    this.fleetGroups = { 1: [], 2: [], 3: [], 4: [], 5: [] };

    this.boxSelect = { active: false, sx: 0, sy: 0, ex: 0, ey: 0 };
    this.keys = {};
    this.mouse = { x: 0, y: 0, worldX: 0, worldY: 0, down: false };
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.rightClickHeld = false;

    this.phase = 'playing';
    this.winner = null;
    this.gameTime = 0;
    this.lastTime = null;

    this.stats = {
      boatsSunk: 0,
      boatsLost: 0,
      damageDealt: 0,
      islandsCaptured: 0,
      goldEarned: CONFIG.STARTING_GOLD,
    };

    this.ai = null;
    this.fogCanvas = document.createElement('canvas');
    this.fogCtx = this.fogCanvas.getContext('2d');

    this.waveOffset = 0;
    this._init();
  }

  _init() {
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._generateMap();

    const diffIdx = this.mode === 'practice'
      ? { easy: 0, medium: 2, hard: 4 }[this.practiceDifficulty]
      : this.difficultyIndex;
    this.ai = new AI(this, diffIdx);
    if (this.mode === 'practice') {
      this.ai.diffMult = CONFIG.PRACTICE_DIFFICULTY[this.practiceDifficulty];
    }

    this._setupInput();
    requestAnimationFrame((t) => this._loop(t));
  }

  _resize() {
    const hudH = 110;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight - hudH;
    this.fogCanvas.width = this.canvas.width;
    this.fogCanvas.height = this.canvas.height;
  }

  _generateMap() {
    this.playerBase = new Base(320, this.mapH / 2, 'player');
    this.aiBase = new Base(this.mapW - 320, this.mapH / 2, 'ai');

    this.islands = [];
    const playerSide = [];

    for (let i = 0; i < 4; i++) {
      let x, y, valid = false, tries = 0;
      while (!valid && tries++ < 80) {
        x = 600 + Math.random() * (this.mapW / 2 - 900);
        y = 200 + Math.random() * (this.mapH - 400);
        valid = this._validIslandPos(x, y, playerSide);
      }
      if (valid) {
        const isl = new Island(x, y);
        playerSide.push(isl);
        this.islands.push(isl);
      }
    }

    for (const isl of playerSide) {
      const mirX = this.mapW - isl.x + (Math.random() - 0.5) * 180;
      const mirY = isl.y + (Math.random() - 0.5) * 200;
      const cx = Math.max(this.mapW / 2 + 200, Math.min(this.mapW - 600, mirX));
      const cy = Math.max(200, Math.min(this.mapH - 200, mirY));
      this.islands.push(new Island(cx, cy));
    }

    // Player starting boats
    this.spawnBoat('scout', 'player', 560, this.mapH / 2 - 110);
    this.spawnBoat('scout', 'player', 560, this.mapH / 2 + 110);
    this.spawnBoat('mediumBattlecruiser', 'player', 520, this.mapH / 2);

    // AI starting boats
    this.spawnBoat('scout', 'ai', this.mapW - 560, this.mapH / 2 - 110);
    this.spawnBoat('scout', 'ai', this.mapW - 560, this.mapH / 2 + 110);
    this.spawnBoat('mediumBattlecruiser', 'ai', this.mapW - 520, this.mapH / 2);

    // Center camera on player base
    this.cam.x = this.playerBase.x - this.canvas.width / (2 * this.cam.zoom);
    this.cam.y = this.playerBase.y - this.canvas.height / (2 * this.cam.zoom);
  }

  _validIslandPos(x, y, existing) {
    if (Math.hypot(x - this.playerBase.x, y - this.playerBase.y) < 450) return false;
    if (Math.hypot(x - this.aiBase.x, y - this.aiBase.y) < 450) return false;
    for (const isl of existing) {
      if (Math.hypot(x - isl.x, y - isl.y) < 420) return false;
    }
    return true;
  }

  spawnBoat(type, team, x, y) {
    const boat = new Boat(type, team, x, y);
    this.boats.push(boat);
    return boat;
  }

  getEnemyBase(team) {
    return team === 'player' ? this.aiBase : this.playerBase;
  }

  calcOilSupply(team) {
    const base = team === 'player' ? this.playerBase : this.aiBase;
    let oil = base.oil;
    for (const isl of this.islands) {
      if (isl.team === team) oil += isl.oil;
    }
    return oil;
  }

  calcOilUsed(team) {
    return this.boats
      .filter(b => b.team === team && b.hp > 0 && !b.dead)
      .reduce((s, b) => s + CONFIG.BOATS[b.type].oilCost, 0);
  }

  canAffordBoat(type) {
    const cfg = CONFIG.BOATS[type];
    const oilCap = this.calcOilSupply('player');
    const oilUsed = this.calcOilUsed('player');
    return this.playerGold >= cfg.cost && (oilCap - oilUsed) >= cfg.oilCost;
  }

  // ─── Loop ────────────────────────────────────────────────────────────────
  _loop(timestamp) {
    if (this.phase === 'ended') return;
    if (this.lastTime === null) this.lastTime = timestamp;
    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.1);
    this.lastTime = timestamp;

    this._update(dt);
    this._render();

    requestAnimationFrame((t) => this._loop(t));
  }

  _update(dt) {
    this.gameTime += dt;
    this.waveOffset += dt * 0.4;

    // Camera pan
    const ps = CONFIG.PAN_SPEED * dt / this.cam.zoom;
    if (this.keys['ArrowLeft'] || this.keys['a']) this.cam.x -= ps;
    if (this.keys['ArrowRight'] || this.keys['d']) this.cam.x += ps;
    if (this.keys['ArrowUp'] || this.keys['w']) this.cam.y -= ps;
    if (this.keys['ArrowDown'] || this.keys['s']) this.cam.y += ps;
    this._clampCamera();

    // Income tick
    this.incomeTimer += dt;
    if (this.incomeTimer >= 1) {
      this.incomeTimer -= 1;
      this._tickIncome();
    }

    // Weather
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0 && !this.activeStorm) {
      this._startStorm();
    }
    if (this.activeStorm) {
      this.stormTimeLeft -= dt;
      if (this.stormTimeLeft <= 0) this._endStorm();
    }

    // Update entities
    this.playerBase.update(dt, this);
    this.aiBase.update(dt, this);

    for (const isl of this.islands) isl.update(dt, this);

    const alive = [];
    for (const boat of this.boats) {
      boat.update(dt, this);
      if (boat.hp <= 0 && !boat.dead) {
        boat.dead = true;
        this.scraps.push(new Scrap(boat.x + (Math.random() - 0.5) * 30, boat.y + (Math.random() - 0.5) * 30));
        if (boat.team === 'player') this.stats.boatsLost++;
        else this.stats.boatsSunk++;
        if (boat.captureTarget) {
          boat.captureTarget.capturingBoat = null;
          boat.captureTarget.captureProgress = 0;
        }
      }
      if (!boat.dead) alive.push(boat);
    }
    this.boats = alive;

    const alivePrj = [];
    for (const p of this.projectiles) {
      p.update(dt);
      if (!p.dead) alivePrj.push(p);
    }
    this.projectiles = alivePrj;

    const aliveScrap = [];
    for (const sc of this.scraps) {
      sc.update(dt);
      if (!sc.collected && sc.lifetime > 0) {
        // Check if player support ship (scout) is nearby
        for (const boat of this.boats) {
          if (boat.team === 'player' && Math.hypot(boat.x - sc.x, boat.y - sc.y) < 40) {
            sc.collected = true;
            this.playerGold += sc.value;
            this.stats.goldEarned += sc.value;
            break;
          }
        }
        aliveScrap.push(sc);
      }
    }
    this.scraps = aliveScrap;

    // AI gold
    this.aiGold += this._calcAiIncome() * dt;

    // AI update
    if (this.ai) this.ai.update(dt);

    // Win/loss
    if (this.aiBase.hp <= 0) this._endGame('player');
    else if (this.playerBase.hp <= 0) this._endGame('ai');

    // Update HUD
    if (window.HUD) HUD.update(this);
  }

  _tickIncome() {
    let playerIncome = this.playerBase.income;
    let aiIncome = this.aiBase.income;
    for (const isl of this.islands) {
      if (isl.team === 'player') playerIncome += isl.income;
      else if (isl.team === 'ai') aiIncome += isl.income;
    }
    this.playerGold += playerIncome;
    this.stats.goldEarned += playerIncome;
    this.aiGold += aiIncome;
  }

  _calcAiIncome() {
    let inc = this.aiBase.income;
    for (const isl of this.islands) {
      if (isl.team === 'ai') inc += isl.income;
    }
    return inc;
  }

  _startStorm() {
    this.activeStorm = true;
    this.stormX = Math.random() * this.mapW;
    this.stormY = Math.random() * this.mapH;
    this.stormRadius = 600 + Math.random() * 400;
    this.stormTimeLeft = CONFIG.STORM_DURATION;
    this.weatherTimer = CONFIG.WEATHER_INTERVAL_MIN + Math.random() * (CONFIG.WEATHER_INTERVAL_MAX - CONFIG.WEATHER_INTERVAL_MIN);
    const indicator = document.getElementById('weather-indicator');
    if (indicator) { indicator.classList.remove('hidden'); indicator.textContent = '🌩 Storm Active'; }
  }

  _endStorm() {
    this.activeStorm = false;
    const indicator = document.getElementById('weather-indicator');
    if (indicator) indicator.classList.add('hidden');
  }

  _endGame(winner) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.winner = winner;
    if (window.Menu) Menu.showPostMatch(this);
  }

  surrender() {
    this._endGame('ai');
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  _render() {
    const ctx = this.ctx;
    const cam = this.cam;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this._renderOcean(ctx, cam);
    this._renderIslands(ctx, cam);
    this._renderBases(ctx, cam);
    this._renderMoveTargets(ctx, cam);
    this._renderBoats(ctx, cam);
    this._renderProjectiles(ctx, cam);
    this._renderScraps(ctx, cam);
    this._renderStorm(ctx, cam);
    this._renderFog(ctx, cam);
    this._renderBoxSelect(ctx);
    this._renderMinimap();
  }

  _renderOcean(ctx, cam) {
    const w = this.canvas.width;
    const h = this.canvas.height;

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0a1929');
    grad.addColorStop(1, '#0d2137');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Wave grid lines
    ctx.strokeStyle = 'rgba(30,100,180,0.12)';
    ctx.lineWidth = 1;
    const gridSize = 120 * cam.zoom;
    const offX = ((-cam.x * cam.zoom) % gridSize + gridSize) % gridSize;
    const offY = ((-cam.y * cam.zoom) % gridSize + gridSize) % gridSize;
    for (let x = offX; x < w; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = offY; y < h; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Subtle wave ripples
    ctx.strokeStyle = 'rgba(60,150,220,0.06)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      const waveY = ((i * 180 + this.waveOffset * 40) % (h + 200)) - 100;
      ctx.beginPath();
      for (let x = 0; x < w; x += 4) {
        const y = waveY + Math.sin(x * 0.015 + this.waveOffset + i) * 6;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Map border
    const bx = -cam.x * cam.zoom;
    const by = -cam.y * cam.zoom;
    const bw = this.mapW * cam.zoom;
    const bh = this.mapH * cam.zoom;
    ctx.strokeStyle = 'rgba(100,180,255,0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);
  }

  _renderIslands(ctx, cam) {
    for (const isl of this.islands) isl.render(ctx, cam);
  }

  _renderBases(ctx, cam) {
    this.playerBase.render(ctx, cam);
    this.aiBase.render(ctx, cam);
  }

  _renderBoats(ctx, cam) {
    // Determine visible enemies (not in fog)
    const visibleEnemies = new Set();
    for (const boat of this.boats) {
      if (boat.team === 'player' && !boat.dead) {
        for (const enemy of this.boats) {
          if (enemy.team === 'ai' && !enemy.dead) {
            if (enemy.state === 'submerged') continue;
            const dist = Math.hypot(boat.x - enemy.x, boat.y - enemy.y);
            if (dist <= boat.visionRange) visibleEnemies.add(enemy.id);
          }
        }
      }
    }

    // Check if enemy base is visible
    const baseVisible = this.boats.some(b =>
      b.team === 'player' && !b.dead &&
      Math.hypot(b.x - this.aiBase.x, b.y - this.aiBase.y) <= b.visionRange
    );
    // Also always show enemy base if we have its HP record (it's always on minimap)

    // Also vision from owned islands
    for (const isl of this.islands) {
      if (isl.team !== 'player') continue;
      for (const enemy of this.boats) {
        if (enemy.team === 'ai' && !enemy.dead && enemy.state !== 'submerged') {
          if (Math.hypot(isl.x - enemy.x, isl.y - enemy.y) <= isl.visionRange + 80) {
            visibleEnemies.add(enemy.id);
          }
        }
      }
    }

    for (const boat of this.boats) {
      if (boat.dead) continue;
      if (boat.team === 'player') {
        boat.render(ctx, cam);
      } else {
        if (visibleEnemies.has(boat.id)) {
          boat.render(ctx, cam);
        }
      }
    }
  }

  _renderProjectiles(ctx, cam) {
    for (const p of this.projectiles) p.render(ctx, cam);
  }

  _renderScraps(ctx, cam) {
    for (const sc of this.scraps) sc.render(ctx, cam);
  }

  _renderMoveTargets(ctx, cam) {
    for (const boat of this.selectedUnits) {
      if (!boat.moveTarget || boat.dead) continue;
      const sx = (boat.moveTarget.x - cam.x) * cam.zoom;
      const sy = (boat.moveTarget.y - cam.y) * cam.zoom;
      ctx.strokeStyle = 'rgba(100,255,100,0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  _renderStorm(ctx, cam) {
    if (!this.activeStorm) return;
    const sx = (this.stormX - cam.x) * cam.zoom;
    const sy = (this.stormY - cam.y) * cam.zoom;
    const sr = this.stormRadius * cam.zoom;
    const t = this.gameTime;

    ctx.save();
    ctx.globalAlpha = 0.18 + Math.sin(t * 2) * 0.04;
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    grad.addColorStop(0, '#37474f');
    grad.addColorStop(0.7, '#263238');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Lightning flicker
    if (Math.random() < 0.03) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#e8f5e9';
      ctx.lineWidth = 1.5;
      let lx = sx + (Math.random() - 0.5) * sr * 0.8;
      let ly = sy - sr * 0.3;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      for (let i = 0; i < 5; i++) {
        lx += (Math.random() - 0.5) * 30;
        ly += sr * 0.1;
        ctx.lineTo(lx, ly);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  _renderFog(ctx, cam) {
    const fc = this.fogCtx;
    const fw = this.fogCanvas.width;
    const fh = this.fogCanvas.height;

    fc.clearRect(0, 0, fw, fh);
    fc.fillStyle = 'rgba(0,0,0,0.88)';
    fc.fillRect(0, 0, fw, fh);

    fc.globalCompositeOperation = 'destination-out';

    const drawVision = (wx, wy, radius, falloff = 0.55) => {
      const sx = (wx - cam.x) * cam.zoom;
      const sy = (wy - cam.y) * cam.zoom;
      const sr = radius * cam.zoom * (this.activeStorm ? CONFIG.STORM_VISION_MULT : 1);
      const grad = fc.createRadialGradient(sx, sy, sr * falloff, sx, sy, sr);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      fc.fillStyle = grad;
      fc.beginPath();
      fc.arc(sx, sy, sr, 0, Math.PI * 2);
      fc.fill();
    };

    drawVision(this.playerBase.x, this.playerBase.y, this.playerBase.visionRange, 0.4);

    for (const boat of this.boats) {
      if (boat.team !== 'player' || boat.dead) continue;
      drawVision(boat.x, boat.y, boat.visionRange, 0.5);
    }

    for (const isl of this.islands) {
      if (isl.team === 'player') drawVision(isl.x, isl.y, isl.visionRange + 80, 0.4);
    }

    fc.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.fogCanvas, 0, 0);
  }

  _renderBoxSelect(ctx) {
    if (!this.boxSelect.active) return;
    const { sx, sy, ex, ey } = this.boxSelect;
    ctx.strokeStyle = 'rgba(100,255,100,0.8)';
    ctx.fillStyle = 'rgba(100,255,100,0.08)';
    ctx.lineWidth = 1.5;
    const x = Math.min(sx, ex), y = Math.min(sy, ey);
    const w = Math.abs(ex - sx), h = Math.abs(ey - sy);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }

  _renderMinimap() {
    const mm = document.getElementById('minimap-canvas');
    if (!mm) return;
    const mc = mm.getContext('2d');
    const mw = mm.width, mh = mm.height;
    const scaleX = mw / this.mapW, scaleY = mh / this.mapH;

    mc.fillStyle = '#0a1929';
    mc.fillRect(0, 0, mw, mh);

    // Islands
    for (const isl of this.islands) {
      mc.fillStyle = isl.team === 'neutral' ? '#5d4037' : isl.team === 'player' ? '#2e7d32' : '#7f0000';
      mc.beginPath();
      mc.arc(isl.x * scaleX, isl.y * scaleY, 5, 0, Math.PI * 2);
      mc.fill();
    }

    // Bases
    mc.fillStyle = '#1565c0';
    mc.fillRect(this.playerBase.x * scaleX - 5, this.playerBase.y * scaleY - 5, 10, 10);
    mc.fillStyle = '#b71c1c';
    mc.fillRect(this.aiBase.x * scaleX - 5, this.aiBase.y * scaleY - 5, 10, 10);

    // Player boats
    for (const boat of this.boats) {
      if (boat.dead) continue;
      mc.fillStyle = boat.team === 'player' ? '#4fc3f7' : '#ef5350';
      if (boat.team === 'ai' && boat.state === 'submerged') continue;
      mc.beginPath();
      mc.arc(boat.x * scaleX, boat.y * scaleY, 2.5, 0, Math.PI * 2);
      mc.fill();
    }

    // Storm
    if (this.activeStorm) {
      mc.strokeStyle = 'rgba(200,200,255,0.4)';
      mc.lineWidth = 1;
      mc.beginPath();
      mc.arc(this.stormX * scaleX, this.stormY * scaleY, this.stormRadius * scaleX, 0, Math.PI * 2);
      mc.stroke();
    }

    // Viewport box
    mc.strokeStyle = 'rgba(255,255,255,0.5)';
    mc.lineWidth = 1;
    mc.strokeRect(
      this.cam.x * scaleX,
      this.cam.y * scaleY,
      (this.canvas.width / this.cam.zoom) * scaleX,
      (this.canvas.height / this.cam.zoom) * scaleY
    );
  }

  // ─── Input ───────────────────────────────────────────────────────────────
  _setupInput() {
    const canvas = this.canvas;

    window.addEventListener('keydown', (e) => {
      this.keys[e.key] = true;

      // Fleet group select
      if (!e.ctrlKey && !e.metaKey && ['1','2','3','4','5'].includes(e.key)) {
        const g = parseInt(e.key);
        const group = this.fleetGroups[g].filter(b => !b.dead);
        if (group.length > 0) {
          this._deselectAll();
          for (const b of group) b.selected = true;
          this.selectedUnits = [...group];
          if (window.HUD) HUD.updateSelection(this);
        }
      }

      // Assign to fleet group
      if ((e.ctrlKey || e.metaKey) && ['1','2','3','4','5'].includes(e.key)) {
        e.preventDefault();
        const g = parseInt(e.key);
        this.fleetGroups[g] = [...this.selectedUnits];
        HUD.showGroupNotif(g, this.selectedUnits.length);
      }

      // Ability
      if (e.key.toUpperCase() === 'Q') {
        for (const boat of this.selectedUnits) boat.useAbility(this);
      }

      // Hotkey overlay
      if (e.key.toUpperCase() === 'H') {
        const overlay = document.getElementById('hotkey-overlay');
        if (overlay) overlay.classList.toggle('hidden');
      }

      // Escape
      if (e.key === 'Escape') {
        this._deselectAll();
        if (window.HUD) HUD.updateSelection(this);
        const overlay = document.getElementById('hotkey-overlay');
        if (overlay) overlay.classList.add('hidden');
      }
    });

    window.addEventListener('keyup', (e) => { this.keys[e.key] = false; });

    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (e.button === 0) {
        this.mouse.down = true;
        this.isDragging = false;
        this.dragStart = { x: sx, y: sy };
        this.boxSelect = { active: false, sx, sy, ex: sx, ey: sy };
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      this.mouse.x = sx;
      this.mouse.y = sy;
      this.mouse.worldX = sx / this.cam.zoom + this.cam.x;
      this.mouse.worldY = sy / this.cam.zoom + this.cam.y;

      if (this.mouse.down) {
        const dx = sx - this.dragStart.x, dy = sy - this.dragStart.y;
        if (Math.hypot(dx, dy) > 6) {
          this.isDragging = true;
          this.boxSelect.active = true;
          this.boxSelect.ex = sx;
          this.boxSelect.ey = sy;
        }
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wx = sx / this.cam.zoom + this.cam.x;
      const wy = sy / this.cam.zoom + this.cam.y;

      if (e.button === 0) {
        if (this.isDragging && this.boxSelect.active) {
          // Box select
          this._boxSelect(this.boxSelect.sx, this.boxSelect.sy, sx, sy);
        } else {
          // Click select
          this._handleLeftClick(wx, wy);
        }
        this.mouse.down = false;
        this.isDragging = false;
        this.boxSelect.active = false;
        if (window.HUD) HUD.updateSelection(this);
      }
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wx = sx / this.cam.zoom + this.cam.x;
      const wy = sy / this.cam.zoom + this.cam.y;
      this._handleRightClick(wx, wy);
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomDir = e.deltaY < 0 ? 1 : -1;
      const factor = 1 + zoomDir * 0.12;
      const newZoom = Math.max(CONFIG.ZOOM_MIN, Math.min(CONFIG.ZOOM_MAX, this.cam.zoom * factor));
      // Zoom toward mouse
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.cam.x += (mx / this.cam.zoom - mx / newZoom);
      this.cam.y += (my / this.cam.zoom - my / newZoom);
      this.cam.zoom = newZoom;
      this._clampCamera();
    }, { passive: false });

    // Minimap click
    const mm = document.getElementById('minimap-canvas');
    if (mm) {
      mm.addEventListener('click', (e) => {
        const rect = mm.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / mm.width * this.mapW;
        const my = (e.clientY - rect.top) / mm.height * this.mapH;
        this.cam.x = mx - this.canvas.width / (2 * this.cam.zoom);
        this.cam.y = my - this.canvas.height / (2 * this.cam.zoom);
        this._clampCamera();
      });
    }
  }

  _clampCamera() {
    const maxX = this.mapW - this.canvas.width / this.cam.zoom;
    const maxY = this.mapH - this.canvas.height / this.cam.zoom;
    this.cam.x = Math.max(0, Math.min(maxX, this.cam.x));
    this.cam.y = Math.max(0, Math.min(maxY, this.cam.y));
  }

  _handleLeftClick(wx, wy) {
    // Check bases
    if (Math.hypot(wx - this.playerBase.x, wy - this.playerBase.y) <= this.playerBase.size + 10) {
      this._deselectAll();
      this.playerBase.selected = true;
      this.selectedBuilding = this.playerBase;
      if (window.HUD) HUD.updateSelection(this);
      return;
    }

    // Check islands
    for (const isl of this.islands) {
      if (Math.hypot(wx - isl.x, wy - isl.y) <= isl.size + 8) {
        this._deselectAll();
        isl.selected = true;
        this.selectedBuilding = isl;
        if (window.HUD) HUD.updateSelection(this);
        return;
      }
    }

    // Check player boats
    for (const boat of this.boats) {
      if (boat.team !== 'player' || boat.dead) continue;
      if (Math.hypot(wx - boat.x, wy - boat.y) <= boat.size + 8) {
        if (!this.keys['Shift']) this._deselectAll();
        boat.selected = true;
        if (!this.selectedUnits.includes(boat)) this.selectedUnits.push(boat);
        this.selectedBuilding = null;
        return;
      }
    }

    // Clicked empty space
    this._deselectAll();
  }

  _handleRightClick(wx, wy) {
    if (this.selectedUnits.length === 0) return;

    // Right-click on enemy = attack order
    for (const enemy of this.boats) {
      if (enemy.team !== 'player' && !enemy.dead && enemy.state !== 'submerged') {
        if (Math.hypot(wx - enemy.x, wy - enemy.y) <= enemy.size + 10) {
          for (const boat of this.selectedUnits) boat.attackMove(enemy);
          return;
        }
      }
    }

    // Right-click on enemy base = attack base
    if (Math.hypot(wx - this.aiBase.x, wy - this.aiBase.y) <= this.aiBase.size + 12) {
      for (const boat of this.selectedUnits) boat.attackMove(this.aiBase);
      return;
    }

    // Right-click on neutral/enemy island = capture
    for (const isl of this.islands) {
      if (Math.hypot(wx - isl.x, wy - isl.y) <= isl.size + 8) {
        if (isl.team !== 'player') {
          for (const boat of this.selectedUnits) {
            if (boat.canCapture) boat.captureIsland(isl);
            else boat.moveTo(wx, wy);
          }
          return;
        }
      }
    }

    // Move order
    const count = this.selectedUnits.length;
    for (let i = 0; i < count; i++) {
      const boat = this.selectedUnits[i];
      const offset = count > 1 ? {
        x: (i % 3 - 1) * 50,
        y: (Math.floor(i / 3) - Math.floor(count / 6)) * 50
      } : { x: 0, y: 0 };
      boat.moveTo(wx + offset.x, wy + offset.y);
    }
  }

  _boxSelect(x1, y1, x2, y2) {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);

    this._deselectAll();
    for (const boat of this.boats) {
      if (boat.team !== 'player' || boat.dead) continue;
      const sx = (boat.x - this.cam.x) * this.cam.zoom;
      const sy = (boat.y - this.cam.y) * this.cam.zoom;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
        boat.selected = true;
        this.selectedUnits.push(boat);
      }
    }
    this.selectedBuilding = null;
  }

  _deselectAll() {
    for (const boat of this.selectedUnits) boat.selected = false;
    this.selectedUnits = [];
    if (this.playerBase.selected) { this.playerBase.selected = false; }
    for (const isl of this.islands) isl.selected = false;
    this.selectedBuilding = null;
  }

  buildBoat(type, slotIndex = 0) {
    if (!this.canAffordBoat(type)) return false;
    const target = this.selectedBuilding instanceof Base
      ? this.selectedBuilding
      : (this.selectedBuilding instanceof Island && this.selectedBuilding.canBuild && this.selectedBuilding.team === 'player')
        ? this.selectedBuilding
        : this.playerBase;

    if (target instanceof Base) {
      if (!target.queueBuild(type, slotIndex)) return false;
    } else {
      if (!target.buildQueues[0] || target.buildQueues[0].length >= 5) return false;
      target.buildQueues[0].push({ type, progress: 0 });
    }

    this.playerGold -= CONFIG.BOATS[type].cost;
    if (window.HUD) HUD.updateSelection(this);
    return true;
  }

  upgradeIsland() {
    if (!(this.selectedBuilding instanceof Island)) return;
    const isl = this.selectedBuilding;
    if (isl.team !== 'player') return;
    isl.upgrade(this);
    if (window.HUD) HUD.updateSelection(this);
  }

  buyWorkshop() {
    const base = this.playerBase;
    if (base.extraWorkshops >= base.maxWorkshops - 1) return;
    const cost = 200;
    if (this.playerGold < cost) return;
    this.playerGold -= cost;
    base.addWorkshop();
    if (window.HUD) HUD.updateSelection(this);
  }
}
