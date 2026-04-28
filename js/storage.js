const Storage = {
  KEY: 'boatBattle_v1',

  defaultState() {
    return {
      adaptiveDifficultyIndex: 0,
      adaptiveWinsAtStage: 0,
      adaptiveTotalWins: 0,
      practiceMode: 'medium',
      upgradeCurrency: 0,
      captainCurrency: 0,
      captainsUnlocked: false,
      unlockedBoats: ['scout', 'smallBattlecruiser', 'mediumBattlecruiser', 'submarine'],
      upgrades: {},
      ownedCaptains: [],
      matchHistory: [],
      achievements: {},
      settings: { hotkeys: {} },
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return this.defaultState();
      return Object.assign(this.defaultState(), JSON.parse(raw));
    } catch (e) {
      return this.defaultState();
    }
  },

  save(state) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Could not save to localStorage:', e);
    }
  },

  get(key) {
    return this.load()[key];
  },

  set(key, value) {
    const state = this.load();
    state[key] = value;
    this.save(state);
    return state;
  },

  update(updates) {
    const state = this.load();
    Object.assign(state, updates);
    this.save(state);
    return state;
  },
};
