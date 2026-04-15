import { GitHubClient } from '../github';
import { sweepOwnerRepos } from './sweepOwnerRepos';
import { AuditLogger } from '../audit';
import { ExecutionMode } from '../../types';

/**
 * Performs an inspection or cleanup of stale branches across one or more repositories.
 *
 * This wraps `sweepOwnerRepos` and produces a chat‑friendly summary. Branches
 * are categorised into those recommended for deletion (`toDelete`) and those
 * kept (`kept` with a reason). If `mode=apply` is used, the branches in
 * `toDelete` will actually be deleted subject to deletion limits. The summary
 * reflects what was proposed or performed.
 */
export async function branchCleanup({
  client,
  repos,
  olderThanDays = 30,
  prefixAllowlist,
  onlyMerged = false,
  onlyAbandoned = false,
  mode = 'propose',
  correlationId,
  audit,
}: {
  client: GitHubClient;
  repos: string[];
  olderThanDays?: number;
  prefixAllowlist?: string[];
  onlyMerged?: boolean;
  onlyAbandoned?: boolean;
  mode?: ExecutionMode;
  correlationId: string;
  audit: AuditLogger;
}) {
  // Delegate to sweepOwnerRepos for stale branches
  const sweep = await sweepOwnerRepos({ client, repos, olderThanDays, prefixAllowlist, mode, correlationId, audit });
  const toDelete: any[] = [];
  const kept: any[] = [];
  for (const entry of sweep.results) {
    if (entry.status === 'stale' || entry.status === 'deleted' || entry.status === 'eligible') {
      // Evaluate filters: onlyMerged or onlyAbandoned
      if (onlyMerged) {
        // if branch has associated merged PR, action in sweep may be 'delete' or 'eligible' but reason 'merged PR'
        if (entry.reason === 'merged PR') {
          toDelete.push(entry);
        } else {
          kept.push(entry);
        }
      } else if (onlyAbandoned) {
        // branches with reason 'no PR' or 'closed PR'
        if (entry.reason === 'no PR' || entry.reason === 'closed PR') {
          toDelete.push(entry);
        } else {
          kept.push(entry);
        }
      } else {
        toDelete.push(entry);
      }
    } else {
      kept.push(entry);
    }
  }
  // Compose a summary
  const summary = toDelete.length
    ? `${toDelete.length} branch${toDelete.length === 1 ? '' : 'es'} can be deleted.`
    : 'No stale branches found to delete.';
  const nextSuggestedPrompt = toDelete.length
    ? mode === 'apply'
      ? undefined
      : 'To delete these branches, run the cleanup in apply mode'
    : undefined;
  return {
    summary,
    toDelete,
    kept,
    nextSuggestedPrompt,
  };
}