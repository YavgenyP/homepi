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

## Environment variables

All configuration is done via environment variables (`.env` file, or your shell environment).

### Required

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Your Discord bot token. Get it from the [Developer Portal](https://discord.com/developers/applications). |
| `DISCORD_CHANNEL_ID` | ID of the Discord channel the bot listens and replies in. Right-click the channel → Copy Channel ID. |
| `OPENAI_API_KEY` | OpenAI API key for intent parsing. |

### Optional (defaults shown)

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_MODEL` | `gpt-4o` | OpenAI model used for intent parsing. |
| `LLM_CONFIDENCE_THRESHOLD` | `0.75` | If the model's confidence is below this, the bot asks a clarifying question instead of acting. |
| `LLM_EVAL_SAMPLING_RATE` | `0.05` | Fraction of messages logged to `llm_message_log` for offline eval review (0 = disabled, 1 = all). |
| `SQLITE_PATH` | `./app.db` | Path to the SQLite database file. Inside Docker the volume mounts at `/data`, so use `/data/app.db`. |
| `PRESENCE_PING_INTERVAL_SEC` | `30` | How often to ping all registered devices (seconds). |
| `PRESENCE_PING_TIMEOUT_MS` | `1000` | Ping timeout per device (milliseconds). |
| `PRESENCE_HOME_TTL_SEC` | `180` | How long since last sighting before a person is marked "away". |
| `PRESENCE_DEBOUNCE_SEC` | `60` | Minimum time between home↔away state transitions (prevents flapping). |
| `PRESENCE_BLE_ENABLED` | `false` | Enable BLE scanning via bluetoothctl (Raspberry Pi only — see BLE section). |
| `PRESENCE_BLE_SCAN_INTERVAL_SEC` | `20` | Duration of each BLE scan window (seconds). |
| `SCHEDULER_INTERVAL_SEC` | `30` | How often the scheduler checks for due jobs (seconds). |
| `PORT` | `3000` | Port for the `/health` HTTP endpoint (used by Docker healthcheck). |

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

### Step 4 — Authenticate with the private Docker image registry

The prebuilt image lives at `ghcr.io/yavgenyp/homepi` (GitHub Container Registry) and is **private**.
You need a GitHub Personal Access Token (PAT) with `read:packages` scope to pull it.

1. Go to https://github.com/settings/tokens → **Generate new token (classic)**
2. Select scope: **`read:packages`**
3. Copy the token, then on the Pi:

```bash
echo YOUR_PAT | docker login ghcr.io -u YavgenyP --password-stdin
```

You should see `Login Succeeded`. Docker stores the credentials in `~/.docker/config.json` — you only need to do this once.

---

### Step 5 — Clone the repo

```bash
git clone https://github.com/YavgenyP/homepi.git
cd homepi
```

---

### Step 6 — Configure environment

Copy the example env file and fill in your values:

```bash
cp .env.example .env
nano .env
```

Minimum required:

```env
DISCORD_TOKEN=your-bot-token-here
DISCORD_CHANNEL_ID=your-channel-id-here
OPENAI_API_KEY=sk-...
SQLITE_PATH=/data/app.db
```

See the [Environment variables](#environment-variables) table above for all options.

---

### Step 7 — (Optional) Reserve a static IP for your Pi

On your router, create a DHCP reservation for the Pi's MAC address.
This ensures the Pi always gets the same IP, which matters if you ping it from another device.

---

### Step 8 — Pull and start

```bash
docker compose pull          # pulls ghcr.io/yavgenyp/homepi:latest
docker compose up -d         # starts in the background
```

This will:
- Pull the prebuilt ARM64 image (no compilation on the Pi)
- Run database migrations automatically on first start
- Start the Discord bot (you'll see "Bot online." posted in your Discord channel)
- Expose the health endpoint on port 3000

Check it's running:
```bash
curl http://localhost:3000/health
# → {"status":"ok"}

docker compose logs -f
```

---

### Step 9 — Create your Discord bot

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

### Step 10 — Verify the demo script

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

When a new version is pushed to `main`, CI builds and pushes a new image automatically. To update the Pi:

```bash
cd homepi
git pull                     # get the latest docker-compose.yml
docker compose pull          # pull the new image from GHCR
docker compose up -d         # restart with the new image
```

Migrations run automatically on startup — no manual DB changes needed.

---

### REPL — inspect and control live state over SSH

```bash
docker exec -it homepi-homepi-1 npm run repl
```

Available commands:

| Command | Description |
|---------|-------------|
| `status` | Current presence state for all people |
| `people` | All registered people and their devices |
| `rules` | All rules with trigger and action |
| `jobs` | Scheduled job queue |
| `enable <id>` | Enable a rule |
| `disable <id>` | Disable a rule |
| `delete <id>` | Delete a rule and its jobs |
| `help` | Show all commands |
| `exit` | Quit |

---

### BLE presence (optional, Raspberry Pi only)

BLE scanning detects presence via Bluetooth MAC addresses (phones, trackers, etc.).

Requirements:
```bash
sudo apt install bluez
```

In your `.env`:
```env
PRESENCE_BLE_ENABLED=true
PRESENCE_BLE_SCAN_INTERVAL_SEC=20
```

In `docker-compose.yml`, uncomment the BLE section (network_mode: host, dbus volume, NET_ADMIN cap).

Then register a BLE device via Discord:
```
register my ble aa:bb:cc:dd:ee:ff
```

---

### Logs and debugging

```bash
docker compose logs -f            # live logs
docker compose ps                 # container status

# Shell inside the container:
docker exec -it homepi-homepi-1 sh

# Inspect the SQLite database directly (inside container):
sqlite3 /data/app.db
.tables
SELECT * FROM people;
SELECT * FROM rules;
```

---

## CI / Docker image

Every push to `main`:
1. Runs all tests (`npm test`)
2. Builds a multi-platform Docker image (`linux/amd64` + `linux/arm64`)
3. Pushes to `ghcr.io/yavgenyp/homepi:latest` and `ghcr.io/yavgenyp/homepi:sha-<commit>`

The image is **private**. After the first CI push, set the package visibility:
**GitHub → your profile → Packages → homepi → Package settings → Change visibility → Private**

Pull requests only run tests — no image is built or pushed.

---

## Development (local)

```bash
npm install
cp .env.example .env   # fill in values
npm run dev            # runs with tsx watch (no build step)
npm test               # run unit tests
npm run eval           # run evals (fixture mode, no API key needed)
EVAL_MODE=live npm run eval   # run evals against real OpenAI

# Build and run Docker locally (bypasses GHCR):
docker compose up --build
```

---

## Project docs

| File | Purpose |
|------|---------|
| `docs/anchor.md` | Project goal, constraints, v0 definition of done |
| `docs/backlog.md` | Ordered implementation backlog with status |
| `docs/architecture.md` | Module structure, DB schema, intent shape |
| `docs/demo.md` | Acceptance / demo script |
| `docs/env.md` | Environment variable reference |
| `docs/long-term-vision.md` | Architectural invariants and future integrations |
| `CLAUDE.md` | AI assistant contract (non-negotiables, workflow) |
