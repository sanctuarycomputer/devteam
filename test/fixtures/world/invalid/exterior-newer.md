# Exterior

What Quillmark relates to, by how each relates to it.

It serves independent researchers, who write long notes and want them to last. It depends on Acme Storage, where sync keeps the notes. Inkwell Plugins builds on it. Ledgerpad is its alternative: it does the same job and locks notes in. It collaborates with the Open Notes Format group on the format both follow. Data protection regulators govern how it keeps its users' notes. Its workshops affect local libraries, which host them. And the Small Press Fair sponsors its yearly meetup.

```exterior
{
  "exterior": 2,
  "strategy_blob": "d4b0bd760cf918d668218611232bd51efe8fbe2d",
  "self_blob": "c69d5ece56a6aa7dd72e1257f0eac0892e0c73c0",
  "entities": [
    {
      "id": "researchers",
      "name": "Independent researchers",
      "relation": "serves",
      "kind": "group",
      "matters": "They are who it is for: if they stop writing in it, nothing else counts.",
      "weight": 4,
      "strategy": [
        "Independent researchers who write long notes and want them to last."
      ],
      "signals": [
        {
          "id": "daily-writers",
          "what": "Daily visits from the people it serves.",
          "value": 4
        },
        {
          "id": "notes-kept",
          "what": "How many notes people still keep after a year.",
          "value": 3
        }
      ]
    },
    {
      "id": "acme-storage",
      "name": "Acme Storage",
      "relation": "depends_on",
      "kind": "organisation",
      "matters": "Sync runs on it, so its prices and its outages are ours.",
      "weight": 3,
      "strategy": [
        "Sync runs on Acme Storage, so it must stay fast and cheap."
      ],
      "signals": [
        {
          "id": "storage-prices",
          "what": "Their storage prices, which set what sync costs.",
          "value": 3
        },
        {
          "id": "storage-incidents",
          "what": "Incidents on their status page.",
          "value": 2
        }
      ]
    },
    {
      "id": "inkwell",
      "name": "Inkwell Plugins",
      "relation": "builds_on_it",
      "kind": "work",
      "matters": "The plugins people ask for most; a change to the plugin interface breaks them first.",
      "weight": 2,
      "strategy": [
        "Plugins such as Inkwell Plugins grow what it can do."
      ],
      "signals": [
        {
          "id": "plugin-releases",
          "what": "New plugin releases and what they need from the interface.",
          "value": 2
        }
      ]
    },
    {
      "id": "ledgerpad",
      "name": "Ledgerpad",
      "relation": "alternative",
      "kind": "work",
      "matters": "The tool researchers leave for, or come from.",
      "weight": 3,
      "strategy": [
        "Notes stay plain text, where an alternative like Ledgerpad locks them in."
      ],
      "signals": [
        {
          "id": "rival-features",
          "what": "Features it ships that people ask Quillmark for.",
          "value": 3
        }
      ]
    },
    {
      "id": "notes-format",
      "name": "Open Notes Format group",
      "relation": "collaborates",
      "kind": "group",
      "matters": "The format is shaped together; a draft that changes it changes the app.",
      "weight": 2,
      "strategy": [
        "It follows the Open Notes Format, shaped with its working group."
      ],
      "signals": [
        {
          "id": "format-drafts",
          "what": "New drafts of the format.",
          "value": 2
        }
      ]
    },
    {
      "id": "regulators",
      "name": "Data protection regulators",
      "relation": "governs",
      "kind": "group",
      "matters": "Their rules decide how synced notes may be kept.",
      "weight": 2,
      "strategy": [
        "It keeps to the data protection rules where its users live."
      ],
      "signals": [
        {
          "id": "rule-changes",
          "what": "Changes to the rules for personal data where its users live.",
          "value": 3
        }
      ]
    },
    {
      "id": "libraries",
      "name": "Local libraries",
      "relation": "affects",
      "kind": "group",
      "matters": "They host the workshops that bring new writers.",
      "weight": 1,
      "strategy": [
        "Workshops at local libraries bring new writers."
      ],
      "signals": []
    },
    {
      "id": "press-fair",
      "name": "Small Press Fair",
      "relation": "other",
      "relation_word": "sponsors",
      "kind": "organisation",
      "matters": "It sponsors the yearly meetup, where most new plugin writers first come.",
      "weight": 1,
      "strategy": [
        "The Small Press Fair sponsors its yearly meetup."
      ],
      "signals": [
        {
          "id": "meetup-date",
          "what": "The date of the next meetup.",
          "value": 1
        }
      ]
    }
  ]
}
```
