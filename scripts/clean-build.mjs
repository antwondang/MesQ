import { rm } from 'node:fs/promises';
import { URL } from 'node:url';
// Prevent old product pages and workers from remaining in a rebuilt installation.
await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
