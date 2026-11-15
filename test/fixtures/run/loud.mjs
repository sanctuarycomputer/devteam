// prints 2 MB from one test
import { test } from 'node:test';

test('is loud', () => {
  const line = `${'x'.repeat(1023)}\n`;
  for (let i = 0; i < 2048; i++) process.stdout.write(line);
});
