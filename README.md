# Claude IDE

A macOS desktop IDE built around the Claude Code CLI you already have installed.

Its reason to exist is the **Changes workspace**: when Claude edits ten files, you
review the result at whatever granularity you want — a single line, a hunk, a
file, a logical group, or everything — instead of accepting one giant diff.

## What it does not do

- No API key handling. There is no field for one and no code path that reads one.
- No authentication of its own. Sign-in, subscription and usage limits stay
  entirely inside Claude Code.
- It shells out to your local `claude` binary through its documented headless
  interface. Nothing is proxied, resold, or redistributed.

## Requirements

- macOS 10.15+
- [Claude Code](https://claude.com/claude-code) installed and signed in
- `git` (the change-review system is built on git plumbing)

## Install

Download the `.dmg` from Releases, drag to Applications.

The build is unsigned unless Apple Developer credentials are configured in CI, so
on first launch macOS will refuse a double-click. **Right-click the app → Open →
Open.** Once only. Alternatively:

```bash
xattr -dr com.apple.quarantine "/Applications/Claude IDE.app"
```

## Develop

```bash
npm install
npm run app
```

| Command | Does |
|---|---|
| `npm run app` | Dev build with hot reload |
| `npm run dist` | Build `.app` + `.dmg` into `src-tauri/target/release/bundle/` |
| `npm run build` | Typecheck and build the frontend only |

Run the review engine's self-check (the one piece where a bug would corrupt a
user's file):

```bash
npx esbuild src/lib/review.selfcheck.ts --bundle --platform=node --format=cjs --outfile=/tmp/rc.cjs && node /tmp/rc.cjs
```

## Releasing

```bash
npm version patch && git push --follow-tags
```

The tag triggers `.github/workflows/release.yml`, which builds a universal
(Apple Silicon + Intel) `.dmg` and attaches it to a **draft** release. Review it,
then publish.

Note: on a **private** repo, release assets are not publicly downloadable.
Colleagues must be collaborators and be signed in, or use
`gh release download`. A public download page would need the assets hosted
somewhere public.

To get a signed, notarised build add these repo secrets: `APPLE_CERTIFICATE`,
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_PASSWORD`, `APPLE_TEAM_ID`.

## How the change review works

The mechanism is worth understanding, because it is what makes partial accepts
safe.

**Checkpoints.** Before every Claude turn the whole working tree is written into
git's object store using a throwaway index:

```
GIT_INDEX_FILE=<tmp> git add -A .
GIT_INDEX_FILE=<tmp> git write-tree     ->  a tree SHA
```

Your `HEAD`, your real index and your stash are never touched. The tree is a
complete restore point that costs nothing and survives restarts.

**Diffing.** A second tree is written after the turn and the two are compared, so
newly created and deleted files are caught, not just tracked ones. Baseline
content for any path comes from `git show <tree>:<path>`.

**Decisions.** Each file's diff is stored as one ordered list covering *every*
line, with display hunks as windows into it. Rebuilding the file is a single walk
over that list, so any subset of decisions still produces a valid file. The rules:

| Decision | Effect on disk |
|---|---|
| Pending | Claude's version stays. Nothing is reverted just because you have not looked at it. |
| Accepted | Claude's version stays. Purely a review record. |
| Rejected | An added line is dropped; a deleted line is restored. |

Rejection is the only destructive action, which is why it is the only one that
rewrites a file — and why "accept this one line" cannot damage its neighbours.

**Grouping** is a path heuristic (`src/lib/review.ts`), so `auth.ts` lands under
Authentication and `auth.test.ts` under Tests. It is a guess, not semantics; the
grouping function is one pure function and is the obvious place to later ask
Claude to group changes instead.

## Architecture

```
src-tauri/            Rust: process, PTY, git, filesystem
  claude.rs           spawn + stream the local CLI (stream-json over stdio)
  git.rs              git plumbing, checkpoints, diffs
  pty.rs              integrated terminal
  shellenv.rs         resolve the login-shell PATH (a Finder-launched .app
                      otherwise cannot see ~/.local/bin/claude)
src/lib/review.ts     the change-review engine — pure, no UI, self-checked
src/lib/store.ts      application state
src/components/       UI
```

The Claude integration is confined to `claude.rs` plus `lib/ipc.ts`. Swapping in
a different agent means replacing those, not the IDE.

### The CLI contract

```
claude -p --input-format stream-json --output-format stream-json \
       --verbose --include-partial-messages --permission-mode acceptEdits
```

stdin takes newline-delimited user messages; stdout emits newline-delimited
events (`system/init`, `assistant`, `user` tool results, `result`).

`acceptEdits` is deliberate: edits land on disk so the Changes workspace can
review them. That is safe *because* every turn is checkpointed first, nothing is
committed automatically, and any change is revertible at line granularity.

## Known limits

- Rejecting a line commits that rejection: the next refresh re-derives the diff
  from disk, so the rejected change is gone from the list. Coarser undo is still
  available from the checkpoint history.
- Grouping is path-based, so an unusual layout falls back to top-level directory.
- No file-system watcher. The change list refreshes when a turn ends or on
  demand.
- One Claude session per window.
