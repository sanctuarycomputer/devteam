// every test passes, and the process still exits non-zero
import { test } from 'node:test';

test('passes', () => {});
process.exitCode = 3;
