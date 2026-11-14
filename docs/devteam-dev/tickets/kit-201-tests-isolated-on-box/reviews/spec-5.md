# Spec and plan review (scope change), pass 3

- Reviewer: rulings-confirmer (fresh subagent, claude-opus)
- Reviewed: e9cae1315d0ae80ed7f6ee7833ccb16a9c57cef9

Read: spec-4.md, the diff 3a4cf60..e9cae13 (spec §2, §6, §7, Rulings; plan Task 3), and in devteam.mjs at e9cae13 the re-exec block (34-47), `git()` (133-144), homeAt (405-447), `runDir` (463) and `cwdRepo` (2372). I also checked every `cpSync(kit…)` in test/ and cloud/Dockerfile. I ran no kit commands or tests.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S5-1 | Important | m-20261114-224904663-supervisor ("a kit copy nested in a home without its own .git must not resolve that home"); spec §7 | plan Task 3 Step 3b "beside homeAt (before it reads home)"; devteam.mjs 34-47 | The re-exec block runs before homeAt. For a nested copy (no `.git` of its own) it takes home's common dir, so `kitMain` is home's `docs/devteam`, which has `project/`. If the copy's bytes differ from home's main kit, it re-execs into home's main kit. That kit passes Step 3b's check (it is its checkout's own) and runs against home's project and live log. This is the incident class: a branch's changed kit copied into a fixture without `git init`. Step 3b's test can't see the hole, because `home` and the copy both come from `kit`, so they are identical and no re-exec happens. Fix: apply the same "script is its checkout's own kit" test in the re-exec block, so a nested copy is never re-exec'd and dies, or skips the re-exec and then dies at Step 3b. Use `execFileSync` there, not `git()`: `git()` reads `let gitReadCache` (126), which is in its TDZ at line 40. Add a test case where the copy differs from home's kit (append a comment to the copied devteam.mjs). | fixed: the check moved into the re-exec block; tested with a copy that differs |
| S5-2 | Important | quality §3 (a disposition that doesn't fix its finding); S4-3 | plan Task 3 Step 1 "includes `app-api` and `app`" | S4-3 is dispositioned `fixed` ("the test asserts the home as '(<app>)'"), but the committed plan still says "includes `app-api` and `app`" and the regex `\(.*\)`. The spec has no exact-path assertion either. If the fix is only in uncommitted test code, the record doesn't carry it. Write the exact assertion into the plan: `DEVTEAM_RUN=${apiRun}` and `(${app})`, or their real paths. | fixed: exact message prefix with both paths, in spec, plan and test |
| S5-3 | Important | m-20261114-224640331-supervisor ("a worker on a repo link"); S4-2 | plan Task 3 Step 1 "a plain repo `<base>/linked` with a worktree"; spec §6 Must not break | S4-2 asked for a repo link of home, named in its settings, and the spec now says "a worker on a repo link". The plan's `linked` is a plain repo that home's settings don't name. So `cwdRepo()` (2372) returns null and `gate`, `phase` and `check-ticket` take the non-link paths (no `repo` field, no link gates, no `linkLocation`/`links.local.json`), not the ones kit-46's worker takes. The plan also asserts only the sent line in home's run, while the spec asks for the phase, send, gate and merge-request lines. Fix: register `linked` as a `kind: repo` link in home's settings (remote = `linked`'s path or origin, location so `repoReadable` holds), run from its worktree, and assert each line in home's run log (the gate line with `repo: <link>`). | fixed: linked is a real repo link in home's settings; phase, gate and both sends checked in home's log |
| S5-4 | Minor | consistency | spec §6 "Not defended (P6): … or a kit copied into home's own tree" | §7 now defends a kit copied into home's tree without a repo of its own, so this clause contradicts it. Narrow it to "with `DEVTEAM_OWN_KIT`", or drop it. | fixed: the nested copy is no longer listed as undefended |
| S5-5 | Minor | spec §7 clarity | spec §7 "When the running kit's script is not `<its checkout's top level>/…`" | Plan Step 3b skips the check when there is no top level ("when it is set"). That is what keeps a kit in no repo working (the box image's `/opt/devteam/kit`, cloud/Dockerfile 122; a machine without git). The spec doesn't say so. Add "a kit in no git checkout is unaffected", and a test for it if it's cheap (a copy under os.tmpdir with no `git init`, `help` or `machine`). | fixed: a kit in no git checkout skips, said in §7 |

Notes:

- S4-1: fixed. Both spec and plan seed with `observe`.
- S4-2: partly fixed. Acceptance 6 has the must-not-break and the plan has its own test, but the fixture isn't a repo link (S5-3).
- S4-3: not fixed in the committed docs (S5-2).
- S4-4: fixed. The spec names the fresh `app-ln` fixture.
- Ruling m-20261114-224640331: in Rulings and acceptance 6, with a plan step. Fidelity is S5-3.
- Ruling m-20261114-224904663, decoy: spec §2 reproduces it exactly (cwd the kit's checkout, `DEVTEAM_HOME` unset, worker, `DEVTEAM_RUN=<decoy>`, the name pattern, an empty decoy). Plan Step 4 matches and has workable timeouts.
- Ruling m-20261114-224904663, nested kit: in acceptance 7 and Step 3b, and the `bareProject` assertion is there. The re-exec hole is S5-1.
- Is Step 3b safe? `git()` is a hoisted function, and `gitReadCache`/`HOME_CWD` are initialized before homeAt, so the call works there and returns null on any git failure, which skips the check. I checked the setups the brief named:
  - A home main checkout, and a home worktree's own copy before the re-exec: the top level is that checkout, so the check passes.
  - After the re-exec: home's main kit, so it passes.
  - The kit's own repo (this worktree, `kit` = `<repo>/docs/devteam`): passes.
  - review-worktrees under `.worktrees/` (each has its own `.git` file): pass.
  - A kit in no repo (the box's `/opt/devteam/kit`; `/opt` and the box's tmp aren't in a repo): skipped.
  - Every test fixture that copies the kit (kit.mjs, chain.mjs, machine, gateway, components, dashboard, dev-links, multirepo-home): `git init` or `clone` is run first, and the copy goes to `<repo>/docs/devteam`, so they all pass.
  - The kit sets up no git hooks and no symlinked kits, so neither a `GIT_DIR`/`GIT_WORK_TREE` from a hook nor a symlinked `docs/devteam` arises.
  - A kit vendored as a git submodule, or at a non-top path in a monorepo, would now die, but homeAt already resolves those wrongly. That isn't a new break.

Verdict: CHANGES e9cae1315d0ae80ed7f6ee7833ccb16a9c57cef9
