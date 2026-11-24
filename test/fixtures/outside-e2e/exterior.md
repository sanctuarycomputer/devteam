# Exterior

What Tillstack relates to, by how each relates to it.

It serves independent shops that sell online and in person. It depends on Stripe, which takes every payment. Cartwell is its alternative: shops leave it when it gets in their way.

```exterior
{
  "exterior": 1,
  "strategy_blob": "STRATEGY_BLOB",
  "self_blob": "SELF_BLOB",
  "entities": [
    {
      "id": "shops", "name": "Independent shops", "relation": "serves", "kind": "group",
      "matters": "They are who it is for: a sale lost at their till is the one thing that counts.", "weight": 4,
      "strategy": ["Independent shops that sell online and in person."],
      "signals": [
        { "id": "daily-sales", "what": "Each shop's settled sales per day, as one total.", "value": 4 },
        { "id": "checkout-visits", "what": "Daily visits to the checkout page.", "value": 2 }
      ]
    },
    {
      "id": "stripe", "name": "Stripe", "relation": "depends_on", "kind": "organisation",
      "matters": "Payments run on it, so its fees and its outages are ours.", "weight": 3,
      "strategy": ["Payments run on Stripe, so its fees and its outages are ours."],
      "signals": [
        { "id": "stripe-incidents", "what": "Incidents on its status page.", "value": 3 },
        { "id": "stripe-fees", "what": "Its published card fees.", "value": 2 }
      ]
    },
    {
      "id": "cartwell", "name": "Cartwell", "relation": "alternative", "kind": "work",
      "matters": "The checkout shops leave for, or come from.", "weight": 2,
      "strategy": ["It is simpler than an alternative like Cartwell, which shops leave when it gets in their way."],
      "signals": [
        { "id": "cartwell-pricing", "what": "Its public pricing page.", "value": 2 }
      ]
    }
  ]
}
```
