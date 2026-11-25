# Self

Tillstack is a checkout for independent shops. It makes the checkout page and the payments behind it.

Its parts are [the checkout page](../../../src/checkout/) shoppers pay on and [the payments service](../../../src/payments/) that takes their cards through Stripe.

It controls its code, its releases and its pages. It depends on Stripe, which takes the payments, but does not control it.
