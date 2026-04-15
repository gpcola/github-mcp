# Natural‑Language Usage Guide

`github-admin-mcp` exposes a rich set of strongly typed tools for GitHub administration. To make it easier to use in Codex and ChatGPT, a **conversational operator layer** wraps these tools and provides chat‑friendly summaries. This guide explains how to craft prompts that trigger the correct tools without writing JSON manually.

## Key concepts

- **Operator tools** – High‑level tools designed for natural language. They summarise results and suggest next steps. Examples include maintainer inbox, run repo hygiene, merge ready work, branch cleanup, compare repos and explain repo status.
- **Execution modes** – For destructive actions, there are three modes: `inspect` (read‑only), `propose` (compute intended actions), and `apply` (perform the actions). Operator tools default to `propose` mode.
- **Repos parameter** – Many operator tools accept a list of repositories. If you specify the repositories in your prompt (e.g. `ev-share` or `owner/repo`), the model will infer them. Otherwise, include a `repos` parameter in the JSON payload.

## Example prompts

- **Summarise maintainer inbox**

  > “Show me my maintainer inbox for ev-share and cheapskate.”

  This invokes `github_admin_maintainer_inbox` with `repos=["ev-share","cheapskate"]` and returns a summary of ready PRs, waiting on checks, waiting on author, waiting on human and blocked PRs.

- **Run a hygiene campaign (proposal)**

  > “Run repo hygiene on ev-share, but only propose the actions.”

  This invokes `github_admin_run_repo_hygiene` with `mode="propose"` and returns what would be merged, which branches would be deleted, which stale drafts would be closed and which merged branches would be cleaned up.

- **Merge ready work**

  > “Merge any safe PRs in cheapskate.”

  This invokes `github_admin_merge_ready_work` and merges the PRs that pass the merge policy. In propose mode it reports which PRs are ready; in apply mode it merges them.

- **Branch cleanup**

  > “Show me what stale codex branches can be deleted in cheapskate.”

  This invokes `github_admin_branch_cleanup` with a prefix allowlist (e.g. `codex/`). It returns which branches are considered stale and why, and suggests running again in apply mode to delete them.

- **Compare repositories**

  > “Compare governance between ev-share and cheapskate.”

  This invokes `github_admin_compare_repos` with `compare="governance"` and shows differences in default branches and merge strategies.

- **Explain why a PR is blocked**

  > “Why can’t PR 46 merge in ev-share?”

  This invokes `github_admin_explain_repo_status` with `prNumber=46` and returns the merge blockers.

## Confirmation flow

For safety, operator tools default to proposing actions. To perform destructive actions, include `mode="apply"` in your JSON payload or instruct the assistant to “apply the actions.” The assistant may ask you to confirm if an irreversible operation is about to occur.

## Limitations

The free‑text interpreter (`github_admin_interpret_and_execute`) understands only a limited set of admin actions. If your prompt is ambiguous or unsupported, the model will ask you to use a more specific tool. Always specify repositories to avoid unintended broad operations.
