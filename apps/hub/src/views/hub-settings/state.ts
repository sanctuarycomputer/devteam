// kit-1008 ruling 2: hub-settings' top-level state that another view of hub.html reads (compat-scan's
// cross-view state rule). The view's port reads and writes it here.
export const hubSettingsState = {
  // this device's push subscription, on a box, once notifications are on
  pushSub: null as PushSubscription | null,
  OA_ROLES: ['owner', 'admin', 'member'],
};
