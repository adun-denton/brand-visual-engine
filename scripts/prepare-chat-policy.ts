// Coordinator utility: prepare reviewed policy bytes, never log in or send a turn.
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { assertOutsideGit, ensurePrivateDirectory, writePrivateJson } from '../src/service/private-storage.ts';
const dir = process.argv[2];
if (!dir || !isAbsolute(dir)) throw Error('Supply an absolute private directory outside Git');
const policy: unknown = JSON.parse(readFileSync(0, 'utf8'));
assertOutsideGit(join(dir, 'trial-policy.json'));
ensurePrivateDirectory(dir);
writePrivateJson(join(dir, 'trial-policy.json'), policy);
console.log('Reviewed policy stored with private permissions. No login or model call performed.');
