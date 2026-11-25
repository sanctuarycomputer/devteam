# Self

Quillmark is an app for long notes. It makes plain text notes that sync between devices.

Its parts are [the app](../app/), [the sync service](../services/sync/) and [its `plugin` interface](../plugin%20api/index.js#top). The rules it keeps are in [the strategy](strategy.md#values), and [the format it follows](https://acme.example/format) is not its own.

It controls its code and its releases. It touches Acme Storage, and does not control it.
