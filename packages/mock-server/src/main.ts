import { loadConfig } from './config';
import { buildServer } from './server';

const config = loadConfig(process.env);
const app = await buildServer(config);
await app.listen({ port: config.port, host: '0.0.0.0' });

const base = `http://localhost:${config.port}`;
console.log(`Mock API listening on ${base}`);
console.log(`  API keys: ${config.apiKeys.length} configured, token TTL ${config.jwtTtlSec}s`);
console.log(
  config.chaos
    ? `  Chaos: on (${config.delayMinMs}-${config.delayMaxMs}ms delay, ${Math.round(config.failureRate * 100)}% 503s${config.seed === undefined ? '' : `, seed ${config.seed}`})`
    : '  Chaos: off',
);
console.log('  Change a claim status:');
console.log(
  `    curl -X PATCH ${base}/__mock/claims/CLM-0001/status -H 'content-type: application/json' -d '{"status":"DOCUMENTS_VERIFIED"}'`,
);
