## Hydra Orchestration Toolkit

Hydra is a Lead-driven orchestration toolkit. You (the Lead) make strategic
decisions at decision points; Hydra handles operational management.
`result.json` is the only completion evidence.

Why this design (vs. other coding-agent products):
- **SWF decider pattern, specialized for LLM deciders.** Hydra is the AWS SWF / Cadence / Temporal decider pattern. `hydra watch` is `PollForDecisionTask`; the Lead is the decider; `lead_terminal_id` enforces single-decider semantics.
- **Parallel-first, not bolted on.** `dispatch` + worktree + `merge` are first-class. Lead sequences nodes manually and passes context explicitly via `--context-ref`. Other products treat parallelism as open research; Hydra makes it the default.
- **Typed result contract.** Workers publish a schema-validated `result.json` (`outcome: completed | stuck | error`, optional `stuck_reason: needs_clarification | needs_credentials | needs_context | blocked_technical`). Other products return free-text final messages and require downstream parsing.
- **Lead intervention points.** `hydra reset --feedback` lets the Lead actually intervene at decision points instead of being block-and-join. A stale or wrong run is one `reset` away.

Core rules:
- Root cause first. Fix the implementation problem before changing tests.
- Do not hack tests, fixtures, or mocks to force a green result.
- Do not add silent fallbacks or swallowed errors.
- An assignment run is only complete when `result.json` exists and passes schema validation.

Workflow patterns:
1. Do the task directly when it is simple, local, or clearly faster without workflow overhead.
2. Use Hydra for ambiguous, risky, parallel, or multi-step work:
   ```
   hydra init --intent "<task>" --repo .
   hydra dispatch --workbench W --dispatch <id> --role <role> --intent "<desc>" --repo .
   hydra watch --workbench W --repo .
   # → DecisionPoint returned, decide next step
   hydra complete --workbench W --repo .
   ```
3. Use a direct isolated worker when only a separate worker is needed:
   `hydra spawn --task "<specific task>" --repo . [--worktree .]`

Agent launch rule:
- When dispatching Claude/Codex through TermCanvas CLI, start a fresh agent terminal with `termcanvas terminal create --prompt "..."`
- Do not use `termcanvas terminal input` for task dispatch; it is not a supported automation path

Workflow control:
- After dispatching, always call `hydra watch`. It returns at decision points.
1. Watch until decision point: `hydra watch --workbench <workbenchId> --repo .`
2. Inspect structured state: `hydra status --workbench <workbenchId> --repo .`
3. Reset a dispatch for rework: `hydra reset --workbench W --dispatch N --feedback "..." --repo .`
4. Approve a dispatch's output: `hydra approve --workbench W --dispatch N --repo .`
5. Merge parallel branches: `hydra merge --workbench W --dispatches A,B --repo .`
6. View event log: `hydra ledger --workbench <workbenchId> --repo .`
7. Clean up: `hydra cleanup --workbench <workbenchId> --repo .`

Telemetry polling:
1. Treat `hydra watch` as the main polling loop; do not infer progress from terminal prose alone.
2. Before deciding wait / retry / takeover, query:
   - `termcanvas telemetry get --workbench <workbenchId> --repo .`
   - `termcanvas telemetry get --terminal <terminalId>`
   - `termcanvas telemetry events --terminal <terminalId> --limit 20`
3. Trust `derived_status` and `task_status` as the primary decision signals.

`result.json` must contain (slim, schema_version `hydra/result/v0.1`):
- `schema_version`, `workbench_id`, `assignment_id`, `run_id` (passthrough IDs)
- `outcome` (completed/stuck/error — Hydra routes on this)
- `report_file` (path to a `report.md` written alongside `result.json`)

All human-readable content (summary, outputs, evidence, reflection) lives in
`report.md`. Hydra rejects any extra fields in `result.json`. Write `report.md`
first, then publish `result.json` atomically as the final artifact of the run.

When NOT to use: simple fixes, high-certainty tasks, or work that is faster to do directly in the current agent.

## TermCanvas Pin System

TermCanvas has a first-class pin store. Pins are persistent records of work
the user wants done — captured when the user expresses intent, not when the
work happens. Use the `termcanvas pin` CLI to read and write them. Any agent
terminal can record, read, and update pins.

When to record a pin:
- User says "记一下", "回头处理", "帮我留意", "later", "todo this", or any phrasing that defers the work.
- User describes a problem or idea but isn't asking you to fix it right now.
- User pastes a GitHub issue URL and asks you to track it (record the URL via `--link`).

Do NOT silently nod — capture the pin with `termcanvas pin add` so it survives the session.

When existing pin content is pasted or dropped into the conversation:
- Treat it as context from an existing TermCanvas pin, not as a request to create another pin.
- Use the user's surrounding instruction to decide whether to execute, investigate, or discuss it.
- If the intent is unclear, ask what to do next instead of assuming the pin should be solved immediately.

Recording a pin:
```
termcanvas pin add --title "<short imperative>" --body "<detail>" [--link <url>]
```
- `--title`: short, scannable. Rephrase the user's words into imperative mood. Use the same language the user used (e.g. Chinese input → Chinese title, English input → English title).
- `--body`: preserve enough context for a future agent or the user to resume without re-asking basic questions. Use the same language the user used.
- Keep the body neutral and task-centered. Do not write "the user said/用户说..." as the main framing; describe the request, symptom, evidence, and next step directly. Quote the user's exact words only under Evidence / References when the wording itself matters.
- For bugs, feature requests, research threads, design feedback, or follow-up engineering work, use a compact template. Include only sections that have real content; do not fill sections with guesses:
  `Background`: what prompted this and where it came from.
  `Observed / Request`: the concrete symptom, ask, or idea.
  `Expected / Goal`: what should be true when this is handled.
  `Evidence / References`: user quote, screenshot, link, file path, command output, or code location if available.
  `Next action`: the first useful concrete step when someone picks it up.
  `Unknowns`: missing decisions or facts that still need confirmation.
- If the information is thin, choose deliberately:
  If local context can answer it cheaply, inspect the relevant code, state, logs, or files before recording and include what you found.
  If the missing information changes scope, product behavior, security, or architecture, ask the user one concise question before recording.
  If the user is clearly deferring and cannot answer now, record the pin anyway but mark assumptions and unknowns explicitly.
- If it is only a personal memo or reminder, a short body is acceptable, but still include why it matters or when to revisit it if that is known.
- For multi-line bodies, pass real newlines. In shell commands, use ANSI-C quoting such as
  `--body $'line 1\nline 2'`; do not put literal `\n` sequences inside ordinary quotes.
- `--link <url>`: attach an external reference (GitHub issue, doc, etc.). Use `--link-type github_issue` for issue URLs.
- Repo defaults to cwd. Pass `--repo <path>` only if you need a different one.

Reading and updating pins:
- `termcanvas pin list` — list pins for the current repo (filter `--status done` etc.)
- `termcanvas pin show <id>` — read a single pin before acting on it
- `termcanvas pin render <id> --json` — render a pin's Markdown/HTML body to a PNG and print the output path
- `termcanvas pin update <id> --status done` — mark complete after finishing the work
- `termcanvas pin update <id> --body "..."` — refine the description as you learn more

Visual / HTML pins:
- If a pin contains a full HTML document, SVG diagrams, charts, mockups, visual layouts, or other content where visual understanding matters, run `termcanvas pin render <id> --json` after `pin show`.
- Inspect the returned `image_path` with whatever local image-viewing capability is available in the current agent environment. Use both the rendered screenshot and the pin source when reasoning about the artifact.
- By default, render output is written to `<repo>/.termcanvas/pin-renders/<pin-id>/latest.png` and overwritten on the next render, so it should not accumulate. Do not commit rendered pin images unless the user explicitly asks.
- Pass `--out <png>` only when the user asks for a specific export path.

Rules:
- Pins belong to the user. Don't invent pins the user didn't ask for.
- One pin per intent. Three deferred items = three `pin add` calls.
- After completing work that originated from a pin, call `pin update <id> --status done`.
- The pin store is local to TermCanvas. It does NOT auto-sync to GitHub. If the user wants something on GitHub, they will say so explicitly.
- Status values: `open` (default), `done`, `dropped`. Pick `dropped` (not delete) when a pin is abandoned, so the history is preserved.
