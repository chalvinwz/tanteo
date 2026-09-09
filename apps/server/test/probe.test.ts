import { describe, expect, it } from 'vitest';

import { createWriteToken, deriveReadToken } from '@tanteo/share';

import { createApp } from '../src/app.js';
import { createBus } from '../src/bus.js';
import { createMemoryStore } from '../src/store.js';

describe('probe', () => {
  it('probes', async () => {
    const app = createApp({ store: createMemoryStore(), bus: createBus(), now: () => 1000 });
    const w = createWriteToken();
    const r = await deriveReadToken(w);
    console.log('write', w, w.length);
    console.log('read', r, r.length);

    for (const p of [
      '/api/t/..%2F..%2Fetc%2Fpasswd',
      '/api/t/' + encodeURIComponent('../../etc/passwd'),
      '/api/t/..a' + 'b'.repeat(20),
      '/api/t/../../etc/passwd',
      '/api/t/short',
    ]) {
      const res = await app.request(p, { method: 'POST', body: '{}' });
      console.log('POST', p, res.status, await res.text());
    }

    const cl = await app.request(`/api/t/${r}`, {
      method: 'POST',
      headers: { 'x-tanteo-write-token': w, 'content-length': '999999' },
      body: '{"a":1}',
    });
    console.log('content-length declared ->', cl.status, await cl.text());

    const noCl = await app.request(`/api/t/${r}`, {
      method: 'POST',
      headers: { 'x-tanteo-write-token': w },
      body: '{"a":1}',
    });
    console.log('plain post ->', noCl.status, await noCl.text());

    const g = await app.request(`/api/t/${r}`);
    console.log('get ->', g.status, JSON.stringify([...g.headers]), await g.text());

    // SSE
    const controller = new AbortController();
    const sse = await app.request(`/api/t/${r}/stream`, { signal: controller.signal });
    console.log('sse ->', sse.status, sse.headers.get('content-type'), !!sse.body);
    const reader = sse.body!.getReader();
    const first = await Promise.race([
      reader.read(),
      new Promise((res) => setTimeout(() => res('TIMEOUT'), 500)),
    ]);
    console.log('first chunk ->', JSON.stringify(first && typeof first === 'object' && 'value' in (first as object) ? new TextDecoder().decode((first as ReadableStreamReadResult<Uint8Array>).value) : first));
    controller.abort();
    await reader.cancel().catch(() => undefined);
    expect(true).toBe(true);
  });
});
