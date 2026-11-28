// kit-996: the Loop page of the dashboard's / route, ported from index.html (loop's lines: the css-loop,
// css-loop-tabs and css-loop-tables regions, the html-loop markup, and the script's renderOoda, Decide's words, the
// loop-tables block, and the learning and loop-place blocks, which are src/lib/loop-*.ts). A server module: its
// markup is exported once into the page, and the script writes into it, as index.html's does. Below, every function
// another view calls from it (APPS.md, The view stubs' exports), each a hoisted function that calls loop's module at
// call time. Loop's modules import other views, so call these from a function another view runs later, never at its
// top level.
import './loop.css';
import './wire';
import * as Ooda from './ooda';
import * as Tables from './tables';
import * as Learning from '../../lib/loop-learning';
import * as Place from '../../lib/loop-place';
import LoopClient from './client';

export default function View() {
  return (
    <>
      <section id="loop" data-page="loop">
        {/* ui-candidate: tabbar */}
        <div className="tabbar" role="tablist" id="loop-tabs">
          <button type="button" role="tab" data-tab="observe">Observe<span className="n" id="n-observe"></span></button>
          <button type="button" role="tab" data-tab="orient">Orient<span className="n" id="n-orient"></span></button>
          <button type="button" role="tab" data-tab="decide">Decide<span className="n" id="n-decide"></span></button>
          <button type="button" role="tab" data-tab="act">Act<span className="n" id="n-act"></span></button>
        </div>
        <div className="loop-panel" data-panel="observe">
          {/* ui-candidate: card */}
          <div className="card flush"><div className="card-head"><i className="icon-eye" aria-hidden="true"></i>Observations<span className="grow" id="c-observe"></span></div><div id="observations"></div></div>
        </div>
        <div className="loop-panel" data-panel="orient" hidden>
          <div className="card flush"><div className="card-head"><i className="icon-book-open" aria-hidden="true"></i>Knowledge<span className="grow" id="c-orient"></span></div><div id="knowledge"></div></div>
        </div>
        <div className="loop-panel" data-panel="decide" hidden>
          <div className="card flush"><div className="card-head"><i className="icon-scale" aria-hidden="true"></i>Decisions<span className="grow" id="c-decide"></span></div><div id="decisions-feed"></div></div>
        </div>
        <div className="loop-panel" data-panel="act" hidden>
          <div className="card flush"><div className="card-head"><i className="icon-zap" aria-hidden="true"></i>Acts<span className="grow" id="c-act"></span></div><div id="acts-feed"></div></div>
        </div>
      </section>
      <LoopClient />
    </>
  );
}

export function correctBtn(...a: Parameters<typeof Tables.correctBtn>): ReturnType<typeof Tables.correctBtn> {
  return Tables.correctBtn(...a);
}

export function decideRows(...a: Parameters<typeof Ooda.decideRows>): ReturnType<typeof Ooda.decideRows> {
  return Ooda.decideRows(...a);
}

export function fromWords(...a: Parameters<typeof Place.fromWords>): ReturnType<typeof Place.fromWords> {
  return Place.fromWords(...a);
}

export function lineageList(...a: Parameters<typeof Place.lineageList>): ReturnType<typeof Place.lineageList> {
  return Place.lineageList(...a);
}

export function lineChart(...a: Parameters<typeof Learning.lineChart>): ReturnType<typeof Learning.lineChart> {
  return Learning.lineChart(...a);
}

export function loopPlace(...a: Parameters<typeof Place.loopPlace>): ReturnType<typeof Place.loopPlace> {
  return Place.loopPlace(...a);
}

export function matchedWords(...a: Parameters<typeof Ooda.matchedWords>): ReturnType<typeof Ooda.matchedWords> {
  return Ooda.matchedWords(...a);
}

export function recordHref(...a: Parameters<typeof Place.recordHref>): ReturnType<typeof Place.recordHref> {
  return Place.recordHref(...a);
}

export function renderLoop(...a: Parameters<typeof Tables.renderLoop>): ReturnType<typeof Tables.renderLoop> {
  return Tables.renderLoop(...a);
}

export function renderOoda(...a: Parameters<typeof Ooda.renderOoda>): ReturnType<typeof Ooda.renderOoda> {
  return Ooda.renderOoda(...a);
}
