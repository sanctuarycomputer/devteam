# kit-238 CI

This is the CI row that `verification.md` left pending. It's a new file, so the records approved
before it stay untouched. Each result comes from `gh run view <id> --json conclusion,jobs` and was
recorded through `devteam.mjs gate ci -- gh run watch <id> --exit-status`.

| Head | Run | Conclusion |
|---|---|---|
| `0d499212c23aab4167379d7f3d4800985b54892c` (code and test as reviewed) | test 43744611781 | success, 8/8 kit jobs (Node 18, 20, 22, 24; chain and rest); gate ci passed |
| `d49e1463875b4f180b0ec02e72ea4700c281ae20` (final-1 reviewed here; records only since 0d49921) | test 43744899079 | success, 8/8 kit jobs; gate ci passed |

The head after this file holds only records (the final-1 disposition and this file). Its own run
is confirmed before the merge request.
