# .env.example

# Discord
DISCORD_TOKEN=
DISCORD_CHANNEL_ID=

# OpenAI
OPENAI_API_KEY=
LLM_MODEL=gpt-4o
LLM_CONFIDENCE_THRESHOLD=0.75
LLM_EVAL_SAMPLING_RATE=0.05

# Timezone — must match the Pi's local timezone so time-based rules fire at the right local time.
# The Docker container defaults to UTC; without this, the LLM computes all times in UTC.
# Find your value with: timedatectl | grep "Time zone"
TZ=Asia/Jerusalem

# Storage
SQLITE_PATH=/data/app.db

# Presence
PRESENCE_PING_INTERVAL_SEC=30
PRESENCE_PING_TIMEOUT_MS=1000

PRESENCE_BLE_ENABLED=false
PRESENCE_BLE_SCAN_INTERVAL_SEC=20

PRESENCE_DEBOUNCE_SEC=60
PRESENCE_HOME_TTL_SEC=180

# Scheduler
SCHEDULER_INTERVAL_SEC=30

# Server
PORT=3000
