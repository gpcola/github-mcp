import fs from 'node:fs/promises';
import { AuditEntry } from '../../types';

/**
 * Audit logger writes JSONL entries to a file for traceability. Log file path can be provided
 * via AUDIT_LOG_PATH environment variable or defaults to ./audit.log in the current working directory.
 */
export class AuditLogger {
  private readonly logPath: string;

  constructor(logPath?: string) {
    this.logPath = logPath || process.env.AUDIT_LOG_PATH || 'audit.log';
  }

  /**
   * Append an entry to the audit log.
   */
  async log(entry: AuditEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(this.logPath, line, 'utf8');
  }

  /**
   * Generate a correlation ID for a run. Uses timestamp and random component.
   */
  generateCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }
}