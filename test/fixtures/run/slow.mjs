// passes after 6 s
import { test } from 'node:test';

test('is slow', async () => { await new Promise((r) => setTimeout(r, 6000)); });
