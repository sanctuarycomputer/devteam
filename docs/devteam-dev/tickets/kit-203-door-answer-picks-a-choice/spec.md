# kit-203: a typed answer to a question with choices asks which choice it means

## Why

The owner answered a one-way door (q-20261114-205610542-supervisor) in their own words, agreeing in substance. The kit records an answer as matching its recommendation only when the answer's label is the recommendation (`matched` in `questionView`, read by `doorAgreed`), so plan approval refused it and the supervisor had to ask again (q-20261114-213414045-supervisor; observation o-20261114-213419633-supervisor). The fix stays on the owner's side of the record: the owner says which choice their words mean, on the card, before anything is posted. The supervisor never gains a way to say a typed answer matched.

## How it works today

`docs/devteam/dashboard/index.html`:

- `questionCard` draws the choices as radios (`input[data-pick]`), a **Something else** radio (`__other`) for most kinds, a note textarea (`textarea[data-q]`) and an **Answer** button (`button[data-answer]`).
- The click handler for `[data-answer]` builds `answer = picked ? (note ? "<picked> — <note>" : picked) : note`, where `picked` is empty when nothing or Something else is picked, and posts `{ action: 'answer', body: { id, answer, autonomy, rule, seen } }` through `answerPress`.
- So words with no pick post as the words alone, and `matched` is false.

## What changes

When the owner presses **Answer** (or **Send**) on a card where:

- `choicesOf(q)` is not empty (the question's choices, or, with none listed, its recommendation drawn as the one choice), and
- the question has a recommendation (`q.recommendation`), and
- it is any kind except a goal approval, a review or a secrets card (those have their own buttons and checks), so owner-action, proposal and goal-definition cards are included, and
- no choice is picked (nothing, or Something else where the card has it), and
- the card's note has words,

nothing is posted. That card, the copy whose button was pressed, shows an inline ask just above its button row:

```
Which choice do your words mean?
[ Yes, observe everything   Recommended ]
[ No, keep sales out ]
[ None of them: post my words as they are ]
```

- The ask lists the card's choices in `choicesOf` order, the recommended one marked as it is on the card, then **None of them**.
- Picking a choice posts `"<label> — <words>"`, the same shape a pick plus a note posts today, so `matched` follows from the label as before. **None of them** posts the words alone, exactly as today.
- The words are the ones in that card's own note at the moment a button in the ask is pressed: the note sits beside the ask and is what the owner sees. If the note is empty by then, nothing is posted, the ask goes away and the card says "Pick a choice or write an answer." as today.
- Everything else on that card (standing-rule box, next-time rung, seen hash) goes with the post as it does with Answer.
- The ask belongs to one copy of the card. It is kept in page memory per question with the copy it was raised on (Inbox or thread), so an Inbox redraw keeps it on the Inbox card; the thread's copy, which is never redrawn by the Inbox, keeps it in its own DOM. The other copy never shows it.
- Picking a radio on either copy takes the ask away (the owner is choosing the ordinary way, and a pick is shared by both copies); pressing Answer again with words and still no pick shows it again.
- Posting from the ask clears it. A refused post brings the card back without the ask, with the words and the pick put back as today (the pick is the one the card had before the ask, since the ask never sets `picks`).

## Acceptance checks (the done-whens)

1. On a question with choices and a recommendation (doors included), words with no pick (Something else, or a note with nothing picked) show the inline ask before anything is posted. Picking a choice posts `"<label> — <words>"`; None posts the words alone.
2. The kit is unchanged: `devteam.mjs` is not touched; `matched` and `doorAgreed` stay as they are. Only the owner's own pick on the card makes a typed answer match.
3. A test in `test/dashboard.test.mjs` drives the card in Chrome, on one-way doors:
   - Something else plus words shows the ask and nothing is in the log; the ask survives a data redraw; picking a radio takes it away;
   - pressing Answer again shows it; picking the recommended choice in it posts `"<label> — <words>"`, and the log's answer is matched;
   - on a second door, a note with nothing picked shows the ask, and None posts the words unchanged, not matched.
4. test.yml passes on every job; only `docs/devteam/dashboard/index.html` and `test/dashboard.test.mjs` change in code (this ticket's own records aside).

## Edge cases

- A question with choices but no recommendation: unchanged (words post as today). `doorAgreed` passes such a door anyway.
- A question with no choices and no recommendation (free text): unchanged. With a recommendation and no choices listed, `choicesOf` draws the recommendation as the one choice, so the ask shows that one choice and None: a typed answer there loses its match the same way.
- A pick plus a note, or a pick and no note: unchanged.
- Something else picked and no words: the existing error.
- Owner-action with its drawn Done / Can't right now and no recommendation: unchanged. With a recommendation, a note and no pick: the ask shows (it has no Something else).
- Goal approval, review and secrets cards: unchanged.

## Known limits (what this doesn't defend)

- An owner who picks a choice their words contradict (ticket notes).
- `matched` reads the answer's part before the first " — ". A choice label that itself holds " — " is never matched, from the ask or from a pick plus a note today. That is in `devteam.mjs`, outside this ticket.
- The ask marks the recommended choice, as the card does. That nudges toward agreement, and agreement feeds the trust counts. It is kept so the ask reads like the card above it; it adds no nudge the card doesn't already make.

## Out of scope

- Any kit-side matching of free text to a choice, by the kit or the supervisor.
- The thread chat and `answer` from the CLI.

## A mock

The owner's preference is that UI changes are iterated on an artifact first unless the tweak is trivial. This is one short prompt with buttons on an existing card, using the card's existing `.choice` styling; I treat it as trivial and show it above in text. If the supervisor wants an artifact first, that is a ruling and I will draw one.

## Rulings

None yet.
