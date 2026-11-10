import { randomUUID } from 'node:crypto';
import { sampleGuides } from '../packages/shared/samples.js';
import type { AppConfig } from '../packages/shared/contracts.js';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const configResponse = await fetch(`${base}/api/config`);
if (!configResponse.ok) throw new Error('API unavailable');
const config = (await configResponse.json()) as AppConfig;
if (config.provider !== 'mock')
  throw new Error('Sample seeding is restricted to mock mode. Submit individual guides to test Gemini.');
for (const guide of sampleGuides) {
  const response = await fetch(`${base}/api/guides`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify(guide),
  });
  if (!response.ok) throw new Error(`Seeding failed: HTTP ${response.status}`);
}
console.log(`Submitted ${sampleGuides.length} synthetic guides.`);
