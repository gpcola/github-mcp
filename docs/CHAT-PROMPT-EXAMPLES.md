# Chat Prompt Examples

This document contains example prompts you can use in Codex or ChatGPT to trigger the natural‑language operator tools in `github-admin-mcp`. These prompts are intended to be typed directly into chat; the underlying model will map them to the appropriate tool invocation.

## Maintainer inbox

- “Show me my maintainer inbox for ev-share.”
- “What needs attention across ev-share and cheapskate?”
- “List actionable PRs in ev-share.”

## Hygiene campaign

- “Run repo hygiene on ev-share, but only propose the actions.”
- “Clean up my repos cheapskate and ev-share.”

## Merge ready work

- “Merge any safe PRs in ev-share.”
- “Merge ready work in ev-share and cheapskate.”

## Branch cleanup

- “Show me what stale codex branches can be deleted in cheapskate.”
- “Clean up stale branches older than 60 days in ev-share.”

## Compare repositories

- “Compare governance between ev-share and cheapskate.”
- “Compare drift for ev-share vs thetekteam-review-defence.”
- “Compare hygiene across ev-share, cheapskate and thetekteam-review-defence.”

## Explain repo status

- “Why can’t PR 46 merge in ev-share?”
- “Why is branch feature/foo not deletable?”

## Interpret and execute

- “Merge safe PRs in ev-share.”
- “Close old draft PRs across my repos, but only propose the actions first.”
- “Delete stale branches in cheapskate with prefix codex/.”

If the interpreter cannot understand your prompt, try using a more specific phrasing or invoke the operator tools directly by name.