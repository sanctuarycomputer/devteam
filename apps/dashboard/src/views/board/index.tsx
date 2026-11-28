// kit-993: the Progress and Board pages of the dashboard's / route, ported from index.html (board's lines: the
// css-progress and css-board regions, the html-progress and html-board markup, and the script's Progress, Board and
// header-filter code). A server module: its markup is exported once into the page, and the script writes into it, as
// index.html's does. Below, every function another view calls from it (APPS.md, The view stubs' exports), and
// sevBadge and columnOf, which other views use though no stub exported them (spec S14): each a hoisted function that
// calls board's module at call time. Board's modules import other views, so call these from a function another view
// runs later, never at its top level.
import './board.css';
import * as Burnup from './burnup';
import * as Cards from './cards';
import * as Filters from './filters';
import * as Progress from './progress';
import * as Columns from '../../lib/board-columns';
import * as Filter from '../../lib/board-filter';
import BoardClient from './client';

export default function View() {
  return (
    <>
      <section id="progress" data-page="progress">
        <div className="g12">
          <div className="c8 pg-col">
            {/* ui-candidate: card */}
            <div className="card chart" id="burnup-card">
              {/* ui-candidate: card-head */}
              <div className="card-head"><i className="icon-chart-line" aria-hidden="true"></i><span className="grow">Burn-up</span><span className="end" id="forecast"></span></div>
              {/* ui-candidate: legend */}
              <div className="legend" id="legend"><span><i className="done"></i>done</span><span><i className="scope"></i>scope</span><span><i className="fc"></i>forecast</span><span className="dim">points: S = 1, M = 2</span></div>
              <div id="burnup"></div>
              <div className="tip" id="tip"></div>
            </div>
            {/* ui-candidate: card */}
            <div className="card"><div className="card-head"><i className="icon-book-open" aria-hidden="true"></i><span className="grow">Stories</span></div><div id="w-stories"></div></div>
          </div>
          <div className="c4 pg-col">
            {/* ui-candidate: card */}
            <div className="card"><div className="card-head"><i className="icon-layers" aria-hidden="true"></i><span className="grow">Features</span></div><div id="w-features"></div><div className="nogoal" id="w-nogoal"></div></div>
            {/* ui-candidate: card */}
            <div className="card"><div className="card-head"><i className="icon-tag" aria-hidden="true"></i><span className="grow">Releases</span></div><div id="w-releases"></div></div>
            {/* ui-candidate: card */}
            <div className="card"><div className="card-head"><i className="icon-waves" aria-hidden="true"></i><span className="grow">Waves</span></div><div id="w-waves"></div></div>
            {/* ui-candidate: card */}
            <div className="card"><div className="card-head"><i className="icon-chart-column" aria-hidden="true"></i><span className="grow">Points per week</span></div><div className="throughput" id="w-throughput"></div><div className="dim small" id="w-throughput-note" style={{ marginTop: '4px' }}></div></div>
          </div>
        </div>
      </section>
      <section id="board" data-page="board">
        <div id="planners" className="planners"></div>
        <div className="board" id="board-cols"></div>
      </section>
      <BoardClient />
    </>
  );
}

export function attLine(...a: Parameters<typeof Cards.attLine>): ReturnType<typeof Cards.attLine> {
  return Cards.attLine(...a);
}

export function boardCols(...a: Parameters<typeof Cards.boardCols>): ReturnType<typeof Cards.boardCols> {
  return Cards.boardCols(...a);
}

export function burnup(...a: Parameters<typeof Burnup.burnup>): ReturnType<typeof Burnup.burnup> {
  return Burnup.burnup(...a);
}

export function columnOf(...a: Parameters<typeof Columns.columnOf>): ReturnType<typeof Columns.columnOf> {
  return Columns.columnOf(...a);
}

export function drawFilterPage(...a: Parameters<typeof Filters.drawFilterPage>): ReturnType<typeof Filters.drawFilterPage> {
  return Filters.drawFilterPage(...a);
}

export function drawFilters(...a: Parameters<typeof Filters.drawFilters>): ReturnType<typeof Filters.drawFilters> {
  return Filters.drawFilters(...a);
}

export function filterHead(...a: Parameters<typeof Filters.filterHead>): ReturnType<typeof Filters.filterHead> {
  return Filters.filterHead(...a);
}

export function filtersNow(...a: Parameters<typeof Filters.filtersNow>): ReturnType<typeof Filters.filtersNow> {
  return Filters.filtersNow(...a);
}

export function filterTickets(...a: Parameters<typeof Progress.filterTickets>): ReturnType<typeof Progress.filterTickets> {
  return Progress.filterTickets(...a);
}

export function forecast(...a: Parameters<typeof Progress.forecast>): ReturnType<typeof Progress.forecast> {
  return Progress.forecast(...a);
}

export function meterRow(...a: Parameters<typeof Progress.meterRow>): ReturnType<typeof Progress.meterRow> {
  return Progress.meterRow(...a);
}

export function needsAttention(...a: Parameters<typeof Filter.needsAttention>): ReturnType<typeof Filter.needsAttention> {
  return Filter.needsAttention(...a);
}

export function pillsOf(...a: Parameters<typeof Cards.pillsOf>): ReturnType<typeof Cards.pillsOf> {
  return Cards.pillsOf(...a);
}

export function renderBoard(...a: Parameters<typeof Cards.renderBoard>): ReturnType<typeof Cards.renderBoard> {
  return Cards.renderBoard(...a);
}

export function renderProgress(...a: Parameters<typeof Progress.renderProgress>): ReturnType<typeof Progress.renderProgress> {
  return Progress.renderProgress(...a);
}

export function setFilters(...a: Parameters<typeof Filters.setFilters>): ReturnType<typeof Filters.setFilters> {
  return Filters.setFilters(...a);
}

export function sevBadge(...a: Parameters<typeof Cards.sevBadge>): ReturnType<typeof Cards.sevBadge> {
  return Cards.sevBadge(...a);
}
