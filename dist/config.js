import 'dotenv/config';
import 'dotenv/config';
export const config = {
    port: Number(process.env.PORT ?? 8787),
    logDir: process.env.LOG_DIR ?? './logs',
    logRawContent: process.env.LOG_RAW_CONTENT === 'true',
    maxLoggedChars: Number(process.env.MAX_LOGGED_CHARS ?? 12_000),
    proxySharedSecret: process.env.PROXY_SHARED_SECRET || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    anthropicVersion: process.env.ANTHROPIC_VERSION || '2023-06-01'
};
