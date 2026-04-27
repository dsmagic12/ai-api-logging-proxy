import { mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { AuditRecord } from '../types.js';
import { redactJson } from '../utils/redact.js';

export class AuditLogger {
  private readonly filePath: string;

  constructor() {
    const date = new Date().toISOString().slice(0, 10);
    this.filePath = path.join(config.logDir, `ai-api-${date}.jsonl`);
  }

  async write(record: AuditRecord): Promise<void> {
    await mkdir(config.logDir, { recursive: true });
    const safeRecord = redactJson(record);
    await appendFile(this.filePath, `${JSON.stringify(safeRecord)}\n`, 'utf8');
  }
}

export const auditLogger = new AuditLogger();
