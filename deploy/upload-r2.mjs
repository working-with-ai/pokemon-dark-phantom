import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import resources from '../worker/resources.json' with { type: 'json' };

for (const resource of Object.values(resources)) {
  let info;
  try {
    info = await stat(resource.file);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(JSON.stringify({ event: 'resource_local_missing', file: resource.file }));
      continue;
    }
    throw error;
  }
  const hash = createHash('sha256').update(await readFile(resource.file)).digest('hex');
  if (info.size !== resource.size || hash !== resource.sha256) {
    throw new Error(`Resource integrity check failed: ${resource.file}`);
  }
  const result = spawnSync('node_modules/.bin/cf', [
    'r2', 'buckets', 'objects', 'upload', resource.key,
    '--bucket-name', 'pokemon-dark-phantom-resources',
    '--file', resource.file,
    '--content-type', resource.contentType,
    '--content-length', String(resource.size)
  ], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`R2 upload failed: ${resource.key}`);
}
