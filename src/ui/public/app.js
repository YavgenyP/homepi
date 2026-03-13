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
