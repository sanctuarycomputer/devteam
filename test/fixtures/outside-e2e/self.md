# Self

Tillstack is a checkout for independent shops. It makes the checkout page and the payments behind it.

Its parts are the checkout page shoppers pay on and the payments service that takes their cards through Stripe.

It controls its code, its releases and its pages. It depends on Stripe, which takes the payments, but does not control it.

```self
{
  "self": 1,
  "what": "A checkout for independent shops that sell online and in person.",
  "makes": "The checkout page and the payments behind it.",
  "parts": [
    { "id": "checkout", "name": "Checkout page", "what": "The page shoppers pay on.", "code": ["src/checkout/"] },
    { "id": "payments", "name": "Payments service", "what": "Takes shoppers' cards and settles each sale.", "code": ["src/payments/"] }
  ],
  "controls": ["its code", "its releases", "its pages"],
  "not": ["the card network that settles the payments"]
}
```
