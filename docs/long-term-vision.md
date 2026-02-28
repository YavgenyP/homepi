# Long-Term Vision & Invariants

## Future integrations (not v0)
- Google Home
- Samsung SmartThings (or similar)
- Minimal Android app (only if explicitly needed)

These must be implemented as adapters around stable trigger/action interfaces.
Do not rewrite core scheduling/presence/rule logic to support integrations.

## Anti-bloat
- No code “just in case”
- No UX features beyond Discord without explicit request
- Prefer small, observable, composable components
