import { GitHubClient } from '../github';
import { AuditLogger } from '../audit';
import { ExecutionMode, AuditEntry } from '../../types';
import { loadConfig } from '../../config';

/**
 * Close draft pull requests that have been open longer than the provided threshold.
 * A draft PR is considered stale if its creation date is older than `olderThanDays`. In propose or inspect
 * mode the PRs are returned with the intended action; in apply mode the PRs are closed.
 */
export async function closeStaleDrafts({
  client,
  repos,
  olderThanDays = 30,
  mode = 'propose',
  correlationId,
  audit,
}: {
  client: GitHubClient;
  repos: string[];
  olderThanDays?: number;
  mode?: ExecutionMode;
  correlationId: string;
  audit: AuditLogger;
}) {
  const config = await loadConfig();
  const results: any[] = [];
  const now = new Date();
  const auth = await client.validateAuthentication();
  for (const repoFullName of repos) {
    const prs = await client.listPulls({ repoFullName, state: 'open', draft: true, per_page: 100 });
    for (const pr of prs) {
      // Determine age
      const createdAt = new Date(pr.created_at);
      const ageDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      const target = { repo: repoFullName, pr: pr.number };
      if (ageDays < olderThanDays) {
        results.push({ repo: repoFullName, pr: pr.number, status: 'kept', reason: 'recent draft' });
        continue;
      }
      // Candidate for closure
      if (mode === 'inspect' || mode === 'propose') {
        results.push({ repo: repoFullName, pr: pr.number, status: 'stale_draft', action: 'close' });
        const entry: AuditEntry = {
          timestamp: new Date().toISOString(),
          correlationId,
          tool: 'closeStaleDrafts',
          mode,
          actor: auth.login,
          target,
          rationale: `Draft PR older than ${olderThanDays} days`,
          outcome: 'success',
        };
        await audit.log(entry);
      } else if (mode === 'apply') {
        try {
          await client.updatePullState({ repoFullName, number: pr.number, state: 'closed' });
          results.push({ repo: repoFullName, pr: pr.number, status: 'closed' });
          const entry: AuditEntry = {
            timestamp: new Date().toISOString(),
            correlationId,
            tool: 'closeStaleDrafts',
            mode,
            actor: auth.login,
            target,
            rationale: 'Stale draft PR closed',
            outcome: 'success',
          };
          await audit.log(entry);
        } catch (err: any) {
          results.push({ repo: repoFullName, pr: pr.number, status: 'error', error: err.message });
          const entry: AuditEntry = {
            timestamp: new Date().toISOString(),
            correlationId,
            tool: 'closeStaleDrafts',
            mode,
            actor: auth.login,
            target,
            rationale: 'Failed to close stale draft PR',
            outcome: 'failure',
            error: err.message,
          };
          await audit.log(entry);
        }
      }
    }
  }
  return { results };
}