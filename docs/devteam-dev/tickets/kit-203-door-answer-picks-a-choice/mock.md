# Mock: artifact door-answer-pick

Where it is: `docs/devteam/project/artifacts/door-answer-pick/` (index.html, artifact.json) in the kit-203 worktree, **uncommitted**. `artifact new` wrote it under this checkout's own project dir, which in the kit repo is outside the ticket's touches and is project content the kit must not carry. It belongs in home.

Clicked in headless Chrome (test/lib/chrome.mjs), each control and the state it led to:

| Control | Result |
|---|---|
| Answer, nothing picked or typed | "Pick a choice or write an answer." |
| each of the 3 radios, then Answer | posts the label; the recommended one counts as matched |
| Something else, words, Answer | the inline ask: the 3 choices (recommended marked), None of them |
| a radio while the ask shows | the ask goes |
| Something else again, Answer | the ask is back |
| each choice in the ask | posts "<label> — <words>" |
| None of them | posts the words alone, not matched |
| words, nothing picked, Answer | the ask |
| note cleared, then a choice in the ask | nothing posted, the ask goes, the error shows |
| a radio plus a note, Answer | posts "<label> — <note>" as today |
| Start the mock over | back to the first state |

`devteam.mjs artifact check`: 1 artifact pass.
