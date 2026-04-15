import { GitHubClient } from '../github';
import { repoHygieneCampaign } from './repoHygieneCampaign';
import { AuditLogger } from '../audit';
import { ExecutionMode } from '../../types';

/**
 * Runs a full repository hygiene campaign and summarises the actions.
 *
 * This function invokes the existing `repoHygieneCampaign` which performs
 * merging safe PRs, sweeping stale branches, closing stale draft PRs, and
 * deleting merged branches. The returned object summarises the number of
 * actions proposed or performed in each category and includes a human‑friendly
 * summary string and next suggested prompt.
 */
export async function runRepoHygiene({
  client,
  repos,
  mode = 'propose',
  correlationId,
  audit,
}: {
  client: GitHubClient;
  repos: string[];
  mode?: ExecutionMode;
  correlationId: string;
  audit: AuditLogger;
}) {
  const result = await repoHygieneCampaign({ client, repos, mode, correlationId, audit });
  // Extract counts from subtask results
  const mergeResults = result.mergeResults.results;
  const mergeReady = mergeResults.filter((r: any) => r.status === 'ready');
  const mergeMerged = mergeResults.filter((r: any) => r.status === 'merged');
  const mergeBlocked = mergeResults.filter((r: any) => r.status === 'blocked');

  const sweepResults = result.sweepResults.results;
  const sweepDelete = sweepResults.filter((r: any) => r.status === 'stale' || r.status === 'deleted' || r.status === 'eligible');
  const sweepKept = sweepResults.filter((r: any) => r.status === 'kept');

  const closeDraftResults = result.closeDraftResults.results;
  const staleDrafts = closeDraftResults.filter((r: any) => r.status === 'stale_draft' || r.status === 'closed');

  const deleteMergedResults = result.deleteMergedResults.results;
  const deleteMergedBranches = deleteMergedResults.filter((r: any) => r.status === 'eligible' || r.status === 'deleted');

  // Compose summary
  const parts: string[] = [];
  if (mergeMerged.length || (mode !== 'apply' && mergeReady.length)) {
    const count = mode === 'apply' ? mergeMerged.length : mergeReady.length;
    if (count) parts.push(`${count} PR${count === 1 ? '' : 's'} ${mode === 'apply' ? 'merged' : 'ready'}`);
  }
  if (staleDrafts.length) parts.push(`${staleDrafts.length} stale draft PR${staleDrafts.length === 1 ? '' : 's'} ${mode === 'apply' ? 'closed' : 'to close'}`);
  if (sweepDelete.length) parts.push(`${sweepDelete.length} branch${sweepDelete.length === 1 ? '' : 'es'} ${mode === 'apply' ? 'deleted' : 'to delete'}`);
  if (deleteMergedBranches.length) parts.push(`${deleteMergedBranches.length} merged branch${deleteMergedBranches.length === 1 ? '' : 'es'} ${mode === 'apply' ? 'deleted' : 'to delete'}`);
  const summary = parts.length ? parts.join(', ') : 'Nothing to do.';
  const nextSuggestedPrompt = mode === 'apply' ? undefined : 'Run the hygiene campaign in apply mode to perform these actions';
  return {
    summary,
    merge: { ready: mergeReady, merged: mergeMerged, blocked: mergeBlocked },
    staleBranches: sweepDelete,
    keptBranches: sweepKept,
    staleDrafts,
    mergedBranchesDeleted: deleteMergedBranches,
    nextSuggestedPrompt,
  };
}