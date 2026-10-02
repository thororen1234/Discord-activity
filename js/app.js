// Main Application Controller for Short Circuit - v2.0 Ultra Polish & N-Player Battle System

class ShortCircuitApp {
  constructor() {
    this.currentUser = null;
    this.currentMode = 'menu'; // 'menu', 'lobby', 'game'
    this.isBotGame = false;
    this.lobbyRole = 'host'; // 'host', 'opponent', 'spectator'
    this.lobbySettings = { maxHp: 3, itemsPerRound: 1 };
    this.lobbyPlayers = []; // List of up to 6 player objects in lobby

    this.engine = null;
    this.botAI = null;
    this.canvasFX = null;

    this.criticalTimer = null;
    this.criticalTimeLeft = 10;
    this.mobilePendingItem = null;

    this.selectedTargetKey = null; // Currently targeted rival key
    this.vkBuffer = '';

    this.init();
  }

  async init() {
    // 1. Initialize Canvas FX for oscilloscope & sparks
    this.canvasFX = new CanvasFX('oscilloscope-canvas');

    // 2. Initialize Discord Bridge & Player profile
    this.currentUser = await window.discordBridge.init();

    const savedHandle = localStorage.getItem('SC_USER_HANDLE');
    if (savedHandle && savedHandle.trim().length > 0) {
      this.currentUser.username = savedHandle.trim();
      this.currentUser.name = this.currentUser.username;
    }

    this.updateHeaderProfile();
    this.updateMainMenuRecord();

    // 3. Attach UI Event Listeners & Virtual Keyboard
    this.setupEventListeners();
    this.setupVirtualKeyboard();

    // 4. Check URL for join code (e.g. ?room=X7K9P)
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      this.joinRoomByCode(roomParam);
    } else {
      this.switchScreen('screen-main-menu');
    }
  }

  updateHeaderProfile() {
    const avatarImg = document.getElementById('header-avatar-img');
    const usernameEl = document.getElementById('header-username');
    const statusEl = document.getElementById('header-status');

    if (this.currentUser) {
      if (avatarImg) avatarImg.src = this.currentUser.avatar;
      if (usernameEl) usernameEl.textContent = this.currentUser.username;
      if (statusEl) {
        statusEl.textContent = this.currentUser.isDiscordUser ? 'DISCORD CONNECTED' : 'TERMINAL READY';
      }
    }
  }

  setupVirtualKeyboard() {
    this.vkBuffer = this.currentUser ? this.currentUser.username : 'RUNNER_001';
    this.updateVKDisplay();

    document.querySelectorAll('.vk-key[data-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        window.soundFX?.playClick();
        if (this.vkBuffer.length < 16) {
          const char = btn.getAttribute('data-key');
          this.vkBuffer += char;
          this.updateVKDisplay();
        }
      });
    });

    document.getElementById('vk-btn-clear')?.addEventListener('click', () => {
      window.soundFX?.playClick();
      this.vkBuffer = '';
      this.updateVKDisplay();
    });

    document.getElementById('vk-btn-backspace')?.addEventListener('click', () => {
      window.soundFX?.playClick();
      this.vkBuffer = this.vkBuffer.slice(0, -1);
      this.updateVKDisplay();
    });

    document.getElementById('vk-btn-space')?.addEventListener('click', () => {
      window.soundFX?.playClick();
      if (this.vkBuffer.length < 16) {
        this.vkBuffer += ' ';
        this.updateVKDisplay();
      }
    });

    document.getElementById('vk-btn-submit')?.addEventListener('click', () => {
      window.soundFX?.playClick();
      const newHandle = this.vkBuffer.trim();
      if (newHandle.length > 0) {
        this.currentUser.username = newHandle;
        this.currentUser.name = newHandle;
        localStorage.setItem('SC_USER_HANDLE', newHandle);
        this.updateHeaderProfile();
        this.closeModal('modal-virtual-keyboard');
        this.showToast(`Handle updated to ${newHandle}!`);
      }
    });

    document.getElementById('btn-edit-username')?.addEventListener('click', () => {
      window.soundFX?.playClick();
      this.vkBuffer = this.currentUser.username;
      this.updateVKDisplay();
      this.openModal('modal-virtual-keyboard');
    });

    document.getElementById('btn-menu-virtual-kb')?.addEventListener('click', () => {
      window.soundFX?.playClick();
      this.vkBuffer = this.currentUser.username;
      this.updateVKDisplay();
      this.openModal('modal-virtual-keyboard');
    });
  }

  updateVKDisplay() {
    const disp = document.getElementById('vk-display');
    if (disp) {
      disp.textContent = this.vkBuffer.length > 0 ? this.vkBuffer : '_';
    }
  }

  getRecord() {
    try {
      const data = localStorage.getItem('SC_MATCH_RECORD');
      return data ? JSON.parse(data) : { wins: 0, losses: 0 };
    } catch (e) {
      return { wins: 0, losses: 0 };
    }
  }

  saveRecord(isWin) {
    const rec = this.getRecord();
    if (isWin) rec.wins++;
    else rec.losses++;
    try {
      localStorage.setItem('SC_MATCH_RECORD', JSON.stringify(rec));
    } catch (e) {}
    this.updateMainMenuRecord();
  }

  updateMainMenuRecord() {
    const rec = this.getRecord();
    const statsEl = document.getElementById('main-menu-stats');
    if (statsEl) {
      statsEl.textContent = `RECORD: ${rec.wins} WINS / ${rec.losses} LOSSES`;
    }
  }

  showToast(msg, duration = 2500) {
    const toast = document.getElementById('toast-notification');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('active');
    setTimeout(() => {
      toast.classList.remove('active');
    }, duration);
  }

  switchScreen(screenId) {
    document.querySelectorAll('.screen-view').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) {
      target.classList.add('active');
    }
    this.currentMode = screenId.replace('screen-', '');

    if (screenId === 'screen-game' && this.canvasFX) {
      setTimeout(() => this.canvasFX.resize(), 50);
    }
  }

  setupEventListeners() {
    document.addEventListener('click', () => {
      window.soundFX?.init();
    }, { once: true });

    const muteBtn = document.getElementById('audio-mute-btn');
    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        const isMuted = window.soundFX.toggleMute();
        muteBtn.textContent = isMuted ? '🔇 AUDIO: MUTED' : '🔊 AUDIO: ON';
        muteBtn.style.borderColor = isMuted ? 'var(--neon-pink)' : 'var(--border-dim)';
      });
    }

    // Main Menu Buttons
    document.getElementById('btn-play-bot')?.addEventListener('click', () => {
      window.soundFX.playClick();
      this.startBotMatch();
    });

    document.getElementById('btn-host-room')?.addEventListener('click', () => {
      window.soundFX.playClick();
      this.setupHostLobby();
    });

    document.getElementById('btn-open-join')?.addEventListener('click', () => {
      window.soundFX.playClick();
      this.openModal('modal-join-room');
    });

    // Modals Navigation
    document.getElementById('nav-how-to-play')?.addEventListener('click', () => {
      window.soundFX.playClick();
      this.openModal('modal-how-to-play');
    });

    document.getElementById('nav-settings')?.addEventListener('click', () => {
      window.soundFX.playClick();
      this.openModal('modal-settings');
    });

    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modalId = btn.getAttribute('data-close');
        this.closeModal(modalId);
      });
    });

    // How to Play Tabs
    document.querySelectorAll('.rules-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        window.soundFX.playClick();
        const cardIndex = tab.getAttribute('data-card');
        document.querySelectorAll('.rules-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.querySelectorAll('.rules-card-content').forEach(c => c.style.display = 'none');
        const activeCard = document.getElementById(`rules-card-${cardIndex}`);
        if (activeCard) activeCard.style.display = 'block';
      });
    });

    // Settings Sliders & Toggles
    const masterSlider = document.getElementById('slider-master-volume');
    if (masterSlider) {
      masterSlider.addEventListener('input', (e) => {
        window.soundFX.setMasterVolume(e.target.value / 100);
      });
    }

    const sfxSlider = document.getElementById('slider-sfx-volume');
    if (sfxSlider) {
      sfxSlider.addEventListener('input', (e) => {
        window.soundFX.setSFXVolume(e.target.value / 100);
      });
    }

    const shakeToggle = document.getElementById('toggle-screen-shake');
    if (shakeToggle) {
      shakeToggle.addEventListener('change', (e) => {
        if (this.canvasFX) this.canvasFX.screenShakeEnabled = e.target.checked;
      });
    }

    const colorblindToggle = document.getElementById('toggle-colorblind');
    if (colorblindToggle) {
      colorblindToggle.addEventListener('change', (e) => {
        if (e.target.checked) document.body.classList.add('colorblind-mode');
        else document.body.classList.remove('colorblind-mode');
      });
    }

    // Join Room Submission
    document.getElementById('btn-submit-join')?.addEventListener('click', () => {
      const input = document.getElementById('join-code-input');
      const code = input ? input.value.trim().toUpperCase() : '';
      if (code) {
        this.closeModal('modal-join-room');
        this.joinRoomByCode(code);
      }
    });

    // Lobby: Copy Code
    document.getElementById('copy-room-code-btn')?.addEventListener('click', () => {
      const codeEl = document.getElementById('lobby-room-code');
      if (codeEl) {
        const code = codeEl.textContent.replace('#', '');
        navigator.clipboard?.writeText(code);
        this.showToast(`Room code #${code} copied to clipboard!`);
        window.soundFX.playClick();
      }
    });

    // Lobby: Invite Discord Friends
    document.getElementById('btn-discord-invite')?.addEventListener('click', async () => {
      window.soundFX.playClick();
      const res = await window.discordBridge.openInviteDialog();
      if (!res.native) {
        const codeEl = document.getElementById('lobby-room-code');
        const code = codeEl ? codeEl.textContent : '';
        navigator.clipboard?.writeText(window.location.origin + window.location.pathname + '?room=' + code.replace('#', ''));
        this.showToast('Invite link copied to clipboard!');
      }
    });

    // Lobby: Fill Empty Seats with Bots
    document.getElementById('btn-lobby-fill-bots')?.addEventListener('click', () => {
      window.soundFX.playClick();
      if (this.lobbyRole !== 'host') return;
      const maxSeats = 6;
      for (let i = this.lobbyPlayers.length; i < maxSeats; i++) {
        const botName = `BOLT-v9-${String.fromCharCode(65 + i)}`;
        this.lobbyPlayers.push({
          id: `bot_${i}`,
          name: botName,
          avatar: window.discordBridge.generateNeonAvatar(botName, true),
          isBot: true,
          ready: true
        });
      }
      this.updateLobbyUI();
    });

    // Lobby Settings Toggles
    document.querySelectorAll('#hp-toggle-group .toggle-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.lobbyRole !== 'host') return;
        window.soundFX.playClick();
        document.querySelectorAll('#hp-toggle-group .toggle-choice').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.lobbySettings.maxHp = parseInt(btn.dataset.val, 10);
        window.multiplayerManager?.updateSettings({ maxHp: this.lobbySettings.maxHp });
      });
    });

    document.querySelectorAll('#items-toggle-group .toggle-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.lobbyRole !== 'host') return;
        window.soundFX.playClick();
        document.querySelectorAll('#items-toggle-group .toggle-choice').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.lobbySettings.itemsPerRound = parseInt(btn.dataset.val, 10);
        window.multiplayerManager?.updateSettings({ itemsPerRound: this.lobbySettings.itemsPerRound });
      });
    });

    // Lobby: Start Match
    document.getElementById('btn-start-match')?.addEventListener('click', () => {
      window.soundFX.playClick();
      if (this.isBotGame || this.lobbyPlayers.some(p => p.isBot)) {
        this.launchGame(this.lobbyPlayers, this.lobbySettings);
      } else {
        window.multiplayerManager.sendStartMatch({});
      }
    });

    // Lobby: Leave Room
    document.getElementById('btn-leave-lobby')?.addEventListener('click', () => {
      window.soundFX.playClick();
      window.multiplayerManager.leaveRoom();
      this.switchScreen('screen-main-menu');
    });

    // Primary In-Game Shock Buttons
    document.getElementById('btn-shock-opponent')?.addEventListener('click', () => {
      this.handlePlayerShock(false, this.selectedTargetKey);
    });

    document.getElementById('btn-shock-self')?.addEventListener('click', () => {
      const myKey = this.getLocalPlayerKey();
      this.handlePlayerShock(true, myKey);
    });

    // Bluff Emote Buttons
    document.querySelectorAll('.bluff-emote-dock .emote-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const emote = btn.dataset.emote;
        const myKey = this.getLocalPlayerKey();
        this.triggerEmote(myKey, emote);
      });
    });

    // Mobile Item Modal Confirm
    document.getElementById('btn-confirm-mobile-use')?.addEventListener('click', () => {
      this.closeModal('modal-mobile-item');
      if (this.mobilePendingItem) {
        const { playerKey, itemIndex, itemType } = this.mobilePendingItem;
        this.executeItemUse(playerKey, itemIndex, itemType);
        this.mobilePendingItem = null;
      }
    });

    // Match Over Buttons
    document.getElementById('btn-rematch')?.addEventListener('click', () => {
      window.soundFX.playClick();
      this.closeModal('modal-match-over');
      if (this.isBotGame) {
        this.startBotMatch();
      } else {
        this.switchScreen('screen-lobby');
      }
    });

    document.getElementById('btn-match-over-menu')?.addEventListener('click', () => {
      window.soundFX.playClick();
      this.closeModal('modal-match-over');
      window.multiplayerManager?.leaveRoom();
      this.switchScreen('screen-main-menu');
    });
  }

  getLocalPlayerKey() {
    if (!this.engine) return 'p1';
    const found = this.engine.playerList.find(p => p.id === this.currentUser.id);
    return found ? found.key : 'p1';
  }

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  }

  triggerEmote(playerKey, emoteText) {
    window.soundFX.playEmote();
    const bubble = document.getElementById(`${playerKey}-emote-bubble`);
    if (bubble) {
      bubble.textContent = `${emoteText}`;
      bubble.style.display = 'block';
      setTimeout(() => {
        bubble.style.display = 'none';
      }, 2500);
    }
    if (this.engine) {
      this.engine.sendEmote(playerKey, emoteText);
    }
    if (!this.isBotGame && window.multiplayerManager) {
      window.multiplayerManager.sendGameAction({
        type: 'EMOTE',
        playerKey,
        emoteText
      }, this.currentUser.id);
    }
  }

  // Quick Start vs AI Bots (Offline 4-Player Battle)
  startBotMatch() {
    this.isBotGame = true;
    const bot1 = { id: 'bot_b1', name: 'BOLT-v9 (Alpha)', avatar: window.discordBridge.generateNeonAvatar('BOLT-Alpha', true), isBot: true };
    const bot2 = { id: 'bot_b2', name: 'BOLT-v9 (Beta)', avatar: window.discordBridge.generateNeonAvatar('BOLT-Beta', true), isBot: true };
    const bot3 = { id: 'bot_b3', name: 'BOLT-v9 (Gamma)', avatar: window.discordBridge.generateNeonAvatar('BOLT-Gamma', true), isBot: true };
    this.launchGame([this.currentUser, bot1, bot2, bot3], { maxHp: 3, itemsPerRound: 1 });
  }

  // Setup Host Room
  setupHostLobby() {
    this.isBotGame = false;
    this.lobbyRole = 'host';
    this.lobbyPlayers = [this.currentUser];

    const randomRoomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    window.multiplayerManager.initRoom(randomRoomId, this.currentUser, true, this.lobbySettings);

    document.getElementById('lobby-room-code').textContent = `#${randomRoomId}`;
    this.updateLobbyUI();

    window.multiplayerManager.onRoomUpdate = (state, role) => {
      this.lobbyRole = role;
      const players = [];
      if (state.host) players.push(state.host);
      if (state.opponent) players.push(state.opponent);
      if (state.spectators) players.push(...state.spectators);
      this.lobbyPlayers = players;
      this.updateLobbyUI();
    };

    window.multiplayerManager.onKicked = (msg) => {
      this.showToast(msg || 'You were kicked from the room.');
      this.switchScreen('screen-main-menu');
    };

    window.multiplayerManager.onMatchStart = (payload) => {
      this.launchGame(this.lobbyPlayers, payload.settings || this.lobbySettings);
    };

    this.switchScreen('screen-lobby');
  }

  // Join Room by Code
  joinRoomByCode(code) {
    this.isBotGame = false;
    this.lobbyRole = 'opponent';
    window.multiplayerManager.initRoom(code, this.currentUser, false, this.lobbySettings);

    document.getElementById('lobby-room-code').textContent = `#${code}`;
    document.querySelectorAll('.toggle-choice').forEach(b => b.disabled = true);
    document.getElementById('btn-start-match').style.display = 'none';

    window.multiplayerManager.onRoomUpdate = (state, role) => {
      this.lobbyRole = role;
      const players = [];
      if (state.host) players.push(state.host);
      if (state.opponent) players.push(state.opponent);
      if (state.spectators) players.push(...state.spectators);
      this.lobbyPlayers = players;
      this.updateLobbyUI();
    };

    window.multiplayerManager.onKicked = (msg) => {
      this.showToast(msg || 'You were kicked from the room by host.');
      this.switchScreen('screen-main-menu');
    };

    window.multiplayerManager.onMatchStart = (payload) => {
      this.launchGame(this.lobbyPlayers, payload.settings || this.lobbySettings);
    };

    this.switchScreen('screen-lobby');
  }

  updateLobbyUI() {
    const grid = document.getElementById('multi-lobby-grid');
    const startBtn = document.getElementById('btn-start-match');
    if (!grid) return;

    grid.innerHTML = '';
    const maxSeats = 6;

    for (let i = 0; i < maxSeats; i++) {
      const p = this.lobbyPlayers[i];
      const card = document.createElement('div');
      card.className = 'lobby-seat-card';

      if (p) {
        if (i === 0) card.classList.add('active-seat');
        card.innerHTML = `
          <div class="seat-avatar">
            <img src="${escapeHtml(p.avatar || window.discordBridge.generateNeonAvatar(p.name || '', p.isBot))}" alt="Avatar">
          </div>
          <span class="seat-name">${escapeHtml(p.name)}</span>
          <span class="status-pill ready">${i === 0 ? 'READY (HOST)' : (p.isBot ? 'BOT' : 'READY')}</span>
        `;
        if (this.lobbyRole === 'host' && i > 0 && !p.isBot) {
          const kickBtn = document.createElement('button');
          kickBtn.className = 'btn-kick';
          kickBtn.style.fontSize = '10px';
          kickBtn.style.padding = '3px 8px';
          kickBtn.style.marginTop = '4px';
          kickBtn.textContent = '🚫 KICK';
          kickBtn.addEventListener('click', () => {
            window.soundFX?.playClick();
            if (window.multiplayerManager) window.multiplayerManager.sendKickPlayer(p.id);
          });
          card.appendChild(kickBtn);
        }
      } else {
        card.innerHTML = `
          <div class="seat-avatar" style="border-color: var(--border-dim); opacity: 0.4;"></div>
          <span class="seat-name" style="color: var(--text-dim);">EMPTY SEAT ${i + 1}</span>
          <span class="status-pill waiting">WAITING</span>
        `;
      }
      grid.appendChild(card);
    }

    if (startBtn) {
      startBtn.disabled = (this.lobbyPlayers.length < 2);
    }
  }

  // Launch In-Game Workbench (2 to 6 Players Battle)
  launchGame(playersList, settings) {
    this.engine = new GameEngine({
      maxHp: settings.maxHp || 3,
      itemsPerRound: settings.itemsPerRound || 1,
      players: playersList
    });

    const botPlayer = this.engine.playerList.find(p => p.isBot);
    if (botPlayer) {
      this.botAI = new BotAI(this.engine, botPlayer.key);
    } else {
      this.botAI = null;
    }

    this.engine.onStateChange((snapshot, eventMeta) => {
      this.renderHUD(snapshot, eventMeta);
      this.handleGameEvents(snapshot, eventMeta);
    });

    this.engine.onLog((msg, type) => {
      this.appendCombatLogTypewriter(msg, type);
    });

    this.engine.onEmote(({ playerKey, name, emote }) => {
      this.triggerEmote(playerKey, emote);
    });

    if (!this.isBotGame && window.multiplayerManager) {
      window.multiplayerManager.onGameAction = (action, senderId) => {
        if (senderId !== this.currentUser.id) {
          if (action.type === 'SHOCK_TARGET') {
            this.engine.shockTarget(action.shooterKey, action.targetKey);
          } else if (action.type === 'USE_ITEM') {
            this.engine.useItem(action.playerKey, action.itemIndex);
          } else if (action.type === 'EMOTE') {
            this.triggerEmote(action.playerKey, action.emoteText);
          }
        }
      };
    }

    const logContainer = document.getElementById('combat-log');
    if (logContainer) logContainer.innerHTML = '';

    this.switchScreen('screen-game');

    const liveRatio = this.engine.liveCount / (this.engine.liveCount + this.engine.dudCount || 1);
    window.soundFX.startAmbient(liveRatio);
    window.soundFX.playChamberReload();

    this.engine.startMatch();
  }

  appendCombatLogTypewriter(text, type = 'info') {
    const log = document.getElementById('combat-log');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    log.appendChild(entry);

    let idx = 0;
    const interval = setInterval(() => {
      if (idx < text.length) {
        entry.textContent += text.charAt(idx);
        idx++;
        log.scrollTop = log.scrollHeight;
      } else {
        clearInterval(interval);
      }
    }, 14);
  }

  // Render complete HUD state with N-Player Battle Support
  renderHUD(state, eventMeta = {}) {
    const liveEl = document.getElementById('hud-live-count');
    const dudEl = document.getElementById('hud-dud-count');
    const roundEl = document.getElementById('round-indicator');
    const boosterTag = document.getElementById('hud-booster-tag');
    const spectatorTag = document.getElementById('hud-spectator-tag');

    if (liveEl) liveEl.textContent = state.liveCount;
    if (dudEl) dudEl.textContent = state.dudCount;
    if (roundEl) roundEl.textContent = `ROUND ${state.round}`;
    if (boosterTag) {
      if (state.isBoosted) boosterTag.classList.add('active');
      else boosterTag.classList.remove('active');
    }

    if (spectatorTag) {
      spectatorTag.style.display = (this.lobbyRole === 'spectator') ? 'inline-block' : 'none';
    }

    const totalRemaining = state.liveCount + state.dudCount;
    if (totalRemaining > 0) {
      window.soundFX.updateAmbientIntensity(state.liveCount / totalRemaining);
    }

    if (state.isCriticalVoltage) window.soundFX.startTension();
    else window.soundFX.stopTension();

    const localKey = this.getLocalPlayerKey();
    const localPlayer = state.players[localKey] || state.players.p1;

    // Render Local Player Station (P1 / You)
    document.getElementById('p1-hud-name').textContent = localPlayer.name;
    document.getElementById('p1-hud-avatar').src = localPlayer.avatar || window.discordBridge.generateNeonAvatar(localPlayer.name);
    document.getElementById('p1-hp-label').textContent = `${localPlayer.hp} / ${state.maxHp} HP`;
    this.renderHealthCells('p1-cells', localPlayer.hp, state.maxHp);
    this.renderInventory('p1-tool-slots', localPlayer.items, localPlayer.key, localPlayer.isJammed, state.activePlayerKey === localPlayer.key);

    const station1 = document.getElementById('station-p1');
    if (state.activePlayerKey === localPlayer.key) {
      station1?.classList.add('active-turn');
    } else {
      station1?.classList.remove('active-turn');
    }

    // Render Opponents Arena Grid (Rivals)
    this.renderOpponentsGrid(state, localPlayer.key);

    // Active Node Banner
    const activePlayerObj = state.players[state.activePlayerKey];
    const oscStatus = document.getElementById('osc-status-text');
    if (oscStatus && activePlayerObj) {
      oscStatus.textContent = `⚡ [${activePlayerObj.name.toUpperCase()}] HAS THE CIRCUIT NODE`;
      oscStatus.style.color = (state.activePlayerKey === localPlayer.key) ? 'var(--neon-cyan)' : 'var(--neon-pink)';
    }

    // Render Target Picker Chips
    this.renderTargetPicker(state, localPlayer.key);

    // Enable/disable primary buttons (Strict turn enforcement)
    const isMyTurn = (state.activePlayerKey === localPlayer.key && !localPlayer.isEliminated);
    const shockOpponentBtn = document.getElementById('btn-shock-opponent');
    const shockSelfBtn = document.getElementById('btn-shock-self');

    if (shockOpponentBtn) shockOpponentBtn.disabled = !isMyTurn || state.gameOver;
    if (shockSelfBtn) shockSelfBtn.disabled = !isMyTurn || state.gameOver;

    this.manageCriticalTimer(state);
  }

  renderOpponentsGrid(state, localKey) {
    const grid = document.getElementById('opponents-arena-grid');
    if (!grid) return;
    grid.innerHTML = '';

    state.playerListKeys.forEach(pKey => {
      if (pKey === localKey) return; // Skip local player
      const rival = state.players[pKey];
      if (!rival) return;

      const station = document.createElement('div');
      station.className = 'player-station';
      station.id = `station-${pKey}`;
      if (rival.isEliminated) station.classList.add('eliminated');
      if (state.activePlayerKey === pKey) station.classList.add('active-turn');

      station.innerHTML = `
        <div id="${pKey}-emote-bubble" class="emote-speech-bubble" style="display: none;"></div>
        <div>
          <div class="station-header">
            <div class="station-avatar">
              <img src="${escapeHtml(rival.avatar || window.discordBridge.generateNeonAvatar(rival.name, rival.isBot))}" alt="Avatar">
            </div>
            <div>
              <div class="station-name">${escapeHtml(rival.name)}</div>
              <div style="font-size: 10px; color: var(--text-dim);">${rival.isEliminated ? '💀 FLATLINED' : `TERMINAL ${pKey.toUpperCase()}`}</div>
            </div>
          </div>
          <div class="voltage-meter-container">
            <div class="voltage-label">
              <span>VOLTAGE CAPACITY</span>
              <span>${rival.hp} / ${state.maxHp} HP</span>
            </div>
            <div class="voltage-cells" id="${pKey}-cells"></div>
          </div>
        </div>
        <div class="inventory-container">
          <div class="inventory-title">TOOLBOX INVENTORY</div>
          <div class="tool-slots" id="${pKey}-tool-slots"></div>
        </div>
      `;

      // Clicking rival station selects them as target
      if (!rival.isEliminated) {
        station.style.cursor = 'pointer';
        station.addEventListener('click', () => {
          this.selectedTargetKey = pKey;
          this.renderTargetPicker(state, localKey);
        });
      }

      grid.appendChild(station);
      this.renderHealthCells(`${pKey}-cells`, rival.hp, state.maxHp);
      this.renderInventory(`${pKey}-tool-slots`, rival.items, pKey, rival.isJammed, false);
    });
  }

  renderTargetPicker(state, localKey) {
    const container = document.getElementById('target-chips-container');
    const subShockOpp = document.getElementById('sub-shock-opponent');
    if (!container) return;

    container.innerHTML = '';
    const aliveRivals = state.playerListKeys
      .map(k => state.players[k])
      .filter(p => p && p.key !== localKey && !p.isEliminated);

    if (aliveRivals.length === 0) return;

    // Default target selection if invalid
    if (!this.selectedTargetKey || !state.players[this.selectedTargetKey] || state.players[this.selectedTargetKey].isEliminated || this.selectedTargetKey === localKey) {
      this.selectedTargetKey = aliveRivals[0].key;
    }

    aliveRivals.forEach(r => {
      const chip = document.createElement('div');
      chip.className = `target-chip ${r.key === this.selectedTargetKey ? 'selected' : ''}`;
      chip.textContent = `🎯 ${r.name} (${r.hp} HP)`;
      chip.addEventListener('click', () => {
        window.soundFX?.playClick();
        this.selectedTargetKey = r.key;
        this.renderTargetPicker(state, localKey);
      });
      container.appendChild(chip);
    });

    const targetObj = state.players[this.selectedTargetKey];
    if (subShockOpp && targetObj) {
      subShockOpp.textContent = `Discharge into [${targetObj.name.toUpperCase()}] (${targetObj.hp} HP)`;
    }
  }

  manageCriticalTimer(state) {
    const criticalTag = document.getElementById('critical-timer-tag');
    const activePlayer = state.players[state.activePlayerKey];

    if (activePlayer && activePlayer.hp <= 1 && !state.gameOver && !activePlayer.isEliminated) {
      if (criticalTag) {
        criticalTag.style.display = 'inline-block';
        criticalTag.textContent = `CRITICAL VOLTAGE: ${this.criticalTimeLeft}s`;
      }

      if (!this.criticalTimer) {
        this.criticalTimeLeft = 10;
        this.criticalTimer = setInterval(() => {
          this.criticalTimeLeft--;
          window.soundFX.playCriticalAlarm();
          if (criticalTag) criticalTag.textContent = `CRITICAL VOLTAGE: ${this.criticalTimeLeft}s`;

          if (this.criticalTimeLeft <= 0) {
            clearInterval(this.criticalTimer);
            this.criticalTimer = null;
            const localKey = this.getLocalPlayerKey();
            if (state.activePlayerKey === localKey && !state.gameOver) {
              this.showToast('TIME EXPIRED! AUTO-DISCHARGING NODE!');
              this.handlePlayerShock(false, this.selectedTargetKey);
            }
          }
        }, 1000);
      }
    } else {
      if (this.criticalTimer) {
        clearInterval(this.criticalTimer);
        this.criticalTimer = null;
      }
      if (criticalTag) criticalTag.style.display = 'none';
    }
  }

  renderHealthCells(containerId, currentHp, maxHp) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    for (let i = 0; i < maxHp; i++) {
      const cell = document.createElement('div');
      cell.className = 'voltage-cell';

      if (i < currentHp) {
        cell.classList.add('charged');
        if (currentHp === 1) cell.classList.add('danger');
        else if (currentHp === 2 && maxHp > 3) cell.classList.add('warning');
      }
      container.appendChild(cell);
    }
  }

  renderInventory(containerId, items, playerKey, isJammed = false, isMyTurn = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const isSpectator = (this.lobbyRole === 'spectator');
    const canUse = (isMyTurn && !this.engine.gameOver && !isJammed);

    for (let i = 0; i < 8; i++) {
      const slot = document.createElement('div');
      slot.className = 'tool-slot';

      if (isJammed) slot.classList.add('jammed-slot');

      if (i < items.length) {
        if (isSpectator) {
          slot.textContent = '❓';
          slot.classList.add('masked');
        } else {
          const itemType = items[i];
          const itemDef = window.ITEMS[itemType];
          slot.textContent = itemDef?.icon || '⚙️';
          slot.title = `${itemDef?.name || itemType}: ${itemDef?.description || ''}`;

          const badge = document.createElement('span');
          badge.className = 'slot-badge';
          badge.textContent = itemDef?.shortName || '';
          slot.appendChild(badge);

          // STRICT TURN ENFORCEMENT: Toast warning if clicked out of turn
          slot.addEventListener('click', () => {
            if (!isMyTurn) {
              window.soundFX?.playClick();
              this.showToast('Not your turn! You can only use items during your turn.');
              return;
            }
            if (canUse) {
              if (window.innerWidth < 640) {
                this.mobilePendingItem = { playerKey, itemIndex: i, itemType };
                this.showMobileItemModal(itemDef);
              } else {
                this.executeItemUse(playerKey, i, itemType);
              }
            }
          });
        }
      } else {
        slot.classList.add('empty');
      }

      container.appendChild(slot);
    }
  }

  showMobileItemModal(itemDef) {
    const icon = document.getElementById('mobile-item-icon');
    const title = document.getElementById('mobile-item-title');
    const desc = document.getElementById('mobile-item-desc');
    if (icon) icon.textContent = itemDef.icon;
    if (title) title.textContent = itemDef.name;
    if (desc) desc.textContent = itemDef.description;
    this.openModal('modal-mobile-item');
  }

  executeItemUse(playerKey, itemIndex, itemType) {
    window.soundFX.playClick();

    const res = this.engine.useItem(playerKey, itemIndex);
    if (!res || !res.success) {
      if (res?.reason) this.showToast(res.reason);
      return;
    }

    if (!this.isBotGame && window.multiplayerManager) {
      window.multiplayerManager.sendGameAction({
        type: 'USE_ITEM',
        playerKey,
        itemIndex
      }, this.currentUser.id);
    }

    if (itemType === 'multimeter') {
      window.soundFX.playScannerBeep(res.peek === 'LIVE');
      this.showSecretPeek(res.peek);
    } else if (itemType === 'wire_cutters') {
      window.soundFX.playCutters();
      this.canvasFX.setState('dud');
      setTimeout(() => this.canvasFX.setState('idle'), 400);
    } else if (itemType === 'voltage_booster') {
      window.soundFX.playBooster();
    } else if (itemType === 'insulated_glove') {
      window.soundFX.playGlove();
    } else if (itemType === 'circuit_tap') {
      window.soundFX.playCircuitTap();
    } else if (itemType === 'signal_jammer') {
      window.soundFX.playJammer();
    }
  }

  showSecretPeek(wireType) {
    const toast = document.getElementById('peek-toast');
    const icon = document.getElementById('peek-icon');
    const text = document.getElementById('peek-text');
    if (!toast) return;

    if (wireType === 'LIVE') {
      icon.textContent = '⚡';
      text.textContent = 'CHAMBER: LIVE WIRE';
      text.style.color = 'var(--neon-pink)';
    } else {
      icon.textContent = '⚪';
      text.textContent = 'CHAMBER: DUD WIRE';
      text.style.color = 'var(--neon-cyan)';
    }

    toast.style.display = 'flex';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 2200);
  }

  // Handle Player Primary Shock with Target Selection & 3-Second Intense Buildup Sequence
  async handlePlayerShock(isSelf, targetKey) {
    const localKey = this.getLocalPlayerKey();
    if (this.engine.activePlayerKey !== localKey || this.engine.gameOver) return;

    const actualTargetKey = isSelf ? localKey : (targetKey || this.selectedTargetKey);
    if (!actualTargetKey) return;

    document.getElementById('btn-shock-opponent').disabled = true;
    document.getElementById('btn-shock-self').disabled = true;

    if (this.criticalTimer) {
      clearInterval(this.criticalTimer);
      this.criticalTimer = null;
    }

    if (!this.isBotGame && window.multiplayerManager) {
      window.multiplayerManager.sendGameAction({
        type: 'SHOCK_TARGET',
        shooterKey: localKey,
        targetKey: actualTargetKey
      }, this.currentUser.id);
    }

    const oscStatus = document.getElementById('osc-status-text');
    const activeName = this.engine.getActivePlayer().name;
    if (oscStatus) {
      oscStatus.textContent = `⚡ [${activeName.toUpperCase()}] CHARGING NODE... REVEAL IN 3s`;
      oscStatus.style.color = 'var(--neon-amber)';
    }

    this.canvasFX.setState('buildup');
    await window.soundFX.playIntenseRevealBeat(3000);

    // Execute shock on engine
    this.engine.shockTarget(localKey, actualTargetKey);
  }

  // Handle game events and animations
  async handleGameEvents(snapshot, eventMeta) {
    const { type, isLive, damage, wasBoosted, extraTurn, shooterKey, targetKey } = eventMeta;

    if (type === 'ACTION_SHOCK_OPPONENT' || type === 'ACTION_SHOCK_SELF') {
      if (isLive) {
        window.soundFX.playShockZap(wasBoosted);
        this.canvasFX.setState('shock');
        this.canvasFX.triggerSparks(0.5, 0.5, wasBoosted ? 55 : 35, '#ff0055');

        const targetStationId = `station-${targetKey}`;
        this.canvasFX.triggerHitFlash(targetStationId, '#ff0055');
      } else {
        window.soundFX.playDudClick();
        this.canvasFX.setState('dud');
      }

      await this.delay(650);
      this.canvasFX.setState('idle');

      if (extraTurn) {
        this.showToast('EXTRA TURN EARNED! DUD SURVIVED.');
      }
    }

    if (snapshot.gameOver) {
      await this.delay(800);
      this.showMatchOver(snapshot);
      return;
    }

    // Trigger AI Bot turn if current active player is a Bot
    const activeObj = snapshot.players[snapshot.activePlayerKey];
    if (activeObj && activeObj.isBot && !snapshot.gameOver) {
      if (this.botAI) {
        this.botAI.botKey = snapshot.activePlayerKey;
        this.botAI.thinkAndAct();
      }
    }
  }

  showMatchOver(snapshot) {
    window.soundFX.stopAmbient();
    window.soundFX.stopTension();

    if (this.criticalTimer) {
      clearInterval(this.criticalTimer);
      this.criticalTimer = null;
    }

    const winnerObj = snapshot.winner;
    const localKey = this.getLocalPlayerKey();
    const amIWinner = (winnerObj && winnerObj.key === localKey);

    const winnerAvatarImg = document.getElementById('winner-avatar-img');
    const winnerTitle = document.getElementById('winner-title');
    const winnerMsg = document.getElementById('winner-message');

    if (winnerAvatarImg && winnerObj) {
      winnerAvatarImg.src = winnerObj.avatar || window.discordBridge.generateNeonAvatar(winnerObj.name, winnerObj.isBot);
    }

    if (this.lobbyRole !== 'spectator') {
      this.saveRecord(amIWinner);
    }

    if (amIWinner) {
      winnerTitle.textContent = 'VICTORY ACHIEVED';
      winnerTitle.style.color = 'var(--neon-green)';
      winnerMsg.textContent = `${winnerObj ? winnerObj.name : 'You'} successfully grounded all rivals and survived the circuit!`;
      window.soundFX.playVictory();
    } else {
      winnerTitle.textContent = 'CIRCUIT OVERLOAD (DEFEAT)';
      winnerTitle.style.color = 'var(--neon-pink)';
      winnerMsg.textContent = `${winnerObj ? winnerObj.name : 'Rival'} claimed total victory. Your terminal suffered critical voltage collapse.`;
      window.soundFX.playDefeat();
    }

    this.openModal('modal-match-over');
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new ShortCircuitApp();
});
