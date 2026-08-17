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

## AI orchestration (Phase A)

**Project Intelligence** (`src-tauri/src/intel.rs`) scans the repo on open —
deterministically, with no model call, so it costs milliseconds and zero tokens.
Package manager comes from the *lockfile*, not `package.json`, because that is
the only reliable signal. The result is summarised into a ~100-token brief
(`src/lib/intel.ts`) prepended to each task's first message.

It changes agent behaviour measurably: given the brief, Claude said *"This repo
is tiny (8 files, 27 lines total) — reading directly rather than spawning an
Explore agent"* instead of burning a turn on discovery.

**Tasks** (`src/lib/tasks.ts`) replace one long chat. Each owns its session,
conversation, activity, checkpoints, baseline and review decisions, so two pieces
of work never share a review queue.

Tasks run **one at a time**, with a visible queue. Concurrency is not an
oversight: checkpoints diff the whole working tree, so parallel agents would
attribute each other's edits to the wrong task and one task's "reject" could
delete another's work. Real isolation needs worktrees (Phase C).

**Planning** uses `--permission-mode plan`, which is native to Claude Code.
Large requests plan first, small ones do not (`shouldPlan`, biased towards *not*
planning — an unwanted plan is friction on every small request). The plan is
editable, and the edited text is what executes.

Capturing the plan is fiddlier than it looks, and all three of these were found
by running it:

- Claude Code emits a plan **either** as an `ExitPlanMode` tool call **or** as a
  markdown file under `~/.claude/plans/`. Version 2.1.226 does the latter, and
  sometimes attempts the former and has it denied — with the plan still in the
  payload. Both paths are handled.
- A `tool_use` event is only the *request*; a plan file does not exist until its
  **result** arrives. Reading on `tool_use` always read a missing file.
- The gate keys off a `planMode` flag, not a status string, because planning can
  legitimately take several turns.

**Activity** (`src/lib/activity.ts`) maps raw tool traffic to readable events
("Read auth.ts", "Ran tests", "10 passed, 2 failed"), each expandable to the raw
payload. It reads the *output*, not just the exit code — a tool that exits 0
while its output says tests failed is still shown as failed.

**Context sent** shows exactly what we prepend, and is labelled that way on
purpose. We cannot introspect Claude Code's own context assembly, so a panel
claiming to show "what Claude knows" would be a confident lie.

Session startup is **lean by default** (`--strict-mcp-config`): a full personal
config measured ~209k tokens of cache creation per session, which a
task-per-session model multiplies. Toggle it per workspace in the Context panel.

## Architecture

```
src-tauri/            Rust: process, PTY, git, filesystem
  claude.rs           spawn + stream the local CLI (stream-json over stdio)
  git.rs              git plumbing, checkpoints, diffs
  intel.rs            deterministic project scan (no model call)
  pty.rs              integrated terminal
  shellenv.rs         resolve the login-shell PATH (a Finder-launched .app
                      otherwise cannot see ~/.local/bin/claude)
src/lib/review.ts     the change-review engine — pure, no UI, self-checked
src/lib/tasks.ts      task model, planning heuristic, plan capture — pure
src/lib/activity.ts   tool traffic -> readable events — pure
src/lib/intel.ts      project brief generation — pure
src/lib/store.ts      application state, keyed by task
src/components/       UI
```

The four `lib/*.ts` modules above are pure and covered by two self-checks:

```bash
npx esbuild src/lib/review.selfcheck.ts --bundle --platform=node --format=cjs --outfile=/tmp/rc.cjs && node /tmp/rc.cjs
```

```bash
npx esbuild src/lib/phasea.selfcheck.ts --bundle --platform=node --format=cjs --outfile=/tmp/pa.cjs && node /tmp/pa.cjs
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
- One task executes at a time; parallel agents need Phase C worktrees.
- `acceptEdits` permits edits but **not** Bash, so Claude cannot run the test
  suite unattended — it asks instead. Test intelligence in Phase B needs a
  permission story (Claude Code hooks via `--settings` are the supported route).
- Planning depends on model behaviour: Claude sometimes delegates planning to a
  background subagent and returns no plan. The task then falls back to Ready
  rather than blocking.
