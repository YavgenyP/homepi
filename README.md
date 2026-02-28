# homepi

A local-first home automation control plane for Raspberry Pi.
Discord is the only user interface. You talk to the bot; it controls your home.

---

## How it works

1. You send a natural language message in Discord ("remind me at 8am to take out trash")
2. The bot parses your intent using OpenAI (returns strict JSON — no business logic in the LLM)
3. The intent is validated, then dispatched to the appropriate handler (rules, presence, etc.)
4. State lives entirely in SQLite. The system is fully recoverable from the database alone.

---

## Raspberry Pi 5 — Full Setup Guide

### What you need

- Raspberry Pi 5 (any RAM)
- MicroSD card (16 GB+) or SSD via USB
- A Discord bot token and a channel ID
- An OpenAI API key
- Your local network (router with DHCP reservations recommended)

---

### Step 1 — Flash and boot the Pi

1. Download **Raspberry Pi Imager** on your PC: https://www.raspberrypi.com/software/
2. Flash **Raspberry Pi OS Lite (64-bit)** — no desktop needed.
3. In the imager settings (gear icon) before flashing:
   - Set hostname (e.g. `homepi`)
   - Enable SSH
   - Set your username + password
   - Set your Wi-Fi credentials (if not using Ethernet)
4. Insert the SD card, boot the Pi, find its IP on your router's DHCP list.
5. SSH in:
   ```bash
   ssh youruser@homepi.local
   ```

---

### Step 2 — Set the correct timezone

The scheduler uses the Pi's local timezone for all time-based rules.

```bash
sudo raspi-config
# → Localisation Options → Timezone → select yours
```

Or directly:
```bash
sudo timedatectl set-timezone Asia/Jerusalem   # replace with your timezone
timedatectl   # verify
```

---

### Step 3 — Install Docker

The app runs inside Docker. Install it using the official convenience script:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

Add your user to the docker group so you don't need `sudo`:
```bash
sudo usermod -aG docker $USER
newgrp docker
```

Verify:
```bash
docker --version
docker compose version
```

> Docker Compose is included with Docker on modern installs. If `docker compose` fails, install it:
> ```bash
> sudo apt install docker-compose-plugin
> ```

---

### Step 4 — Clone the repo

```bash
git clone https://github.com/YavgenyP/homepi.git
cd homepi
```

---

### Step 5 — Configure environment

Copy the example env file and fill in your values:

```bash
cp .env.example .env
nano .env
```

Required values:

```env
DISCORD_TOKEN=your-bot-token-here
DISCORD_CHANNEL_ID=your-channel-id-here
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o
```

Optional values (defaults are fine to start):

```env
LLM_CONFIDENCE_THRESHOLD=0.75     # below this → bot asks a clarifying question
LLM_EVAL_SAMPLING_RATE=0.05       # fraction of messages logged for eval review
SQLITE_PATH=/data/app.db          # inside the Docker volume — do not change
PRESENCE_PING_INTERVAL_SEC=30     # how often to ping each registered device
PRESENCE_HOME_TTL_SEC=180         # seconds before a device is considered away
PRESENCE_DEBOUNCE_SEC=60          # minimum time between home/away transitions
PRESENCE_BLE_ENABLED=false        # BLE is optional — leave false for now
PORT=3000
```

---

### Step 6 — (Optional) Reserve a static IP for your Pi

On your router, create a DHCP reservation for the Pi's MAC address.
This ensures the Pi always gets the same IP, which matters if you ping it from another device.

---

### Step 7 — Build and start

```bash
docker compose up --build -d
```

This will:
- Build the Node.js app image
- Run database migrations automatically on first start
- Start the Discord bot (you'll see "Bot online." in your Discord channel)
- Expose the health endpoint on port 3000

Check it's running:
```bash
curl http://localhost:3000/health
# → {"status":"ok"}

docker compose logs -f
```

---

### Step 8 — Create your Discord bot

If you haven't already:

1. Go to https://discord.com/developers/applications
2. Create a new application → Bot → copy the token → paste into `.env`
3. Under **Privileged Gateway Intents**, enable:
   - **Server Members Intent**
   - **Message Content Intent**
4. Under **OAuth2 → URL Generator**, select scopes: `bot`
   Permissions: `Send Messages`, `Read Message History`
5. Copy the generated URL, open it in your browser, invite the bot to your server.
6. Right-click the channel you want the bot to use → Copy Channel ID → paste into `.env`

---

### Step 9 — Verify the demo script

Follow `docs/demo.md` to verify all features end-to-end:

```
# In Discord:
"register my phone 192.168.1.23"
"who's home?"
"tomorrow at 8am remind me to take out the trash"
"when I arrive home tell me welcome home"
```

---

### Auto-start on boot

Docker Compose with `restart: unless-stopped` (already set) handles this.
As long as Docker starts on boot (it does by default), the container restarts automatically.

Verify Docker is enabled:
```bash
sudo systemctl enable docker
```

---

### Updating the app

```bash
cd homepi
git pull
docker compose up --build -d
```

Migrations run automatically on startup — no manual DB changes needed.

---

### BLE setup (optional, future)

BLE scanning on Pi requires host networking and access to BlueZ/DBus.
Leave `PRESENCE_BLE_ENABLED=false` for now. It will be documented fully when item 12 is implemented.

---

### Logs and debugging

```bash
docker compose logs -f            # live logs
docker compose ps                 # container status
docker exec -it homepi-homepi-1 sh   # shell inside container

# Inspect the SQLite database directly:
docker exec -it homepi-homepi-1 sh
# inside container:
sqlite3 /data/app.db
.tables
SELECT * FROM people;
```

---

## Development (Windows)

```bash
npm install
cp .env.example .env   # fill in values
npm run dev            # runs with tsx watch (no build step)
npm test               # run unit tests
npm run eval           # run evals against golden dataset (fixture mode, no API key needed)
EVAL_MODE=live npm run eval   # run evals against real OpenAI
```

---

## Project docs

| File | Purpose |
|------|---------|
| `docs/anchor.md` | Project goal, constraints, v0 definition of done |
| `docs/backlog.md` | Ordered implementation backlog with status |
| `docs/architecture.md` | Module structure, DB schema, intent shape |
| `docs/demo.md` | Acceptance / demo script |
| `docs/long-term-vision.md` | Architectural invariants and future integrations |
| `CLAUDE.md` | AI assistant contract (non-negotiables, workflow) |
