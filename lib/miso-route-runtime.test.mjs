import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/server') {
      return nextResolve('next/server.js', context);
    }
    if (specifier.startsWith('@/')) {
      return nextResolve(
        new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href,
        context,
      );
    }
    return nextResolve(specifier, context);
  },
});

const workflowRoute = await import('../app/api/miso/route.ts');
const uploadRoute = await import('../app/api/miso/upload/route.ts');

test('long-running MISO routes use Node.js with a five-minute duration', () => {
  assert.equal(uploadRoute.runtime, 'nodejs');
  assert.equal(uploadRoute.maxDuration, 300);
  assert.equal(workflowRoute.runtime, 'nodejs');
  assert.equal(workflowRoute.maxDuration, 300);
});
