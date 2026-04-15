import { GitHubClient } from '../github';
import { AuditLogger } from '../audit';
import { ExecutionMode, AuditEntry } from '../../types';
import { loadConfig } from '../../config';
import { detectRepoDrift } from './detectRepoDrift';

/**
 * Applies baseline repository settings to a repository. Only settings that differ from the baseline
 * are updated. Returns a summary of the changes that would be applied or have been applied.
 */
export async function applyRepoBaseline({
  client,
  repo,
  mode = 'propose',
  correlationId,
  audit,
}: {
  client: GitHubClient;
  repo: string;
  mode?: ExecutionMode;
  correlationId: string;
  audit: AuditLogger;
}) {
  const config = await loadConfig();
  const baseline = config.baseline || {};
  const drift = await detectRepoDrift({ client, repo });
  const auth = await client.validateAuthentication();
  const target = { repo };
  const changes: Record<string, any> = {};
  if (drift.allowedMergeMethods) {
    const expected: string[] = drift.allowedMergeMethods.expected;
    // Build patch for merge strategies
    changes.allow_merge_commit = expected.includes('merge');
    changes.allow_squash_merge = expected.includes('squash');
    changes.allow_rebase_merge = expected.includes('rebase');
  }
  if (drift.autoDeleteMergedBranch) {
    changes.delete_branch_on_merge = drift.autoDeleteMergedBranch.expected;
  }
  // Note: Changing default branch name is a risky operation; we do not perform automatically.

  if (Object.keys(changes).length === 0) {
    return { updated: false, message: 'No drift detected', drift };
  }
  if (mode === 'inspect' || mode === 'propose') {
    await audit.log({ timestamp: new Date().toISOString(), correlationId, tool: 'applyRepoBaseline', mode, actor: auth.login, target, rationale: 'Repo baseline changes proposed', outcome: 'success' });
    return { updated: false, proposedChanges: changes, drift };
  }
  // apply
  try {
    await client.updateRepoSettings({ repoFullName: repo, settings: changes });
    await audit.log({ timestamp: new Date().toISOString(), correlationId, tool: 'applyRepoBaseline', mode, actor: auth.login, target, rationale: 'Repo baseline changes applied', outcome: 'success' });
    return { updated: true, changes };
  } catch (err: any) {
    await audit.log({ timestamp: new Date().toISOString(), correlationId, tool: 'applyRepoBaseline', mode, actor: auth.login, target, rationale: 'Failed to apply baseline changes', outcome: 'failure', error: err.message });
    throw err;
  }
}