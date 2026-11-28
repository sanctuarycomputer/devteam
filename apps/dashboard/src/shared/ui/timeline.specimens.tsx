import type { Specimen } from '../../views/design-system/specimen';
import Timeline from './timeline';

export const specimens: Specimen[] = [
  { title: 'Default', note: 'each item\'s kind (q, act, msg, gate) is its class', render: () => <Timeline><li className="q"><time>Nov 26</time>Asked which release to cut</li><li className="act"><time>Nov 27</time>Released v0.107.0</li></Timeline> },
  { title: 'Commits', render: () => <Timeline><li><time>Nov 27</time>Merge kit-1040 <span className="muted">· reviewer · <code>a1f984fc0fc5</code></span></li></Timeline> },
];
