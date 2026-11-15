// reports the PATH (and any TMUX, TMUX_PANE) it was given, and nothing else (no lib/kit.mjs, which needs a PATH to find git)
import { test } from 'node:test';
import { put } from './out.mjs';

test('reports its PATH', () => { put('path.json', { PATH: process.env.PATH, TMUX: process.env.TMUX, TMUX_PANE: process.env.TMUX_PANE }); });
