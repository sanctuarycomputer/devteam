// kit-1008 ruling 2: hub-overview's top-level state that another view of hub.html reads (compat-scan's
// cross-view state rule). The view's port reads and writes it here.
export const hubOverviewState = {
  HUB_VIEWS: ['overview', 'terminal', 'settings'],
};
