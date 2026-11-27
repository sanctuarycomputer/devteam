# package-docs

The overlay's doc patches for R, the release that switches an instance to run the kit's installed package. Each patch is one insertion into one paragraph; nothing else in either doc changes. `test/split-dist-docs.test.mjs` checks both against the tree.

- `patches/supervisor-sync.patch`: the sync steps in `process/supervisor.md` §9 (Find). A sync is the copy plus the pin; `chore start devteam-sync-<tag>` writes the pin, and `package pin <tag>` writes it again after a copy that replaced `docs/devteam/` or a move to another tag. From R the pin is required.
- `patches/code-style-l-sec-6.patch`: L-SEC-6's one exception in `governance/code-style.md`. The kit's own package, pinned by the sync and verified by merge, is installed at the release's age.

A release's Migration steps are the Migration section of its notes (`process/supervisor.md` §9 reads each release's What, Why and Migration). R's is below, word for word: the supervisor that cuts R puts it in R's notes as the Migration section. It is the adoption message every other instance's supervisor acts on.

## R's Migration

This release moves devteam onto its own installed package, the switch the earlier releases prepared.

1. Sync this release the usual way. The sync copies the release and pins the package; the merge installs the package and checks it before it lands.
2. Then open your project's dashboard and confirm it shows the new app. If it still shows the old page, restart the dashboard. If it says the pages are missing, the sync didn't pin the package: every command still works, and the next release's sync pins and installs it.

To go back, revert the sync's merge. Merging that revert needs the owner's yes, so ask for it ahead of the sync. The revert switches the project back to the release it had before.
