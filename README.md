# github-admin-mcp

`github-admin-mcp` is a private Multi‑Context Processor (MCP) that exposes a rich set of GitHub administration tools via a lightweight RPC interface. It is designed for repository owners who need to automate repository hygiene, pull‑request governance, and policy enforcement beyond what standard GitHub apps provide. It is **not** a hosted SaaS; you run it locally with your own Personal Access Token (PAT).

## Features

- **Policy‑driven merge readiness** – Evaluate pull requests against a configurable merge policy including draft status, mergeability, CI status, review state, forbidden phrases, and label rules. Extend the policy via config or per‑call overrides.
- **Batch workflows** – Merge safe pull requests across multiple repos, sweep stale branches, close stale draft PRs, and delete merged branches. Combine these into a single hygiene campaign.
- **Governance inspection** – Inspect branch protection, merge strategies, and other repository governance settings. Compare governance across repositories.
- **Drift detection and enforcement** – Detect configuration drift against a baseline (allowed merge methods, auto‑delete merged branches, default branch name) and optionally apply the baseline.
- **CI / workflow support** – List workflow runs, rerun or cancel runs, dispatch workflows, and summarise PR CI state.
- **Actionable PR triage** – Categorise pull requests into ready to merge, waiting on checks, waiting on author, waiting on human, and blocked.
- **Structured audit log** – All operations write an append‑only JSONL log recording actor, target, rationale, outcome, and correlation ID. Use this log for traceability and compliance.
- **Config layering** – Built‑in defaults can be overridden via global config, repository‑local config files (`.github/github-admin-mcp.policy.json` and `.github/github-admin-mcp.repo.json`), or per‑call overrides.
- **Execution modes** – Each destructive tool accepts an execution mode:
  - `inspect` – read‑only inspection.
  - `propose` – compute intended actions without making changes (the default).
  - `apply` – perform the mutations.

## Natural‑Language Operator Layer

While the underlying MCP continues to expose strongly typed tools that accept JSON payloads, `github-admin-mcp` now includes a **conversational operator layer**. These high‑level tools are intended to be invoked by Codex and ChatGPT based on plain‑English prompts. They wrap the lower‑level operations and return chat‑friendly summaries including suggested next steps. Examples of the new operator tools include:

- **Maintainer inbox** – Summarise what needs attention across one or more repositories (ready to merge, waiting on checks, waiting on author, waiting on human, blocked). Example prompt: “Show me my maintainer inbox for ev-share and cheapskate.”
- **Run repo hygiene** – Perform or propose a hygiene campaign including merging safe PRs, sweeping stale branches, closing stale drafts and deleting merged branches. Example: “Run repo hygiene on ev-share and cheapskate but only propose the actions.”
- **Merge ready work** – Merge pull requests that satisfy the merge policy. Example: “Merge any safe PRs in ev-share and cheapskate.”
- **Branch cleanup** – Inspect or delete stale branches with optional filters for prefix, age, merged or abandoned state. Example: “Show me what stale codex branches can be deleted in cheapskate.”
- **Compare repos** – Compare repositories across governance, drift or hygiene. Example: “Compare governance between ev-share and cheapskate.”
- **Explain repo status** – Explain why a pull request cannot merge or why a branch cannot be deleted. Example: “Why can’t PR 46 merge in ev-share?”
- **Interpret and execute** – Interpret a free‑form instruction and route it to the appropriate operator tool. Only a limited set of safe admin actions are supported. Example: “Close old draft PRs across my repos, but only propose the actions first.”
- **Validate connection** – Verify that your GitHub token authenticates successfully and can access repositories. Example: “Validate connection.”

Each operator tool defaults to `propose` mode for destructive actions and returns a `summary`, per‑repo breakdown and a `nextSuggestedPrompt` to guide follow‑up actions.

## Using with Codex and ChatGPT

To use the MCP in Codex CLI, add it as an MCP server. First build and start the server:

```bash
pnpm install
pnpm run build
node dist/mcp/index.js
```

Then in another terminal, register the MCP server with Codex:

```bash
codex mcp add github-admin \
  --env GITHUB_TOKEN=YOUR_PAT \
  -- node /path/to/github-admin-mcp/dist/mcp/index.js
```

The Codex CLI writes an entry into `~/.codex/config.toml` so that subsequent sessions will automatically discover the MCP【640636928422806†L616-L663】. Once registered, you can issue plain‑English prompts in Codex such as “merge safe PRs in cheapskate” or “compare drift between ev-share and cheapskate” and the appropriate MCP tool will be invoked.

In ChatGPT, go to **Settings → Apps** and create a new **Custom MCP** app. Provide the same command you used for Codex (for stdio) or expose the MCP over HTTP if you add an HTTP transport. Set the `GITHUB_TOKEN` environment variable in the app configuration. After enabling the app, the new operator tools will appear in the tool palette and normal chat prompts will be routed accordingly.

Refer to the docs in `docs/CHAT-PROMPT-EXAMPLES.md` and `docs/CHATGPT-APP-CONFIG.md` for more examples and configuration guidance.

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm (or npm/yarn if you prefer, but pnpm is recommended)
- A GitHub Personal Access Token (classic or fine‑grained) with appropriate scopes for repository administration (e.g. `repo`, `workflow`, `admin:repo_hook`).

### Setup

1. Clone this repository and change into its directory.
2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Run the setup wizard to create a `.env` file containing your PAT:

   ```bash
   pnpm run setup
   ```

   The wizard prompts for your PAT and writes it to `.env`. Alternatively, you can set the `GITHUB_TOKEN` environment variable yourself.

4. Build the project:

   ```bash
   pnpm run build
   ```

5. Start the MCP server:

   ```bash
   node dist/mcp/index.js
   ```

The server reads JSON messages from `stdin` and writes JSON responses to `stdout`. You can integrate it into other applications via process streams or extend it with an HTTP transport later.

### Example Usage

Below are a few examples of invoking tools using JSON. Each request must include a `tool` field specifying the tool name and an optional `args` field containing the arguments defined by the tool’s input schema.

Merge safe pull requests across two repositories (proposal):

```json
{ "tool": "github_admin_merge_safe_prs", "args": { "repos": ["user/repo1", "user/repo2"], "mode": "propose" } }
```

Close stale draft PRs (older than 14 days) in a repository (apply):

```json
{ "tool": "github_admin_close_stale_drafts", "args": { "repos": ["user/repo"], "olderThanDays": 14, "mode": "apply" } }
```

Detect repository drift against baseline:

```json
{ "tool": "github_admin_detect_repo_drift", "args": { "repo": "user/repo" } }
```

Apply baseline settings to a repository (propose):

```json
{ "tool": "github_admin_apply_repo_baseline", "args": { "repo": "user/repo", "mode": "propose" } }
```

List actionable pull requests in a repo:

```json
{ "tool": "github_admin_list_actionable_prs", "args": { "repo": "user/repo" } }
```

### Configuration

Configuration is merged from several sources in the following order of precedence (highest last):

1. Built‑in defaults defined in `src/config/index.ts`.
2. Global config file specified via the `GITHUB_ADMIN_MCP_CONFIG` environment variable.
3. Repository‑local config files:
   - `.github/github-admin-mcp.policy.json` – override merge policy and other settings.
   - `.github/github-admin-mcp.repo.json` – override general MCP configuration, including limits and baseline.
4. Per‑call overrides passed in a tool’s arguments (where supported).

Config files should be JSON and may include:

- `mergePolicy` – overrides or extends the default merge policy.
- `baseline` – define baseline settings for drift detection and enforcement.
- `limits` – adjust maximum merges or deletes per run.
- `protectedBranchPatterns` – patterns of branch names that should never be deleted.

### Audit Log

All destructive operations write an entry to `./audit.log`. Each line is a JSON object containing:

```json
{
  "timestamp": "2026-04-15T12:34:56.789Z",
  "correlationId": "abc123",
  "tool": "github_admin_merge_pr",
  "mode": "apply",
  "actor": "your-github-login",
  "target": { "repo": "user/repo", "pr": 42 },
  "rationale": "PR merged automatically",
  "outcome": "success"
}
```

Use this log for auditing and rollbacks. No secrets are logged.

### Developing and Testing

To run tests:

```bash
pnpm run test
```

To lint the code:

```bash
pnpm run lint
```

To run the server in development mode without building:

```bash
pnpm run dev
```

### Contributing

This MCP is intended for private use and is not currently accepting external contributions. Feel free to fork and adapt it to your own workflow.

---

© 2026 TheTekTeam. MIT License.
