# Local commit metadata verification

This artifact repository uses local checks. GitHub Actions, including self-hosted
runners, is not part of the supported verification or release process. The
workflow file is retained as an inactive reference. GitHub continues to host the
repository and release assets.

From the root of each new clone, install the hooks once:

```sh
git config core.hooksPath .githooks
node .github/scripts/test-commit-metadata.mjs
node .github/scripts/check-commit-metadata.mjs --current
```

Node.js 20 or later and Git must be available on PATH. Git for Windows supplies
the shell used by these hooks. On macOS/Linux, also run
`chmod +x .githooks/pre-commit .githooks/pre-push` if checkout permissions do not
already mark them executable. The hook setting is local to the clone; it does
not travel with Git history. Check it with `git config --get core.hooksPath`.

The pre-commit hook checks the author and committer that Git is about to write,
including environment overrides. The pre-push hook checks every newly exposed
commit and annotated tagger across all ref updates. It includes non-tip commits,
merged side branches and forced updates. New branches consult the actual remote
advertisement, so stale tracking refs cannot conceal history. These reads do not
fetch objects or change refs. Missing tools, required history or verifier files
cause a refusal with redacted diagnostics.

For manual checks, revision names and full object IDs are accepted:

```sh
node .github/scripts/check-commit-metadata.mjs --all-reachable HEAD
node .github/scripts/check-commit-metadata.mjs --range BASE HEAD
```

Replace `BASE` with the actual already-published boundary. A range excludes that
boundary's ancestors; use `--all-reachable` to inspect the entire incoming history,
including a freshly rewritten history whose old boundary is no longer present.
For an ordinary push the advertised old boundary must be readable locally. An
unavailable boundary refuses the push; make the needed history available and
inspect it, rather than bypassing the hook.

Use your own GitHub noreply address for both author and committer, retaining
individual attribution. The existing KNULL delivery identity and GitHub web-flow
identity remain supported. Changing Git config does not repair old commits.
Metadata diagnostics identify object IDs and affected fields without printing
rejected identities or Git stderr.

These hooks validate commit metadata only. They do not inspect arbitrary commit
content, artifacts, display names or credentials, and they cannot run for web
edits, API-created commits/tags or another clone whose hooks were not installed.
Privately build and verify release assets with the source repository's local
platform scripts before uploading them. Do not claim hook enforcement for direct
GitHub web/API publication; review those identities separately. No Actions status
check or billing change is required.

The synthetic test command creates temporary local Git repositories, including
local-only push destinations. It never contacts GitHub or publishes a release.
