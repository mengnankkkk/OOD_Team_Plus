<!-- OMO_INTERNAL_INITIATOR -->

- Watchlists/notifications/RSS schema should stay Zod-first: keep validation in `src/server/db/schema/watchlists.ts` and avoid sqlite-backed tests.
- App-layer uniqueness matters for active watchlist items; do not add a DB uniqueness constraint that blocks soft removal flows.
- RSS item storage must remain summary-only; never persist full article bodies in the DB schema or migration.
