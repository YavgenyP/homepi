# Demo / Acceptance Script (v0)

## Setup
1) `docker compose up --build`
2) Invite the bot to your Discord server.
3) Ensure bot can read/post in the target channel.
4) Ensure Pi timezone is configured correctly (used for scheduling).

## Happy path
### Pairing
User: "register my phone 192.168.1.23"
Bot: confirms registration

(Optional) User: "register my ble aa:bb:cc:dd:ee:ff"
Bot: confirms registration

### Who's home
User: "who's home?"
Bot: lists home/away

### Time rule
User: "tomorrow at 8 remind me to take out trash"
Bot: confirms scheduled notification

### Arrival rule
User: "when I arrive home tell me welcome home"
Bot: confirms arrival notification

## Clarification example
User: "remind me in the morning to pay rent"
Bot: asks for time

## Failure behavior
If OpenAI fails:
Bot: posts error and performs no state changes.

## Acceptance
- Time rule fires at expected local time
- Arrival rule fires on away→home transition
