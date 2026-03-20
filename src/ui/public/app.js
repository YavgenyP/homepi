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
    // Weather screen
    weather: null,
    weatherError: null,
    _weatherTimer: null,
    // Photo slideshow
    photos: [],
    slideIndex: 0,
    _slideTimer: null,
    // Chat mic
    micRecording: false,
    // YouTube player
    ytQuery: "",
    ytResults: [],
    ytSearching: false,
    ytIframe: null,  // video ID when watching, null when hidden
    // Weather overlay
    weatherOverlay: false,
    selectedDay: null,

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
      this._fetchPhotos();
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
          // Close iframe and clear search results when leaving media
          this.ytIframe = null;
          this.ytResults = [];
        }
        if (val === "weather") {
          this._fetchWeather();
          this._weatherTimer = setInterval(() => this._fetchWeather(), 10 * 60 * 1000);
        } else {
          clearInterval(this._weatherTimer);
          this._weatherTimer = null;
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
      this._idleTimer = setTimeout(() => {
        this.idle = true;
        this._startSlideshow();
      }, this.IDLE_MS);
    },

    wakeUp() {
      if (this.idle) {
        this.idle = false;
        this._stopSlideshow();
      }
      this._resetIdle();
    },

    _startSlideshow() {
      if (this.photos.length === 0) return;
      this._slideTimer = setInterval(() => {
        this.slideIndex = (this.slideIndex + 1) % this.photos.length;
      }, 5000);
    },

    _stopSlideshow() {
      clearInterval(this._slideTimer);
      this._slideTimer = null;
    },

    async _fetchPhotos() {
      try {
        const r = await fetch("/photos");
        if (!r.ok) return;
        this.photos = await r.json();
      } catch { /* offline */ }
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

    // ── Weather ──────────────────────────────────────────────────────────────
    async _fetchWeather() {
      try {
        const r = await fetch("/weather");
        if (!r.ok) { this.weatherError = "Weather unavailable"; return; }
        const data = await r.json();
        if (!data) { this.weatherError = null; this.weather = null; return; }
        this.weather = data;
        this.weatherError = null;
      } catch { this.weatherError = "Weather unavailable"; }
    },


    // ── Weather overlay ──────────────────────────────────────────────────────
    openWeatherOverlay() {
      if (this.weather?.windyUrl) this.weatherOverlay = true;
    },

    closeWeatherOverlay() {
      this.weatherOverlay = false;
    },

    selectDay(day) {
      this.selectedDay = day;
    },

    closeDayDetail() {
      this.selectedDay = null;
    },

    // ── Media ────────────────────────────────────────────────────────────────
    async _fetchNowPlaying() {
      try {
        const r = await fetch("/now-playing");
        if (!r.ok) return;
        this.nowPlaying = await r.json();
      } catch { /* offline */ }
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

    // ── YouTube search + player ───────────────────────────────────────────────
    async searchYouTube() {
      const q = this.ytQuery.trim();
      if (!q || this.ytSearching) return;
      this.ytSearching = true;
      this.ytResults = [];
      try {
        const r = await fetch("/youtube-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
        });
        if (r.ok) {
          const data = await r.json();
          this.ytResults = Array.isArray(data) ? data : [];
        }
      } catch { /* offline */ }
      finally { this.ytSearching = false; }
    },

    async playYtResult(v) {
      const url = v.url ?? ("https://www.youtube.com/watch?v=" + v.id);
      // Optimistically update now-playing immediately
      this.nowPlaying = { source: url, title: v.title };
      this._resetIdle();
      try {
        await fetch("/play-pi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, title: v.title }),
        });
      } catch { /* offline */ }
    },

    watchYtResult(id) {
      this.ytIframe = id;
      this.wakeUp();
    },

    closeIframe() {
      this.ytIframe = null;
    },

    async stopSound() {
      try {
        await fetch("/stop-sound", { method: "POST" });
      } catch { /* offline */ }
    },

    // ── Chat + mic ───────────────────────────────────────────────────────────
    async toggleMic() {
      if (this.micRecording) return; // prevent double-tap mid-recording
      this.micRecording = true;
      this._resetIdle();
      try {
        const r = await fetch("/mic", { method: "POST" });
        const data = await r.json();
        if (data.transcript) this._addMessage(data.transcript, "local");
        if (data.reply) this._addMessage(data.reply, "bot");
        if (data.error) this._addMessage("⚠ " + data.error, "bot");
      } catch {
        this._addMessage("⚠ Mic unavailable", "bot");
      } finally {
        this.micRecording = false;
      }
    },

    submitChat() {
      const text = this.chatInput.trim();
      if (!text) return;
      this.chatInput = "";
      this.sendCommand(text);
    },
  };
}
