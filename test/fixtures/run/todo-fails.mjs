// a todo test that fails: its TAP says "not ok … # TODO", and node --test still exits 0
import { test } from 'node:test';

test('known broken', { todo: true }, () => { throw new Error('not yet'); });
