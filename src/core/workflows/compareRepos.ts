import { GitHubClient } from '../github';
import { maintainerInbox } from './maintainerInbox';
import { branchCleanup } from './branchCleanup';
import { detectRepoDrift } from './detectRepoDrift';

/**
 * Compares repositories across governance, drift or hygiene dimensions.
 *
 * Supported comparison types:
 *  - 'governance': compare default branch, merge strategies and branch protection fields.
 *  - 'drift': run `detectRepoDrift` for each repo and return drift objects side by side.
 *  - 'hygiene': summarise maintainer inbox and stale branches for each repo.
 */
export async function compareRepos({
  client,
  repos,
  compare,
}: {
  client: GitHubClient;
  repos: string[];
  compare: 'governance' | 'drift' | 'hygiene';
}) {
  if (repos.length < 2) {
    throw new Error('At least two repositories are required for comparison');
  }
  if (compare === 'governance') {
    const infos = await Promise.all(repos.map((r) => client.getRepo(r)));
    // Determine differences across key fields
    const fields = ['default_branch', 'allow_merge_commit', 'allow_squash_merge', 'allow_rebase_merge', 'delete_branch_on_merge'];
    const differences: Record<string, any> = {};
    for (const field of fields) {
      const values: Record<string, any> = {};
      for (let i = 0; i < repos.length; i++) {
        values[repos[i]] = infos[i][field as keyof typeof infos[0]];
      }
      const unique = new Set(Object.values(values));
      if (unique.size > 1) {
        differences[field] = values;
      }
    }
    const summary = Object.keys(differences).length
      ? `Repositories differ on ${Object.keys(differences).join(', ')}.`
      : 'Repositories share the same governance settings.';
    return { summary, differences };
  }
  if (compare === 'drift') {
    const driftResults = {} as any;
    for (const repo of repos) {
      // detectRepoDrift returns an object describing differences from baseline
      driftResults[repo] = await detectRepoDrift({ client, repo });
    }
    const summary = 'Drift comparison complete.';
    return { summary, drift: driftResults };
  }
  if (compare === 'hygiene') {
    // Summarise maintainer inbox and stale branches for each repo
    const inboxResults = await maintainerInbox({ client, repos });
    // For branch cleanup we need correlationId and audit; but for hygiene summary we can just count stale branches per repo using branchCleanup in inspect mode
    const staleCounts: Record<string, number> = {};
    for (const repo of repos) {
      // Use a dummy correlationId and audit; not used in inspect mode
      const dummy = { generateCorrelationId: () => 'compare' } as any;
      const cleanup = await branchCleanup({ client, repos: [repo], correlationId: 'compare', audit: dummy as any, mode: 'inspect' });
      staleCounts[repo] = cleanup.toDelete.length;
    }
    const summary = `Hygiene summary: ${inboxResults.summary}`;
    return { summary, inbox: inboxResults.repos, staleBranches: staleCounts };
  }
  throw new Error(`Unsupported compare type: ${compare}`);
}