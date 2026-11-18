# Self

Quillmark is a note app for independent researchers. It makes plain-text notes that sync between a researcher's devices.

Its parts are the app people write in, the sync service that keeps notes the same on every device, and the plugin interface that plugins build on.

It controls its code, its releases and its pages. It touches Acme Storage, which holds the synced notes, but does not control it.

```self
{
  "self": 1,
  "what": "A note app for independent researchers that keeps every note as plain text.",
  "makes": "Plain-text notes that sync between a researcher's devices.",
  "parts": [
    { "id": "app", "name": "The app", "what": "The editor people write their notes in.", "code": ["app/"] },
    { "id": "sync", "name": "Sync service", "what": "Keeps notes the same on every device.", "code": ["sync/", "deploy/sync.yml"] },
    { "id": "plugin-api", "name": "Plugin interface", "what": "What plugins build on.", "code": ["app/plugins/"] }
  ],
  "controls": ["its code", "its releases", "its pages"],
  "not": ["the storage that holds the synced notes"]
}
```
