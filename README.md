# Claude IDE

A macOS desktop IDE built around the Claude Code CLI you already have installed.

Its reason to exist is the **Changes workspace**: when Claude edits ten files, you
review the result at whatever granularity you want — a single line, a block, a
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

**GitHub Actions cannot build this repo as-is.** macOS runners are not available
to free accounts on *private* repositories, so the tagged workflow fails at
startup with no job ever allocated. Three ways forward:

- Build locally and attach the artifact (below) — no CI needed.
- Add a spending limit / paid plan for macOS minutes, then the workflow works
  unchanged.
- Make the repo public, where macOS runners are free.

Local release, which is how v0.1.0 was cut:

```bash
npm run dist:universal
```

```bash
gh release create v0.1.0 "src-tauri/target/universal-apple-darwin/release/bundle/dmg/Claude IDE_0.1.0_universal.dmg" --title "Claude IDE v0.1.0" --notes "..."
```

`.github/workflows/release.yml` is kept and is correct — it typechecks, runs both
self-checks and `cargo test`, then builds a universal `.dmg` into a **draft**
release. It will start working the moment macOS minutes are available.

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
line, with the on-screen blocks as windows into it. Rebuilding the file is a single walk
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

## AI features

**Project Intelligence** (`src-tauri/src/intel.rs`) scans the repo on open —
deterministically, with no model call, so it costs milliseconds and zero tokens.
Package manager comes from the *lockfile*, not `package.json`, because that is
the only reliable signal. The result becomes a ~100-token brief prepended to the
first message of a session, and it measurably changes behaviour: given the brief,
Claude said *"This repo is tiny (8 files, 27 lines total) — reading directly
rather than spawning an Explore agent"* instead of burning a turn on discovery.

**Plans are documents, not chat bubbles.** Large requests run through
`--permission-mode plan` first. The plan opens as a tab beside your files as
rendered markdown, you select any part of it to attach a comment, and approval is
the document's own action. Comments are folded into the message Claude executes
and explicitly override the plan where they conflict — verified end to end: a
comment asking to rename a constant produced `LOCKOUT_WINDOW_MS` in the diff.

Capturing a plan is fiddlier than it looks, and all three of these were found by
running it:

- Claude Code emits a plan **either** as an `ExitPlanMode` tool call **or** as a
  markdown file under `~/.claude/plans/`. Version 2.1.226 does the latter, and
  sometimes attempts the former and has it denied — with the plan still in the
  payload. Both paths are handled.
- A `tool_use` event is only the *request*; a plan file does not exist until its
  **result** arrives. Reading on `tool_use` always read a missing file.
- The plan's filename is derived from the opening line of the prompt, so the
  request goes first and the project brief second.

**Tool permissions.** Claude Code 2.1.226 exposes no `--permission-prompt-tool`,
but a `PreToolUse` hook can return a `permissionDecision` and that decision is
honoured. So the IDE runs a loopback HTTP server, generates a hook script that
POSTs each tool request to it and blocks, and answers with your decision
(`src-tauri/src/approval.rs`). Declining genuinely prevents the call rather than
undoing it afterwards. Unanswered requests fail closed after ten minutes, the
port is ephemeral and 127.0.0.1-only, and the hook lives in a session-scoped
settings file rather than your own configuration.

Editing files is allowed by default — reviewing edits afterwards, line by line,
is the point of this IDE. Running shell commands and network access ask by
default, and obviously destructive shell (`rm -rf`, `git push`, `sudo`,
`curl | sh`) always asks regardless of policy.

**`AskUserQuestion` is not supported**, and this is a CLI limitation rather than
a gap here: the tool is absent from the 31-tool set in headless mode, along with
`ExitPlanMode`. Claude asks in plain text instead, which appears in the
conversation.

**Model and usage.** Pick a model per session (aliases, so they keep resolving to
the current release); switching respawns the CLI with `--resume` to keep the
thread. Token and cost totals come from `result` events and are labelled as
*this session only* — the CLI exposes no account balance and we do not invent
one.

**Smart Git** actions ask Claude about the diff: explain changes, generate a
commit message (which lands directly in the commit box), group into commits, find
unrelated modifications, review for defects, draft a PR description. Every prompt
is read-only by construction; nothing stages, commits or pushes.

**Media** files open in a viewer rather than as mojibake: images, SVG (with a
source toggle), video, audio and PDF, on a checkerboard so transparency is
visible. The extension list is only a fast path — anything that cannot be read
as text falls back to the viewer, so a format the list has never heard of still
opens instead of erroring. Attach any of them to chat by paperclip, drag-and-drop, paste, or a
tab's context menu — images are sent as vision blocks and Claude genuinely reads
them (verified: it read text out of a PNG attached in the app).

**Effort** (`--effort low|medium|high|xhigh|max`) sits beside the model picker;
changing either respawns the CLI with `--resume` so the thread survives.

**`@` and `/` in chat.** `@` completes repo files (ranked so `authsvc` finds
`authService.ts`) and expands to a backticked path Claude can act on. `/`
completes your installed skills and invokes them — verified working in headless
mode. Only `user-invocable` skills are offered.

**⌘L** sends the selected lines to chat with their file and line range attached,
so "why is this wrong?" needs no further explanation. With no selection it takes
the caret's line. Claude's replies render as markdown rather than raw asterisks.

**Prettier** formats the open file with ⌥⇧F, honouring the repo's own
`.prettierrc` or `package.json` block rather than imposing this app's defaults.

**API workbench** — build and send requests inside the IDE, with headers, bodies,
`{{variables}}`, timing, size and pretty-printed JSON. Import a Postman v2
collection (folders, auth, bodies and all) or an environment export. Imported
pre-request and test scripts are **preserved but never executed** — running
arbitrary JavaScript out of a downloaded file is not something an IDE should do
quietly — and any request carrying one says so.

**Search** is literal / regex / filename over `git ls-files`, plus a **symbol
index** that returns declarations rather than every line containing a word, and
an "Ask Claude instead" button for natural-language questions. There is no
embedding index and the UI does not pretend otherwise.

**Impact analysis** answers "what breaks if I change this?" from that index
rather than by asking the model to re-read the repo: definitions, importers,
possible callers, and which tests touch the file. It is lexical, not type-aware —
two unrelated classes with a `run` method look like one symbol — so callers are
labelled *possible* and the count is a ceiling, not a certainty.

**A filesystem watcher** keeps the review current when the tree changes from
outside the app — a terminal command, another editor, a `git checkout`.

**Terminal** runs your real login shell (`zsh -l -i`) via a generated `ZDOTDIR`
that sources your own `~/.zshrc` untouched, then layers on completion. The
previous version spawned a bare non-login shell, which is why completion looked
missing. Inline suggestions need `zsh-autosuggestions`; if it is absent the
terminal says so once instead of silently lacking the feature.

## Architecture

```
src-tauri/            Rust: process, PTY, git, filesystem
  claude.rs           spawn + stream the local CLI (stream-json over stdio)
  git.rs              git plumbing, checkpoints, diffs
  intel.rs            deterministic project scan (no model call)
  pty.rs              integrated terminal
  shellenv.rs         resolve the login-shell PATH (a Finder-launched .app
                      otherwise cannot see ~/.local/bin/claude)
src-tauri/src/approval.rs  loopback server + PreToolUse hook for permissions
src-tauri/src/search.rs    literal / regex / symbol / filename search
src/lib/review.ts     the change-review engine — pure, no UI, self-checked
src/lib/session.ts    plans, permissions, usage, planning heuristic — pure
src/lib/activity.ts   tool traffic -> readable events — pure
src/lib/intel.ts      project brief generation — pure
src/lib/store.ts      application state
src/components/       UI
```

The pure `lib/*.ts` modules are covered by two self-checks, and checkpoints by
`cargo test`:

```bash
npx esbuild src/lib/review.selfcheck.ts --bundle --platform=node --format=cjs --outfile=/tmp/rc.cjs && node /tmp/rc.cjs
```

```bash
npx esbuild src/lib/session.selfcheck.ts --bundle --platform=node --format=cjs --outfile=/tmp/sc.cjs && node /tmp/sc.cjs
```

```bash
cd src-tauri && cargo test
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
- One conversation per window.
- Planning depends on model behaviour: Claude sometimes delegates planning to a
  background subagent and returns no plan, in which case no approval gate opens.
- Semantic search is Claude reading the code, not an index.
- Impact analysis, error intelligence and test intelligence are not built.
