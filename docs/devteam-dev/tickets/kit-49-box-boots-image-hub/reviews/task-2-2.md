# Task 2 review, pass 2: the deploy gate and the image's smoke check

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: fb7ad8d11dc085cabb12bd7db1c0afc33d0e467a (task 2)

## What I checked

This is a cold confirm of task-2's dispositions. I read `git diff cb74297 fb7ad8d -- test/machine.test.mjs` for the box-deploy test only. Neither workflow changed between the two commits: `git diff --stat` names neither `.github/workflows/box-deploy.yml` nor `box-image.yml`.

- **F1: fixed.** The test now runs `spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], …)`, the flags Actions runs a `shell: bash` step with. Under `-e`, a bare `verify` with no `|| { …; exit 1; }` would exit 1 without the refusal text. The `^refusing v0\.0\.1: .*box-pins bump` match still fails that case, so the test keeps catching it.
- **F2: fixed.** The comment says box-pins needs "a remote naming sanctuarycomputer/devteam, as CI's checkout has". The matching-tag assertion's message now ends with "(box-pins needs this checkout's remote to name sanctuarycomputer/devteam)", so a clone without that remote fails with a message that says why.
- **F3: taken.** It is a verification.md item (link box-image's run on this PR) and has no code to check here.
- **F4: left, as out of scope.** That holds: spec.md's Out of scope covers it, and it never blocked.

**What I ran.** At HEAD fb7ad8d, with a clean tree, `node --test --test-concurrency=2 --test-name-pattern="box-deploy" test/machine.test.mjs` printed `ok 26 - box-deploy refuses a release whose stamp isn't its tag, before it reads the hook`, 1 pass, 0 fail (node 18, DEVTEAM_* unset). I also ran one mutation on a copy that I restored straight afterwards. With the verify line moved after the HOOK line, the test failed (pass 0, fail 1). With the file restored, `git status --short` was empty.

## Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|

No findings. Each disposition matches the code at fb7ad8d.

Verdict: APPROVE fb7ad8d11dc085cabb12bd7db1c0afc33d0e467a
