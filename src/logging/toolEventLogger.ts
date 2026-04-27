import { mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { ToolEventRecord } from '../types.js';
import { redactJson } from '../utils/redact.js';

export class ToolEventLogger {
  private readonly filePath: string;

  constructor() {
    const date = new Date().toISOString().slice(0, 10);
    this.filePath = path.join(config.logDir, `ai-tool-events-${date}.jsonl`);
  }

  async write(record: ToolEventRecord): Promise<void> {
    await mkdir(config.logDir, { recursive: true });
    const safeRecord = redactJson(record);
    await appendFile(this.filePath, `${JSON.stringify(safeRecord)}\n`, 'utf8');
  }
}

export const toolEventLogger = new ToolEventLogger();
