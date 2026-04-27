import type { CoachingSignal, ToolEventRecord } from '../types.js';

type CommandObservation = {
  timestampMs: number;
  command: string;
  categories: Set<CommandCategory>;
};

type CommandCategory =
  | 'delete_node_modules'
  | 'delete_package_lock'
  | 'npm_install'
  | 'polling_check';

type SessionState = {
  observations: CommandObservation[];
};

const sessionState = new Map<string, SessionState>();
const WINDOW_MS = 30 * 60 * 1000;

export function detectDependencyLoop(record: ToolEventRecord): CoachingSignal[] {
  if (record.event_type !== 'command' && record.event_type !== 'tool_use') return [];

  const command = extractCommand(record);
  if (!command) return [];

  const categories = categorizeCommand(command);
  if (categories.size === 0) return [];

  const timestampMs = Date.parse(record.timestamp) || Date.now();
  const key = stateKey(record);
  const state = sessionState.get(key) ?? { observations: [] };

  state.observations = state.observations
    .filter((item) => timestampMs - item.timestampMs <= WINDOW_MS)
    .concat({ timestampMs, command, categories });
  sessionState.set(key, state);

  return buildSignals(state.observations, command, timestampMs);
}

function extractCommand(record: ToolEventRecord): string {
  const metadata = record.metadata ?? {};
  const command =
    metadata.command ??
    metadata.raw_command ??
    metadata.shell_command ??
    metadata.input ??
    metadata.description;
  return typeof command === 'string' ? command : '';
}

function stateKey(record: ToolEventRecord): string {
  return [
    record.tool,
    record.user_id || 'unknown-user',
    record.session_id || record.conversation_id || 'unknown-session',
    record.repo || record.cwd || 'unknown-repo'
  ].join('|');
}

function categorizeCommand(command: string): Set<CommandCategory> {
  const normalized = command.toLowerCase().replace(/\s+/g, ' ').trim();
  const categories = new Set<CommandCategory>();

  if (
    /\brm\s+(-[a-z]*r[a-z]*f|-rf|-fr)\s+.*node_modules\b/.test(normalized) ||
    /\brimraf\s+.*node_modules\b/.test(normalized) ||
    /\bdel\s+\/[sq]\s+.*node_modules\b/.test(normalized)
  ) {
    categories.add('delete_node_modules');
  }

  if (
    /\brm\s+(-[a-z]*f|-f)?\s+.*package-lock\.json\b/.test(normalized) ||
    /\bdel\s+.*package-lock\.json\b/.test(normalized) ||
    /\bunlink\s+.*package-lock\.json\b/.test(normalized)
  ) {
    categories.add('delete_package_lock');
  }

  if (/\bnpm\s+(install|i)\b/.test(normalized)) {
    categories.add('npm_install');
  }

  if (
    /\b(ps|pgrep|jobs|lsof)\b.*\b(npm|node|install)\b/.test(normalized) ||
    /\bwhile\s+.*\b(kill\s+-0|pgrep|ps)\b/.test(normalized) ||
    /\btail\s+(-f|--follow)\b/.test(normalized) ||
    /\bsleep\s+[0-5]\b.*\b(ps|pgrep|jobs|tail|npm)\b/.test(normalized)
  ) {
    categories.add('polling_check');
  }

  return categories;
}

function buildSignals(
  observations: CommandObservation[],
  currentCommand: string,
  currentTimestampMs: number
): CoachingSignal[] {
  const recent = observations;
  const npmInstallCount = count(recent, 'npm_install');
  const nodeModulesDeleteCount = count(recent, 'delete_node_modules');
  const lockfileDeleteCount = count(recent, 'delete_package_lock');
  const pollingCount = count(
    recent.filter((item) => currentTimestampMs - item.timestampMs <= 5 * 60 * 1000),
    'polling_check'
  );

  const signals: CoachingSignal[] = [];

  if (nodeModulesDeleteCount >= 2 && lockfileDeleteCount >= 2 && npmInstallCount >= 2) {
    signals.push({
      code: 'npm_dependency_reinstall_loop',
      severity: 'critical',
      message:
        'Repeated node_modules/package-lock deletion followed by npm install detected in the same tool session.',
      evidence: {
        window_minutes: 30,
        npm_install_count: npmInstallCount,
        node_modules_delete_count: nodeModulesDeleteCount,
        package_lock_delete_count: lockfileDeleteCount,
        current_command: currentCommand
      },
      recommendation:
        'Stop reinstalling dependencies. Inspect the first npm error, compare package manager/version, check package.json constraints, and try npm ci or targeted dependency updates instead.'
    });
  } else if (npmInstallCount >= 3) {
    signals.push({
      code: 'npm_install_retry_loop',
      severity: 'warning',
      message: 'Multiple npm install attempts detected in a short window.',
      evidence: {
        window_minutes: 30,
        npm_install_count: npmInstallCount,
        current_command: currentCommand
      },
      recommendation:
        'Avoid repeating npm install without changing the cause. Capture the install error once, summarize it, and choose a targeted remediation.'
    });
  }

  if (lockfileDeleteCount >= 3) {
    signals.push({
      code: 'package_lock_churn',
      severity: 'warning',
      message: 'Repeated package-lock.json deletion detected.',
      evidence: {
        window_minutes: 30,
        package_lock_delete_count: lockfileDeleteCount,
        current_command: currentCommand
      },
      recommendation:
        'Treat lockfile deletion as an explicit last resort. Prefer npm ci for reproducible installs or update the lockfile once after resolving package constraints.'
    });
  }

  if (pollingCount >= 5) {
    signals.push({
      code: 'excessive_command_polling',
      severity: 'warning',
      message: 'Frequent command-status polling detected while waiting for dependency work.',
      evidence: {
        window_minutes: 5,
        polling_check_count: pollingCount,
        current_command: currentCommand
      },
      recommendation:
        'Use a longer wait interval, stream the process output once, or wait for command completion instead of repeatedly asking the model to check process status.'
    });
  }

  return signals;
}

function count(observations: CommandObservation[], category: CommandCategory): number {
  return observations.filter((item) => item.categories.has(category)).length;
}
