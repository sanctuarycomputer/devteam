# Self

Tillstack is a checkout for independent shops. It makes the checkout page and the payments behind it.

Its parts are the checkout page shoppers pay on and the payments service that takes their cards through Stripe.

It controls its code, its releases and its pages. It depends on Stripe, which takes the payments, but does not control it.

```self
{
  "self": 1,
  "what": "A checkout for independent shops.",
  "makes": "The checkout page and the payments behind it.",
  "parts": [
    { "id": "checkout", "name": "The checkout page", "what": "Where shoppers pay.", "code": ["src/checkout/"] },
    { "id": "payments", "name": "The payments service", "what": "Takes their cards through Stripe.", "code": ["src/payments/"] }
  ],
  "controls": ["its code", "its releases", "its pages"],
  "not": ["Stripe, which takes the payments"]
}
```
