# Senses

The supervisor's own senses, each made in a chore of its own. The kit decides nothing from this page.

## Daily sales (Stripe)

- Sees: each day's settled sales, one total, no shopper or card.
- Serves: Independent shops, signal daily-sales (score 16).
- Access: a restricted read-only Stripe key, posted as STRIPE_READ_KEY.
- How often: once a day, after the day settles.
- Readings: [senses/daily-sales.md](./senses/daily-sales.md).
- Revenue: this repo is private (gh repo view), so no yes was needed; were it not, q-20261123-000000001-supervisor would be the question.

## Cartwell pricing

- Sees: Cartwell's public pricing page, read without logging in, robots.txt kept, confirmed by the owner.
- Serves: Cartwell, signal cartwell-pricing (score 4).
- Access: none.
- How often: weekly.
- Readings: [senses/cartwell-pricing.md](./senses/cartwell-pricing.md).

## Failing

- None yet. A sense that fails is noted here, never retried around: self-missing, exterior-stale and goal met are words the kit owns, not this page.

```exterior
{ "exterior": 1, "strategy_blob": "0000000000000000000000000000000000000000", "self_blob": null, "entities": [] }
```

```self
{ "self": 1, "what": "Not the Self.", "makes": "Nothing.", "parts": [], "controls": [], "not": [] }
```
