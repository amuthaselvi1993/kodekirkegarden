---
name: dead-code-cleanup
description: Find dead code in a git repository, produce a risk-rated assessment, ask the user which items to remove, then commit, push a branch and open a GitHub pull request. Use when the user asks to find, clean up or remove dead, unused or unreachable code, or to prune unused exports, files or dependencies. Do NOT use for general refactoring, linting or dependency upgrades.
---

# Dead Code Cleanup

Human-in-the-loop workflow: **Detect -> Assess -> Approve -> Ship**.
Never delete, commit or push anything before the user has approved the specific items in Phase 3.

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
