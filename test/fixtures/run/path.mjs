// reports the PATH it was given, and nothing else (no lib/kit.mjs, which needs a PATH to find git)
import { test } from 'node:test';
import { put } from './out.mjs';

test('reports its PATH', () => { put('path.json', { PATH: process.env.PATH }); });
