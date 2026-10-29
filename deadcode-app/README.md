# Dead code cleanup (web app)

Local web app around the `dead-code-cleanup` skill (`../.claude/skills/dead-code-cleanup/SKILL.md`).

1. Submit the absolute path of a git repository (working tree must be clean).
2. The backend runs the skill's Phases 1-2 through the Claude Agent SDK and streams progress to the browser (SSE). Phase 2 writes `dead-code-assessment.md` and `findings.json` to a temp folder outside the repo.
3. The browser shows each finding in a Monaco diff (left: current file with the lines highlighted, right: after removal), with confidence/risk filters and per-item checkboxes.
4. **Approve** sends only the selected IDs. The backend resumes the same agent session and runs Phase 4 for those IDs: branch, edit, verify, commit, push, `gh pr create`. The PR URL is shown at the end.

## Run

Needs Node >= 20.12, git, an authenticated GitHub CLI (`gh auth login`) and Claude credentials for the Agent SDK (`ANTHROPIC_API_KEY` in your environment, or an existing Claude Code login).

    cd deadcode-app
    npm install
    npm run dev        # API on http://127.0.0.1:4310, UI on http://127.0.0.1:5173
    # or
    npm run build && npm start   # everything on http://127.0.0.1:4310

Optional environment variables: `PORT` (default 4310), `DEADCODE_MODEL`, `SKILL_PATH`.

## Security notes

- The server binds to `127.0.0.1` only (hard-coded). Requests are rejected unless `Host` is a loopback name and `Origin` (required on POST/DELETE) is this app. Bodies must be `application/json`.
- The agent runs with nothing pre-approved. Every tool call is checked in `server/policy.ts`: analysis may only read the repo and write into its output folder; shipping may additionally edit the repo and run a short allowlist of git/gh/verification commands (no force-push, only `chore/*` branches, no merge). Shell metacharacters are rejected.
- Tokens are never logged or sent to the browser: all SSE events and log lines pass through `server/redact.ts`, command output and file contents are not streamed, and credentials are only read by `git`/`gh`/the SDK from their own stores.
- Monaco is bundled locally; the page makes no external requests.
- Review the PR before sharing it with others. Check client policy before pushing code from client repositories.
