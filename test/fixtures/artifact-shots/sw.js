self.addEventListener('install', (e) => { e.waitUntil(fetch('__OTHER__/sw', { mode: 'no-cors' }).catch(() => {})); });
