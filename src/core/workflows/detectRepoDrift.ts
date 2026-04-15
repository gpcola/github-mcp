import { GitHubClient } from '../github';
import { loadConfig } from '../../config';

/**
 * Detects configuration drift in a repository compared to the baseline defined in MCP config.
 * Returns an object describing which settings differ from the baseline and what the current values are.
 */
export async function detectRepoDrift({ client, repo }: { client: GitHubClient; repo: string }) {
  const config = await loadConfig();
  const baseline = config.baseline || {};
  const repoInfo = await client.getRepo(repo);
  const drift: Record<string, any> = {};
  // Default branch
  if (baseline.defaultBranch && repoInfo.default_branch !== baseline.defaultBranch) {
    drift.defaultBranch = { current: repoInfo.default_branch, expected: baseline.defaultBranch };
  }
  // Merge methods
  if (baseline.allowedMergeMethods && baseline.allowedMergeMethods.length > 0) {
    const allowed = baseline.allowedMergeMethods;
    const allowsMerge = repoInfo.allow_merge_commit === true;
    const allowsSquash = repoInfo.allow_squash_merge === true;
    const allowsRebase = repoInfo.allow_rebase_merge === true;
    const actual = [] as string[];
    if (allowsMerge) actual.push('merge');
    if (allowsSquash) actual.push('squash');
    if (allowsRebase) actual.push('rebase');
    const missing = allowed.filter((m) => !actual.includes(m));
    const extra = actual.filter((m) => !allowed.includes(m));
    if (missing.length > 0 || extra.length > 0) {
      drift.allowedMergeMethods = { current: actual, expected: allowed };
    }
  }
  // Auto-delete merged branch
  if (typeof baseline.autoDeleteMergedBranch === 'boolean' && repoInfo.delete_branch_on_merge !== baseline.autoDeleteMergedBranch) {
    drift.autoDeleteMergedBranch = { current: repoInfo.delete_branch_on_merge, expected: baseline.autoDeleteMergedBranch };
  }
  return drift;
}