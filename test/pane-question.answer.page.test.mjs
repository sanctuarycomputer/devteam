// The owner answers a pane's question from the dashboard's card: the dashboard page, in Chrome (split from
// test/pane-question.answer.test.mjs, kit-223, so each file stays inside CI's per-file watchdog).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrive, openChrome } from './lib/chrome.mjs';
import { hasTmux, threadsFixture, until } from './lib/kit.mjs';
import { acts, cleanup, dash, menuPane } from './lib/pane-question-fixture.mjs';

test("the dashboard page: the card at the top of the Inbox and in the dock, the terminal's words as text, at phone width; its buttons wait a second; a click answers; a dialog with no numbers has no buttons", { skip: !hasTmux ? 'no tmux' : canDrive ? false : 'no Chrome to drive' }, async (t) => {
  const F = threadsFixture('pane-page');
  const later = cleanup(t);
  later(() => F.done());
  const pane = menuPane(F, 'menu,trust,input');
  const D = await dash(later, F, pane);
  await D.question();
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
  await p.send('Page.navigate', { url: `${D.B}/#inbox` });
  const soon = async (expr, what) => until(() => p.ev(expr).catch(() => false), what);
  // drawn with its buttons off, so a card that swaps in under the pointer takes no click: on a second later
  await soon(`!!document.querySelector('#ask-inbox [data-ask-option]')`, 'the card in the Inbox');
  // #inbox opens the panel on its Inbox tab (kit-100): pressed only once it is at rest, so the click lands on the button
  await soon(`document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'the panel open, at rest');
  assert.equal(await p.ev(`document.querySelector('#ask-inbox [data-ask-option="1"]').disabled`), true, 'its buttons wait');
  await p.click('#ask-inbox [data-ask-option="1"]');
  await new Promise((w) => setTimeout(w, 300));
  assert.equal(pane.typed(), '', 'a click in that second answers nothing');
  await soon(`!!document.querySelector('#ask-inbox [data-ask-option]:not([disabled])')`, 'its buttons live');
  const card = await p.ev(`(() => { const c = document.querySelector('#ask-inbox .ask'); const r = c.getBoundingClientRect(); return { text: c.innerText, imgs: c.querySelectorAll('img').length, pwned: window.__pwned === 1, left: r.left, right: r.right, vw: innerWidth, page: document.documentElement.scrollWidth, buttons: [...c.querySelectorAll('[data-ask-option]')].map((b) => b.innerText.trim()), first: !c.parentElement.previousElementSibling && c.parentElement.nextElementSibling?.id === 'questions' }; })()`);
  assert.match(card.text, /The supervisor's terminal is asking/);
  assert.match(card.text, /Claude wants to read someone else's artifact at/);
  assert.match(card.text, /<img src=x onerror=window\.__pwned=1>/, "the terminal's words, as text");
  assert.deepEqual([card.imgs, card.pwned], [0, false], 'never markup');
  assert.deepEqual(card.buttons, ['1. Yes', '2. No']);
  assert.ok(card.first, 'above the questions');
  assert.ok(card.left >= 0 && card.right <= card.vw && card.page <= card.vw, `inside a phone's width: ${JSON.stringify(card)}`);
  // at the top of the Threads tab too, where the owner was talking (#inbox opened the panel on its Inbox tab, kit-100)
  await soon(`document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'the panel open, at rest');
  await p.click('#th-tabs [role="tab"][data-tab="threads"]');
  await soon(`!!document.querySelector('#ask-threads [data-ask-option]')`, 'the card in the Threads tab');
  await p.click('#th-close');
  await soon(`!document.body.classList.contains('threads-open')`, 'the panel closed');
  // the Inbox's card is answered on the Inbox tab, the panel open on it again from the button
  // the full-width panel leaves with a transition: hidden before the button under it is pressed
  await soon(`getComputedStyle(document.getElementById('threads')).visibility === 'hidden' && getComputedStyle(document.querySelector('.pagebar .tt')).visibility === 'visible'`, 'the panel hidden, the button shown');
  await p.click('.pagebar .tt');
  await soon(`location.hash.endsWith('th=inbox') && getComputedStyle(document.getElementById('threads')).transform === 'none' && !!document.querySelector('#ask-inbox [data-ask-option]:not([disabled])')`, 'the panel on its Inbox tab, at rest');
  await p.click('#ask-inbox [data-ask-option="1"]');
  await until(() => pane.typed() === '1', 'the digit in the terminal');
  await soon(`/Sent to the supervisor's terminal: 1\\. Yes/.test(document.getElementById('ask-inbox').innerText) || !!document.querySelector('#ask-inbox [data-ask-kind]')`, 'what was sent');
  assert.equal(acts(F)[0].channel, 'dashboard');
  // what comes next has no numbers: shown as the terminal has it, with nothing to click
  await soon(`!!document.querySelector('#ask-inbox [data-ask-kind="dialog"]')`, 'the dialog with no numbers');
  const d = await p.ev(`(() => { const c = document.querySelector('#ask-inbox .ask'); return { text: c.innerText, buttons: c.querySelectorAll('button').length }; })()`);
  assert.equal(d.buttons, 0);
  assert.match(d.text, /The supervisor's terminal needs you/);
  assert.match(d.text, /❯ Yes/);
  assert.match(d.text, /answer it in the terminal/);
  assert.equal(pane.typed(), '1');
});
