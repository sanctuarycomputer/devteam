// kit-989: which lessons wait on the owner (index.html:12389-12391), as index.html has it, with types. No imports
// and no DOM at import: compiled to lib-dist/lib/data-inbox.js.

// A lesson waits on you only when the supervisor sent it to you: it would change something you set.
// The rest are about how the agents work, and the supervisor's to keep (supervisor.md §4).
export function ownerLesson(k: { status?: string; for_owner?: unknown }): boolean { return k.status === 'candidate' && k.for_owner === true; }
