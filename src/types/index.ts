import { z } from 'zod';

/**
 * Supported execution modes for tools. Inspect gathers information, propose describes actions,
 * apply mutates state. Tools should default to propose for any destructive operations.
 */
export type ExecutionMode = 'inspect' | 'propose' | 'apply';

/**
 * Generic tool interface. Each tool has a name, description, input and output schemas, and an execute function.
 * Tools should perform input validation using zod and return output matching the declared schema.
 */
export interface Tool<I, O> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  execute: (input: I) => Promise<O> | O;
}

/**
 * A structured error thrown from tools. Use this instead of throwing raw strings.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

/**
 * Configuration for the MCP. This type is intentionally permissive and may be extended in future phases.
 */
export interface MCPConfig {
  /**
   * Execution limits to guard against runaway mutations. These ceilings apply per run.
   */
  limits?: {
    /**
     * Maximum number of merges allowed in a single run.
     */
    maxMergesPerRun?: number;
    /**
     * Maximum number of branch deletions allowed in a single run.
     */
    maxBranchDeletesPerRun?: number;
  };
  /**
   * List of branch name patterns that are never to be deleted.
   */
  protectedBranchPatterns?: string[];
  /**
   * Default merge policy. May be overridden by repo or per-call policy.
   */
  mergePolicy?: any;

  /**
   * Baseline repository settings used for drift detection and enforcement. When defined the
   * drift detection workflow will compare each repo against these values. Fields are optional.
   */
  baseline?: {
    /**
     * Allowed merge methods (e.g. ['merge','squash','rebase']). If set, repos must restrict merge
     * strategies to this set.
     */
    allowedMergeMethods?: string[];
    /**
     * Whether the repository should automatically delete head branches after merging pull requests.
     */
    autoDeleteMergedBranch?: boolean;
    /**
     * Required default branch name. If set, repos with a different default branch are considered drifted.
     */
    defaultBranch?: string;
    /**
     * Labels that must be present on a PR before it can be merged. Missing any of these labels
     * will block the PR under the extended merge policy.
     */
    requiredLabels?: string[];
    /**
     * Labels that forbid merging a PR when present. If any of these labels are attached to a PR
     * the extended merge policy will block the merge.
     */
    forbiddenLabels?: string[];
  };
}

/**
 * Minimal audit entry shape written to the log. Extend as needed.
 */
export interface AuditEntry {
  timestamp: string;
  correlationId: string;
  tool: string;
  mode: ExecutionMode;
  actor: string;
  target: Record<string, unknown>;
  rationale?: string;
  outcome: 'success' | 'failure';
  error?: string;
}