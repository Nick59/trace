# Trace PR Reviewer

A local SvelteKit app that loads a GitHub pull request and splits it into features and, per feature, technical workflows (one path per outcome, one file per step), each traced through the code step by step.

## Setup

```sh
npm install
cp .env.example .env
npm run dev
```

Open the local address printed by Vite. `.env` is optional for public pull requests. Set `GITHUB_TOKEN` to access private repositories and avoid the lowest unauthenticated GitHub API rate limit. The token is only used by the server and is never returned to the browser.

The GitHub inbox requires `GITHUB_TOKEN`. It loads at most the 20 most recently pushed repositories and 30 recently updated open pull requests per repository; a truncation notice appears when GitHub reports another page. Filter the inbox to one repository with `?repo=owner/name`.

## Workflow generation

Workflows are created by a CLI agent through the MCP server (see below) or, when you set all three `WALKTHROUGH_API_KEY`, `WALKTHROUGH_API_URL`, and `WALKTHROUGH_MODEL`, by the model API through a **Generate workflows** action on the PR page. The URL must be the full OpenAI-compatible chat completions endpoint, such as `https://api.openai.com/v1/chat/completions`. The server sends the pull request title and description, up to 35 patches (at most 8,000 characters each), and bounded source snippets (at most 10,000 characters each) to that provider. Provider failures or invalid output return an error; there is no fallback. The API key is never sent to the browser.

Analyses are stored in a SQLite database at `.trace/trace.db` (needs Node 24 for `node:sqlite`). Set `TRACE_DATA_DIR` to change the directory.

## Limits and trust scope

The API paginates GitHub's changed-file endpoint and reads at most 300 entries. It fetches source at the pull request head SHA for at most 35 candidate text files, with a 48 KB per-file limit and a 420 KB aggregate limit. Binary files and files GitHub cannot serve as text are represented by their diff when available. Source context is fetched from the repository; it may include secrets committed in the PR, so configure an external model only if that data transfer is acceptable.

This is a local, trusted-user tool. It has no user authentication or authorization boundary and should not be exposed as a public service without adding access controls and operational protections.

## Checks

```sh
npm run check
npm test
```

## CLI agents (Codex / Claude Code)

Use your signed-in CLI to generate workflows through the local MCP server, without a model API key. See [CLI agent setup and instructions](docs/cli-agent.md). A PR with no workflows shows a ready-to-paste command for Claude Code and Codex.
