import { GitHubClient } from '../github';
import { AuditLogger } from '../audit';
import { ExecutionMode } from '../../types';
import { mergeSafePrs } from './mergeSafePrs';
import { sweepOwnerRepos } from './sweepOwnerRepos';
import { closeStaleDrafts } from './closeStaleDrafts';
import { deleteMergedBranchesAcrossRepos } from './deleteMergedBranches';

/**
 * Performs a comprehensive hygiene campaign across a set of repositories. This includes:
 * - merging PRs that pass the merge policy
 * - deleting stale branches
 * - closing stale draft PRs
 * - deleting merged branches
 * Each sub-task honors execution modes and audit logging. The returned object contains
 * the individual results of each sub-task keyed by task name.
 */
export async function repoHygieneCampaign({
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
  // Merge safe PRs
  const mergeResults = await mergeSafePrs({ client, repos, mode, policy: undefined, correlationId, audit });
  // Sweep stale branches
  const sweepResults = await sweepOwnerRepos({ client, repos, olderThanDays: 30, prefixAllowlist: undefined, mode, correlationId, audit });
  // Close stale drafts
  const closeDraftResults = await closeStaleDrafts({ client, repos, olderThanDays: 30, mode, correlationId, audit });
  // Delete merged branches
  const deleteMergedResults = await deleteMergedBranchesAcrossRepos({ client, repos, mode, correlationId, audit });
  return {
    mergeResults,
    sweepResults,
    closeDraftResults,
    deleteMergedResults,
  };
}