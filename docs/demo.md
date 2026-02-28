# Demo / Acceptance Script (v0)

## Setup
1. `docker compose up --build`
2. Invite the bot to your Discord server.
3. Ensure bot can read/post in the target channel.
4. Ensure Pi timezone is configured correctly (used for scheduling).

## Happy path

### Pairing
```
User: "register my phone 192.168.1.23"
Bot:  "Registered your phone (192.168.1.23). I'll use it for presence detection."
```
```
(Optional) User: "register my ble aa:bb:cc:dd:ee:ff"
Bot:  "Registered your BLE device (aa:bb:cc:dd:ee:ff). I'll use it for presence detection."
```

### Who's home
```
User: "who's home?"
Bot:  "Alice: away"   (or "home" if device responded)
```

### Time rule
```
User: "tomorrow at 8am remind me to take out the trash"
Bot:  "Rule created (#1): I'll remind you "take out the trash" at <date>."
```

### Arrival rule
```
User: "when I arrive home tell me welcome home"
Bot:  "Rule created (#2): I'll notify you "welcome home" when you arrive home."
```

### List rules
```
User: "show my rules"
Bot:
  #1 [time] <date> — "take out the trash"
  #2 [arrival] on arrival — "welcome home"
```

### Delete a rule
```
User: "delete rule 1"
Bot:  "Deleted rule #1."
```

## Clarification example
```
User: "remind me in the morning to pay rent"
Bot:  "What time in the morning should I remind you?"
```

## Failure behavior
If OpenAI fails:
```
Bot: "Error: could not reach the AI service. Please try again later."
```
No state changes are made.

## Acceptance criteria
- Pairing works (ping and BLE)
- `who's home?` reflects live presence state
- Time rule fires at expected Pi-local time
- Arrival rule fires on away→home transition
- Ambiguous messages trigger clarifying questions
- OpenAI failure → Discord error, no side effects
- Evals pass: `npm run eval` → 15/15 correct
