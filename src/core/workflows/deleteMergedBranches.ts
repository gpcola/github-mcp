import { GitHubClient } from '../github';
import { AuditLogger } from '../audit';
import { ExecutionMode, AuditEntry } from '../../types';
import { loadConfig } from '../../config';

/**
 * Delete branches whose associated pull request has been merged across multiple repositories.
 * Does not consider branches without PRs; those are handled by sweepOwnerRepos. It focuses on cleaning
 * up merged branches even if they are recent.
 */
export async function deleteMergedBranchesAcrossRepos({
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
  const config = await loadConfig();
  const maxDeletes = config.limits?.maxBranchDeletesPerRun ?? 20;
  let deletesPerformed = 0;
  const results: any[] = [];
  const auth = await client.validateAuthentication();
  for (const repoFullName of repos) {
    const repoInfo = await client.getRepo(repoFullName);
    const defaultBranch = repoInfo.default_branch;
    const branches = await client.listBranches({ repoFullName, per_page: 100 });
    for (const branch of branches) {
      const branchName = branch.name;
      // skip default and protected
      if (branchName === defaultBranch || branch.protected) {
        results.push({ repo: repoFullName, branch: branchName, status: 'kept', reason: branchName === defaultBranch ? 'default' : 'protected' });
        continue;
      }
      // Find PR associated with branch
      let associatedPr: any = null;
      try {
        const headRef = `${repoFullName.split('/')[0]}:${branchName}`;
        const prs = await client.listPulls({ repoFullName, state: 'closed', head: headRef, per_page: 1 });
        associatedPr = prs.length > 0 ? prs[0] : null;
      } catch {
        associatedPr = null;
      }
      if (!associatedPr || !associatedPr.merged_at) {
        // Not a merged branch
        results.push({ repo: repoFullName, branch: branchName, status: 'kept', reason: 'no merged PR' });
        continue;
      }
      const target = { repo: repoFullName, branch: branchName };
      if (mode === 'inspect' || mode === 'propose') {
        results.push({ repo: repoFullName, branch: branchName, status: 'eligible', action: 'delete', pr: associatedPr.number });
        const entry: AuditEntry = {
          timestamp: new Date().toISOString(),
          correlationId,
          tool: 'deleteMergedBranchesAcrossRepos',
          mode,
          actor: auth.login,
          target,
          rationale: `Branch has merged PR #${associatedPr.number}`,
          outcome: 'success',
        };
        await audit.log(entry);
      } else if (mode === 'apply') {
        if (deletesPerformed >= maxDeletes) {
          results.push({ repo: repoFullName, branch: branchName, status: 'skipped', reason: 'delete limit reached' });
          continue;
        }
        try {
          await client.deleteBranch({ repoFullName, branch: branchName });
          deletesPerformed++;
          results.push({ repo: repoFullName, branch: branchName, status: 'deleted', pr: associatedPr.number });
          const entry: AuditEntry = {
            timestamp: new Date().toISOString(),
            correlationId,
            tool: 'deleteMergedBranchesAcrossRepos',
            mode,
            actor: auth.login,
            target,
            rationale: `Merged branch deleted`,
            outcome: 'success',
          };
          await audit.log(entry);
        } catch (err: any) {
          results.push({ repo: repoFullName, branch: branchName, status: 'error', error: err.message });
          const entry: AuditEntry = {
            timestamp: new Date().toISOString(),
            correlationId,
            tool: 'deleteMergedBranchesAcrossRepos',
            mode,
            actor: auth.login,
            target,
            rationale: 'Failed to delete merged branch',
            outcome: 'failure',
            error: err.message,
          };
          await audit.log(entry);
        }
      }
    }
  }
  return { deletesPerformed, results };
}