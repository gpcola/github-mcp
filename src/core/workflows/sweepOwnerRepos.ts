import { GitHubClient } from '../github';
import { AuditLogger } from '../audit';
import { loadConfig } from '../../config';
import { ExecutionMode, AuditEntry } from '../../types';

/**
 * Sweep through branches of multiple repositories and delete stale branches according to policy and configuration.
 * A branch is considered stale if its last commit is older than `olderThanDays` and it either has a merged PR or no associated PR.
 * Protected branches and default branches are never deleted.
 */
export async function sweepOwnerRepos({
  client,
  repos,
  olderThanDays = 30,
  prefixAllowlist,
  mode = 'propose',
  correlationId,
  audit,
}: {
  client: GitHubClient;
  repos: string[];
  olderThanDays?: number;
  prefixAllowlist?: string[];
  mode?: ExecutionMode;
  correlationId: string;
  audit: AuditLogger;
}) {
  const config = await loadConfig();
  const maxDeletes = config.limits?.maxBranchDeletesPerRun ?? 20;
  let deletesPerformed = 0;
  const results: any[] = [];
  const now = new Date();
  const auth = await client.validateAuthentication();

  for (const repoFullName of repos) {
    const repoInfo = await client.getRepo(repoFullName);
    const defaultBranch = repoInfo.default_branch;
    const branches = await client.listBranches({ repoFullName, per_page: 100 });
    for (const branch of branches) {
      const branchName: string = branch.name;
      // Skip default branch
      if (branchName === defaultBranch) {
        results.push({ repo: repoFullName, branch: branchName, status: 'kept', reason: 'default' });
        continue;
      }
      // Skip protected branch
      if (branch.protected) {
        results.push({ repo: repoFullName, branch: branchName, status: 'kept', reason: 'protected' });
        continue;
      }
      // Skip if prefixAllowlist provided and branch does not start with any prefix
      if (prefixAllowlist && prefixAllowlist.length > 0) {
        const allowed = prefixAllowlist.some((p) => branchName.startsWith(p));
        if (!allowed) {
          results.push({ repo: repoFullName, branch: branchName, status: 'kept', reason: 'prefix not allowed' });
          continue;
        }
      }
      // Determine commit age
      let commitDate: Date | null = null;
      try {
        commitDate = new Date(branch.commit.commit.author.date);
      } catch {
        commitDate = null;
      }
      const ageDays = commitDate ? (now.getTime() - commitDate.getTime()) / (1000 * 60 * 60 * 24) : null;
      if (ageDays !== null && ageDays < olderThanDays) {
        results.push({ repo: repoFullName, branch: branchName, status: 'kept', reason: 'recent' });
        continue;
      }
      // Find associated PRs
      let associatedPr: any = null;
      try {
        const headRef = `${repoFullName.split('/')[0]}:${branchName}`;
        const prs = await client.listPulls({ repoFullName, state: 'all', head: headRef, per_page: 1 });
        associatedPr = prs.length > 0 ? prs[0] : null;
      } catch {
        associatedPr = null;
      }
      let recommend = false;
      let reason: string = '';
      if (associatedPr) {
        if (associatedPr.merged_at) {
          recommend = true;
          reason = 'merged PR';
        } else if (associatedPr.state === 'closed') {
          recommend = true;
          reason = 'closed PR';
        } else {
          // open PR; do not delete
          recommend = false;
          reason = 'open PR';
        }
      } else {
        recommend = true;
        reason = 'no PR';
      }
      // Log and optionally delete
      const target = { repo: repoFullName, branch: branchName };
      if (recommend) {
        if (mode === 'inspect' || mode === 'propose') {
          results.push({ repo: repoFullName, branch: branchName, status: 'stale', action: 'delete', reason });
          const entry: AuditEntry = {
            timestamp: new Date().toISOString(),
            correlationId,
            tool: 'sweepOwnerRepos',
            mode,
            actor: auth.login,
            target,
            rationale: `Branch considered stale: ${reason}`,
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
            results.push({ repo: repoFullName, branch: branchName, status: 'deleted', reason });
            const entry: AuditEntry = {
              timestamp: new Date().toISOString(),
              correlationId,
              tool: 'sweepOwnerRepos',
              mode,
              actor: auth.login,
              target,
              rationale: `Stale branch deleted: ${reason}`,
              outcome: 'success',
            };
            await audit.log(entry);
          } catch (err: any) {
            results.push({ repo: repoFullName, branch: branchName, status: 'error', error: err.message });
            const entry: AuditEntry = {
              timestamp: new Date().toISOString(),
              correlationId,
              tool: 'sweepOwnerRepos',
              mode,
              actor: auth.login,
              target,
              rationale: `Failed to delete stale branch: ${reason}`,
              outcome: 'failure',
              error: err.message,
            };
            await audit.log(entry);
          }
        }
      } else {
        results.push({ repo: repoFullName, branch: branchName, status: 'kept', reason });
      }
    }
  }
  return { deletesPerformed, results };
}