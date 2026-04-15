import { GitHubClient } from '../github';
import { AuditLogger } from '../audit';
import { loadConfig } from '../../config';
import { evaluateMergePolicy, MergePolicy } from '../policy';
import { ExecutionMode, AuditEntry } from '../../types';

/**
 * Attempts to merge pull requests across a set of repositories if they pass the merge policy.
 * Respects limits defined in the MCP config and execution mode. Returns a summary of actions.
 */
export async function mergeSafePrs({
  client,
  repos,
  mode = 'propose',
  policy,
  correlationId,
  audit,
}: {
  client: GitHubClient;
  repos: string[];
  mode?: ExecutionMode;
  policy?: MergePolicy;
  correlationId: string;
  audit: AuditLogger;
}) {
  const config = await loadConfig();
  const maxMerges = config.limits?.maxMergesPerRun ?? 10;
  let mergesPerformed = 0;
  const results: any[] = [];
  // Validate token and get actor for audit
  const auth = await client.validateAuthentication();
  for (const repoFullName of repos) {
    const prs = await client.listPulls({ repoFullName, state: 'open', per_page: 100 });
    for (const pr of prs) {
      // Evaluate merge readiness
      const sha = pr.head?.sha;
      if (!sha) continue;
      const checks = await client.getCommitChecks({ repoFullName, sha });
      const reviews = await client.getPullReviews({ repoFullName, number: pr.number });
      const evalResult = evaluateMergePolicy({ pr, checks, reviews, policy });
      const target = { repo: repoFullName, pr: pr.number };
      if (!evalResult.policyPass) {
        // Skip blocked PRs
        results.push({ repo: repoFullName, pr: pr.number, status: 'blocked', blockers: evalResult.blockers });
        continue;
      }
      if (mode === 'inspect' || mode === 'propose') {
        results.push({ repo: repoFullName, pr: pr.number, status: 'ready', action: 'merge' });
        // Audit propose/inspect
        const entry: AuditEntry = {
          timestamp: new Date().toISOString(),
          correlationId,
          tool: 'mergeSafePrs',
          mode,
          actor: auth.login,
          target,
          rationale: 'PR passes merge policy',
          outcome: 'success',
        };
        await audit.log(entry);
      } else if (mode === 'apply') {
        if (mergesPerformed >= maxMerges) {
          results.push({ repo: repoFullName, pr: pr.number, status: 'skipped', reason: 'merge limit reached' });
          continue;
        }
        // Actually merge
        try {
          const mergeResult = await client.mergePullRequest({ repoFullName, number: pr.number, mergeMethod: 'merge' });
          mergesPerformed++;
          results.push({ repo: repoFullName, pr: pr.number, status: 'merged', mergeResult });
          const entry: AuditEntry = {
            timestamp: new Date().toISOString(),
            correlationId,
            tool: 'mergeSafePrs',
            mode,
            actor: auth.login,
            target,
            rationale: 'PR merged automatically',
            outcome: 'success',
          };
          await audit.log(entry);
        } catch (err: any) {
          results.push({ repo: repoFullName, pr: pr.number, status: 'error', error: err.message });
          const entry: AuditEntry = {
            timestamp: new Date().toISOString(),
            correlationId,
            tool: 'mergeSafePrs',
            mode,
            actor: auth.login,
            target,
            rationale: 'Attempt to merge PR',
            outcome: 'failure',
            error: err.message,
          };
          await audit.log(entry);
        }
      }
    }
  }
  return { mergesPerformed, results };
}