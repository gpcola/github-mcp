import fs from 'node:fs/promises';
import path from 'node:path';
import { MCPConfig } from '../types';

/**
 * Default configuration values. These serve as a baseline and may be overridden by
 * environment-specified or repo-local configuration files.
 */
const defaultConfig: MCPConfig = {
  limits: {
    maxMergesPerRun: 10,
    maxBranchDeletesPerRun: 20,
  },
  protectedBranchPatterns: ['main', 'master', 'develop', 'release/', 'hotfix/', 'production', 'staging'],
  mergePolicy: {
    requireNotDraft: true,
    requireMergeable: true,
    requireAllChecksGreen: true,
    requireNoRequestedChanges: true,
    requireReviewDecisionApprovedOrNone: false,
    forbidIfPrBodyContains: [
      'do not merge',
      'blocked',
      'needs integrated verification',
      'not ready',
      'wip',
    ],
  },

  // Baseline repository settings. These are used by drift detection and enforcement workflows.
  baseline: {
    allowedMergeMethods: ['merge', 'squash', 'rebase'],
    autoDeleteMergedBranch: true,
    defaultBranch: 'main',
    requiredLabels: [],
    forbiddenLabels: [],
  },
};

/**
 * Load configuration from multiple layers. The precedence is:
 * 1. Built-in defaults
 * 2. Global config file specified by GITHUB_ADMIN_MCP_CONFIG environment variable
 * 3. Repo-local config file (if found in working directory)
 * 4. Optional overrides passed in
 *
 * @param overrides overrides provided at runtime
 */
export async function loadConfig(overrides?: Partial<MCPConfig>): Promise<MCPConfig> {
  // Start with the built-in defaults
  let config: MCPConfig = { ...defaultConfig };

  // Global config via environment variable
  const envPath = process.env.GITHUB_ADMIN_MCP_CONFIG;
  if (envPath) {
    try {
      const json = await fs.readFile(envPath, 'utf8');
      const parsed = JSON.parse(json);
      config = { ...config, ...parsed };
    } catch {
      // ignore if file not found or invalid
    }
  }

  // Repo-local config: look for .github/github-admin-mcp.policy.json and .github/github-admin-mcp.repo.json
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, '.github', 'github-admin-mcp.policy.json'),
    path.join(cwd, '.github', 'github-admin-mcp.repo.json'),
    path.join(cwd, 'github-admin-mcp.config.json'),
  ];
  for (const file of candidates) {
    try {
      const json = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(json);
      config = { ...config, ...parsed };
    } catch {
      // ignore missing or invalid file
    }
  }

  // Apply overrides last
  if (overrides) {
    config = { ...config, ...overrides };
  }
  return config;
}