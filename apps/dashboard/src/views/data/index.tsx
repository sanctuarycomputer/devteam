// kit-989: the data view of the dashboard's / route, ported from index.html (data's lines: the router, the presses,
// the draw, the hold guard, the read and the Inbox counts, the viewer's data side, the hub's fleet ask). Data has no
// markup in index.html: the view renders DataClient, which boots it once. Below, every function another view calls
// from it (APPS.md, The view stubs' exports), each a hoisted function that calls data's module at call time, so a
// view in the shell's cycle may call it at its top level.
import * as Boot from './boot';
import * as Press from './press';
import * as Render from './render';
import * as Router from './router';
import * as Hold from '../../lib/data-hold';
import * as Inbox from '../../lib/data-inbox';
import DataClient from './client';

export default function View() {
  return <DataClient />;
}

export function answerPress(...a: Parameters<typeof Press.answerPress>): ReturnType<typeof Press.answerPress> {
  return Press.answerPress(...a);
}

export function cardFields(...a: Parameters<typeof Press.cardFields>): ReturnType<typeof Press.cardFields> {
  return Press.cardFields(...a);
}

export function drawOrHold(...a: Parameters<typeof Boot.drawOrHold>): ReturnType<typeof Boot.drawOrHold> {
  return Boot.drawOrHold(...a);
}

export function goHead(...a: Parameters<typeof Router.goHead>): ReturnType<typeof Router.goHead> {
  return Router.goHead(...a);
}

export function inboxCount(...a: Parameters<typeof Boot.inboxCount>): ReturnType<typeof Boot.inboxCount> {
  return Boot.inboxCount(...a);
}

export function inboxTitle(...a: Parameters<typeof Boot.inboxTitle>): ReturnType<typeof Boot.inboxTitle> {
  return Boot.inboxTitle(...a);
}

export function letGo(...a: Parameters<typeof Boot.letGo>): ReturnType<typeof Boot.letGo> {
  return Boot.letGo(...a);
}

export function load(...a: Parameters<typeof Boot.load>): ReturnType<typeof Boot.load> {
  return Boot.load(...a);
}

export function ownerLesson(...a: Parameters<typeof Inbox.ownerLesson>): ReturnType<typeof Inbox.ownerLesson> {
  return Inbox.ownerLesson(...a);
}

export function press(...a: Parameters<typeof Press.press>): ReturnType<typeof Press.press> {
  return Press.press(...a);
}

export function putBackCard(...a: Parameters<typeof Press.putBackCard>): ReturnType<typeof Press.putBackCard> {
  return Press.putBackCard(...a);
}

export function redrawNow(...a: Parameters<typeof Press.redrawNow>): ReturnType<typeof Press.redrawNow> {
  return Press.redrawNow(...a);
}

export function render(...a: Parameters<typeof Render.render>): ReturnType<typeof Render.render> {
  return Render.render(...a);
}

export function route(...a: Parameters<typeof Router.route>): ReturnType<typeof Router.route> {
  return Router.route(...a);
}

export function showHead(...a: Parameters<typeof Router.showHead>): ReturnType<typeof Router.showHead> {
  return Router.showHead(...a);
}

export function staleNote(...a: Parameters<typeof Boot.staleNote>): ReturnType<typeof Boot.staleNote> {
  return Boot.staleNote(...a);
}

export function typingIn(...a: Parameters<typeof Hold.typingIn>): ReturnType<typeof Hold.typingIn> {
  return Hold.typingIn(...a);
}
