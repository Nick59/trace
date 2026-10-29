# Trace PR Reviewer

Trace is a local SvelteKit app that loads a GitHub pull request and splits it into features (an actor and a goal) and, per feature, technical workflows (one path per outcome, one file per step), each traced through the code step by step. A signed-in Claude Code or Codex CLI does the analysis through a skill and an MCP server, and you review the result in the app.

## Requirements

- Node 24 (needed for `node:sqlite` and `process.loadEnvFile`).
- `git`, and the GitHub CLI `gh` if you want the skill to find the pull request of your current branch.
- Claude Code or Codex, signed in.

## Install and run

```sh
npm install
cp .env.example .env
npm run dev
```

Open the local address printed by Vite. The home page shows a setup card that tracks the steps below.

## Claude Code

Register the MCP server (use `node` directly, not `npm run`, because npm's banner corrupts the stdio protocol), then install the skill. Replace `<repo>` with the absolute path of this checkout.

```sh
claude mcp add --scope user trace -- node <repo>/scripts/mcp-launch.mjs
mkdir -p ~/.claude/skills && ln -sfn <repo>/skills/trace ~/.claude/skills/trace
```

Then, in Claude Code:

```
/trace                                   # the pull request of the current branch
/trace https://github.com/OWNER/REPO/pull/NUMBER
/trace w3 "include the DB write in UserRepository"   # recompute one workflow
```

## Codex

```sh
codex mcp add trace -- node <repo>/scripts/mcp-launch.mjs
mkdir -p ~/.codex/skills && ln -sfn <repo>/skills/codex/trace ~/.codex/skills/trace
```

Then mention the skill in a Codex prompt:

```
codex '$trace'
codex '$trace https://github.com/OWNER/REPO/pull/NUMBER'
codex '$trace w3 include the DB write in UserRepository'
```

Both skills analyze the pull request head in a separate git worktree, so your checkout is never touched, and neither edits files, commits, pushes or posts to GitHub. See [CLI agent setup and instructions](docs/cli-agent.md) for details.

## Settings

All settings go in `.env` and are optional (see `.env.example`).

- `GITHUB_TOKEN`: access to private repositories and higher GitHub rate limits. It is only used by the server and never sent to the browser.
- `TRACE_APP_URL`: the address of this app (for example `http://localhost:5173`); the skills then finish with a link to the pull request.
- `WALKTHROUGH_API_KEY`, `WALKTHROUGH_API_URL`, `WALKTHROUGH_MODEL`: set all three to add a **Generate workflows** button that uses an OpenAI-compatible model API (the URL is the full `/v1/chat/completions` endpoint) instead of a CLI agent. The server sends the PR title and description, up to 35 patches and bounded source snippets to that provider; provider failures or invalid output return an error, with no fallback.
- `TRACE_DATA_DIR`: the directory of the SQLite database `trace.db` (default `.trace/`).

## Limits and trust scope

The app reads at most 300 changed files per pull request. In the model API mode it fetches source at the head SHA for at most 35 candidate text files, with a 48 KB per-file and a 420 KB aggregate limit. Source context may include secrets committed in the PR, so configure an external model only if that data transfer is acceptable.

Trace has no authentication or authorization boundary. Run it only on a trusted machine and do not expose it as a public service.

## Checks

```sh
npm run check
npm test
```
