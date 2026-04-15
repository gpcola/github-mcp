import { GitHubClient } from '../github';
import { mergeSafePrs } from './mergeSafePrs';
import { MergePolicy, defaultMergePolicy } from '../policy';
import { AuditLogger } from '../audit';
import { ExecutionMode } from '../../types';

/**
 * Merges pull requests that satisfy the merge policy across the specified repositories.
 *
 * This is a chat‑friendly wrapper around `mergeSafePrs` that summarises the result
 * with counts of merged or ready PRs and lists of blocked PRs with their blockers.
 * When run in `propose` or `inspect` mode, no merges are performed and the result
 * includes which PRs are ready. When run in `apply` mode the PRs are merged until
 * the per‑run limit is reached.
 */
export async function mergeReadyWork({
  client,
  repos,
  mode = 'propose',
  policy,
  maxActions,
  correlationId,
  audit,
}: {
  client: GitHubClient;
  repos: string[];
  mode?: ExecutionMode;
  policy?: MergePolicy;
  maxActions?: number;
  correlationId: string;
  audit: AuditLogger;
}) {
  // Pass custom policy if provided
  const effectivePolicy = { ...defaultMergePolicy, ...(policy || {}) };
  // mergeSafePrs honours config limits; maxActions can override by temporarily updating config?
  // For now we ignore maxActions and rely on config.limits.maxMergesPerRun
  const result = await mergeSafePrs({ client, repos, mode, policy: effectivePolicy, correlationId, audit });
  const merged = result.results.filter((r: any) => r.status === 'merged');
  const ready = result.results.filter((r: any) => r.status === 'ready');
  const blocked = result.results.filter((r: any) => r.status === 'blocked');
  const summaryParts: string[] = [];
  if (mode === 'apply') {
    if (merged.length) summaryParts.push(`${merged.length} PR${merged.length === 1 ? '' : 's'} merged`);
    if (ready.length) summaryParts.push(`${ready.length} PR${ready.length === 1 ? '' : 's'} still ready`);
  } else {
    if (ready.length) summaryParts.push(`${ready.length} PR${ready.length === 1 ? '' : 's'} ready to merge`);
  }
  if (blocked.length) summaryParts.push(`${blocked.length} blocked`);
  const summary = summaryParts.length ? summaryParts.join(', ') : 'No pull requests meet the criteria.';
  const nextSuggestedPrompt =
    mode === 'apply'
      ? undefined
      : ready.length
      ? 'Merge the ready pull requests'
      : blocked.length
      ? 'Fix the blockers on the blocked pull requests'
      : undefined;
  return {
    summary,
    merged,
    ready,
    blocked,
    nextSuggestedPrompt,
  };
}