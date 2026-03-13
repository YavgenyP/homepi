/* homepi touchscreen app — Alpine.js */
function app() {
  return {
    // ── State ───────────────────────────────────────────────────────────────
    tab: "home",
    clock: "",
    date: "",
    people: [],
    topCommands: [],
    shortcuts: [],
    messages: [],       // { id, text, source: "bot"|"local" }
    chatInput: "",
    idle: false,
    volume: 50,
    // Devices screen
    allDevices: [],     // enriched with haState + domain
    deviceRoom: null,   // null = All
    _devicesTimer: null,
    // Media screen
    nowPlaying: null,
    _mediaTimer: null,

    // ── Internals ───────────────────────────────────────────────────────────
    _ws: null,
    _msgId: 0,
    _clockTimer: null,
    _idleTimer: null,
    _stateTimer: null,
    IDLE_MS: 5 * 60 * 1000,

    // ── Init ────────────────────────────────────────────────────────────────
    init() {
      this._tickClock();
      this._clockTimer = setInterval(() => this._tickClock(), 1000);
      this._connectWS();
      this._fetchState();
      this._stateTimer = setInterval(() => this._fetchState(), 10_000);
      // Watch tab changes to start/stop polling
      this.$watch("tab", (val) => {
        if (val === "devices") {
          this.refreshDevices();
          this._devicesTimer = setInterval(() => this.refreshDevices(), 3000);
        } else {
          clearInterval(this._devicesTimer);
          this._devicesTimer = null;
        }
        if (val === "media") {
          this._fetchNowPlaying();
          this._mediaTimer = setInterval(() => this._fetchNowPlaying(), 5000);
        } else {
          clearInterval(this._mediaTimer);
          this._mediaTimer = null;
        }
      });
      this._resetIdle();
      document.addEventListener("pointerdown", () => this.wakeUp());
    },

    // ── Clock ────────────────────────────────────────────────────────────────
    _tickClock() {
      const now = new Date();
      this.clock = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      this.date  = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    },

    // ── Idle ─────────────────────────────────────────────────────────────────
    _resetIdle() {
      clearTimeout(this._idleTimer);
      this._idleTimer = setTimeout(() => { this.idle = true; }, this.IDLE_MS);
    },

    wakeUp() {
      if (this.idle) { this.idle = false; }
      this._resetIdle();
    },

    // ── REST /ui-state ───────────────────────────────────────────────────────
    async _fetchState() {
      try {
        const r = await fetch("/ui-state");
        if (!r.ok) return;
        const data = await r.json();
        this.people      = data.people      ?? [];
        this.topCommands = data.topCommands ?? [];
        this.shortcuts   = data.shortcuts   ?? [];
      } catch { /* offline */ }
    },

    // ── WebSocket ─────────────────────────────────────────────────────────────
    _connectWS() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this._ws = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "message" || msg.type === "reply") {
            this._addMessage(msg.text, "bot");
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        // Reconnect after 3s
        setTimeout(() => this._connectWS(), 3000);
      };
    },

    _addMessage(text, source) {
      const id = ++this._msgId;
      this.messages.push({ id, text, source });
      // Keep last 100 messages
      if (this.messages.length > 100) this.messages.shift();

      // Auto-scroll chat list
      this.$nextTick(() => {
        const el = this.$refs.chatList;
        if (el) el.scrollTop = el.scrollHeight;
      });
    },

    // ── Commands ─────────────────────────────────────────────────────────────
    sendCommand(text) {
      if (!text) return;
      this._addMessage(text, "local");
      this._resetIdle();
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(text);
      }
    },

    // ── Devices screen ───────────────────────────────────────────────────────
    get deviceRooms() {
      const rooms = [...new Set(this.allDevices.map((d) => d.room).filter(Boolean))];
      return rooms.sort();
    },

    get filteredDevices() {
      if (!this.deviceRoom) return this.allDevices;
      return this.allDevices.filter((d) => d.room === this.deviceRoom);
    },

    async refreshDevices() {
      try {
        const r = await fetch("/devices-state");
        if (!r.ok) return;
        this.allDevices = await r.json();
      } catch { /* offline */ }
    },

    // Send a natural-language command for a device and broadcast the reply
    async cmd(dev, text) {
      this._addMessage(text, "local");
      this._resetIdle();
      try {
        const r = await fetch("/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = await r.json();
        if (data.reply) this._addMessage(data.reply, "bot");
        // Refresh device state after command
        setTimeout(() => this.refreshDevices(), 1000);
      } catch { /* offline */ }
    },

    // ── Media ────────────────────────────────────────────────────────────────
    async _fetchNowPlaying() {
      try {
        const r = await fetch("/now-playing");
        if (!r.ok) return;
        this.nowPlaying = await r.json();
      } catch { /* offline */ }
    },

    mediaCmd(action) {
      if (!this.nowPlaying) return;
      const name = this.nowPlaying.name;
      const cmds = {
        play:  `play the ${name}`,
        pause: `pause the ${name}`,
        stop:  `stop the ${name}`,
        prev:  `previous track on the ${name}`,
        next:  `next track on the ${name}`,
      };
      const text = cmds[action];
      if (text) this.sendCommand(text);
    },

    // ── Volume ───────────────────────────────────────────────────────────────
    async setVolume(level) {
      this.volume = Math.max(0, Math.min(100, Math.round(level)));
      try {
        await fetch("/volume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level: this.volume }),
        });
      } catch { /* offline */ }
    },

    adjustVolume(delta) {
      this.setVolume(this.volume + delta);
    },

    async stopSound() {
      try {
        await fetch("/stop-sound", { method: "POST" });
      } catch { /* offline */ }
    },

    // ── Chat ─────────────────────────────────────────────────────────────────
    submitChat() {
      const text = this.chatInput.trim();
      if (!text) return;
      this.chatInput = "";
      this.sendCommand(text);
    },
  };
}
