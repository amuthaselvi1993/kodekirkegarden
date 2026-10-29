---
name: dead-code-cleanup
description: Find dead code in a git repository, produce a risk-rated assessment, ask the user which items to remove, then commit, push a branch and open a GitHub pull request. Use when the user asks to find, clean up or remove dead, unused or unreachable code, or to prune unused exports, files or dependencies. Do NOT use for general refactoring, linting or dependency upgrades.
---

# Dead Code Cleanup

Human-in-the-loop workflow: **Detect -> Assess -> Approve -> Ship**.
Never delete, commit or push anything before the user has approved the specific items in Phase 3.

If the caller's message starts with `[APP MODE`, read "App mode" at the end of this file first: it changes how Phases 2-4 are run.

## Prerequisites (check first, stop and tell the user if missing)

- Run `git rev-parse --is-inside-work-tree` - must be a git repo.
- Run `git status --porcelain` - working tree must be clean. If not, ask the user to commit or stash.
- Run `git remote -v` and `gh auth status` - `origin` must point to GitHub and `gh` must be authenticated.
- Note the default branch: `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`.
- Never work directly on the default branch.

## Phase 1 - Detect

1. Identify the stack (look for `package.json`, `pyproject.toml`, `go.mod`, `pom.xml`, `*.csproj`, etc.).
2. Run the matching detector if available. If a tool is not installed, ask before installing it; otherwise fall back to manual analysis.

   | Stack | Suggested tools |
   |---|---|
   | JS/TS | `npx knip`, `ts-prune`, `depcheck` |
   | Python | `vulture`, `autoflake --check` |
   | Go | `staticcheck` (U1000), `deadcode` |
   | Java/Kotlin | IDE inspections, `jdeps`, `proguard` usage report |
   | C# | Roslyn analyzers IDE0051/IDE0052/CS8019 |
   | Other | Grep-based reference counting |

3. Cover: unused functions/classes/methods, unused exports, unreachable branches, unused files, unused imports, unused dependencies, commented-out code blocks, stale feature flags.
4. **Verify every candidate** before reporting it. For each, search the whole repo (including tests, scripts, configs, docs, CI files, templates) for:
   - direct references and string-based references (dynamic imports, reflection, DI registration, route/serializer names, decorators, entry points)
   - public API surface (exported from a package or library, or documented)
   - framework conventions (lifecycle hooks, test fixtures, migrations, CLI commands)
5. Drop anything you cannot confidently explain as unused.

## Phase 2 - Assess

Write the assessment to `dead-code-assessment.md` outside the repo tree (for example the system temp folder or the user's outputs folder) so it does not pollute the working tree. Start with an executive summary, then details.

**Executive summary:** number of findings by confidence, estimated lines removable, main risks, recommended order.

**Findings table** (one row per item, with a stable ID):

| ID | Location | Type | Evidence | Confidence | Risk | Est. LOC |
|---|---|---|---|---|---|---|

- **Confidence:** High (no references anywhere, not public API), Medium (only referenced dynamically or by tests), Low (possible reflection/external consumers).
- **Risk:** Low / Medium / High, based on blast radius if the removal is wrong.
- Separate facts (tool output, grep results) from judgement (confidence and risk ratings).
- Mark items that are possibly public API, and flag any that look like generated code or vendored code.

Show the summary and table in chat as well.

### findings.json (machine-readable output)

In the same folder as `dead-code-assessment.md`, also write `findings.json`: a JSON array with one object per removable range, using exactly these keys:

| Key | Type | Meaning |
|---|---|---|
| `id` | string | Stable ID, same as in the table (`DC-01`). If one item spans several ranges or files, give each range its own ID with a letter suffix (`DC-06a`, `DC-06b`). |
| `file` | string | Path relative to the repo root, forward slashes, no leading `./`. |
| `startLine` | integer | First line to remove, 1-based. |
| `endLine` | integer | Last line to remove, 1-based, inclusive, `>= startLine`. |
| `snippet` | string | The exact text of lines `startLine`..`endLine`, copied from the file (lines joined with `\n`). |
| `evidence` | string | One or two sentences of facts: what you searched and what you found (or did not find). No judgement words here. |
| `confidence` | string | `"High"`, `"Medium"` or `"Low"` (same definitions as above). |
| `risk` | string | `"Low"`, `"Medium"` or `"High"`. |

Rules:
- Include only items that are candidates for removal. Do not list the "checked and kept" items.
- Ranges must be the smallest span that can be deleted without breaking syntax (whole function, whole block comment, whole dependency line). For a JSON dependency entry, the range is that one line.
- Ranges must not overlap each other.
- Read the file again when you build the entry so that line numbers and snippet match the file as it is now.
- The file must be valid JSON and contain no secrets or credentials. If a secret is found in the code, do not copy it into `snippet`; describe it in `evidence` and use a short redacted snippet.

## Phase 3 - Human approval (mandatory)

Use the AskUserQuestion tool (or, if unavailable, ask in chat and wait for a reply).

1. Ask which scope to remove, for example: "All High confidence", "High + Medium", "Let me pick individual items", "None - report only".
2. If the user picks individually, present the items in multi-select groups (max 4 options per question, so group by file or module).
3. Confirm the final list back to the user as a short summary: "I will remove N items (IDs ...), touching M files. Proceed?"
4. If the answer is "none" or the user does not confirm, stop. Deliver only the assessment.

Only items on the confirmed list may be changed. Do not "also tidy up" anything else.

## Phase 4 - Ship

1. Create the branch: `git switch -c chore/remove-dead-code-<YYYYMMDD>`
2. Remove only the approved items. Also remove imports/dependencies that become unused as a direct result and record them.
3. Verify: run the project's build, type-check, lint and tests (look in `package.json` scripts, `Makefile`, CI config). If anything fails:
   - Identify whether the removal caused it. If yes, revert that item, tell the user and continue with the rest.
   - If it is a pre-existing failure, note it in the PR body.
4. Commit with a clear message, for example one commit per module or a single commit:
   `chore: remove unused code (<N> items)` with a body listing the item IDs.
5. Before pushing, show `git diff --stat <default-branch>...HEAD` and ask the user for a final go-ahead to push.
6. Push: `git push -u origin <branch>`
7. Open the PR:
   `gh pr create --base <default-branch> --head <branch> --title "chore: remove dead code" --body-file <pr-body.md>`
   PR body contains: executive summary, table of removed items (ID, location, evidence, confidence), items **not** removed and why, verification results (build/test status), and a reviewer checklist.
   Mark as draft (`--draft`) if any Medium/Low confidence item was included or if tests were not run.
8. Return the PR URL to the user.

## Guardrails

- Never force-push, never push to the default branch, never merge the PR.
- Never delete files outside the approved list. Never touch generated, vendored or lock files unless approved.
- Never print or store credentials or tokens. If a secret is found in the code, tell the user and do not repeat it.
- If the repo contains client or regulated data, mention that the user should check client policy and, where personal data is involved, consult the Data Privacy Officer before pushing.
- Remind the user to review the PR before sharing it with others.

## Final response format

Two or three sentences: what was found, what was removed, PR link. Offer to rerun for the skipped items.

## App mode

The web app drives this skill in two separate runs. A run is in app mode when the caller's message starts with `[APP MODE: ANALYZE]` or `[APP MODE: SHIP]`. The caller's message gives `OUTPUT_DIR`, an absolute folder outside the repo. Use forward slashes in every path you pass to a command.

Rules for both runs:
- Do not use AskUserQuestion. The web app replaces the interactive questions.
- Do not install or run detector tools (`npx knip`, `vulture`, ...). Use the manual Read/Grep/Glob analysis from Phase 1.
- Shell commands run through a restricted allowlist: single simple commands only, no pipes, redirects, `;`, `&&`, `$`, backticks or backslashes. Use the Read, Grep and Glob tools for reading and searching instead of shell commands. If a command is denied, change approach; do not try to bypass the restriction.
- Do not print file contents that look like credentials, and never print tokens.

**`[APP MODE: ANALYZE]`**: run the Prerequisites (git-only checks; `gh` problems are reported by the app, so just note them) and Phases 1-2. Write `dead-code-assessment.md` and `findings.json` into `OUTPUT_DIR` with the Write tool. Then stop. Do not start Phase 3 or Phase 4, do not touch the repo, and finish with a two-sentence summary.

**`[APP MODE: SHIP]`**: Phase 3 has already happened in the web app. The caller gives `APPROVED_IDS`; that list is the confirmed list, and the user's click on Approve is also the go-ahead to push (step 5 is satisfied, skip the question). Then:
1. Read `OUTPUT_DIR/findings.json` and select only the entries whose `id` is in `APPROVED_IDS`. Ignore every other entry.
2. Do Phase 4 steps 1-4 and 6-7 for those entries only. Remove each range by re-locating its `snippet` in the file (earlier removals in the same file shift line numbers); apply removals within a file from the bottom up. If a snippet cannot be found exactly, skip that item and report it.
3. Write the commit message to `OUTPUT_DIR/commit-message.txt` and commit with `git commit -F <that file>`. Write the PR body to `OUTPUT_DIR/pr-body.md` and pass it with `--body-file`. Use `git add` with explicit file paths.
4. Push only `chore/remove-dead-code-<YYYYMMDD>` with `git push -u origin <branch>`. Never force-push.
5. After the PR is created, write `OUTPUT_DIR/result.json` with this shape and nothing else: `{"prUrl": "<url>", "branch": "<branch>", "draft": <true|false>, "removedIds": ["..."], "skippedIds": ["..."], "verification": "<one sentence>"}`. If the push or PR creation fails, write `{"error": "<short reason, no secrets>"}` instead.
6. Finish with a two- or three-sentence summary that includes the PR URL.
