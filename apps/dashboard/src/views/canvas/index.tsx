// The canvas, the root view of the /view/canvas/ route (kit-1013): canvas.html's markup (238-286) and its
// CSS (core/canvas.css, its lines 11-234 byte for byte), prerendered; the script's part this ticket ports
// lives in core/ and runs from <Mount/>, the one client component, once per page load. The view renders
// once and holds no React state or props: after mount() the script owns the DOM (render-once invariant).
// Each other section of the page is a module of its own (panels, sync, editing, history, presence),
// a stub until its port.
import './core/canvas.css';
import Mount from './core/mount-client';
import * as page from './core/page';
import * as checkers from './core/checkers';
import * as nodes from './core/nodes';
import * as drawing from './core/drawing';
import * as begin from './core/start';

export default function Canvas() {
  return (
    <>
      <title>Canvas</title>
      <header className="bar">
        <a className="back" href="/#library">&larr; Library</a>
        <h1 id="title"></h1>
        <span className="where">canvas</span>
        <span className="grow"></span>
        <span className="chip" id="repoChip" hidden></span>
      </header>
      <main className="work" data-view="canvas">
        <aside className="panel left">
          <div className="phead">
            <h2 className="ptitle">Pages</h2>
            <button type="button" id="pageAdd" aria-label="Add page" hidden>+</button>
          </div>
          <nav className="pages" id="pages" aria-label="Pages"></nav>
          <h2 className="ptitle">Layers</h2>
          <div className="layers" id="layers" role="tree" aria-label="Layers"></div>
        </aside>
        <section className="stage" id="stage" aria-label="Canvas">
          <div id="surface"></div>
          <div className="stage-top">
            <select id="pageSel" aria-label="Page"></select>
            <p id="narrowNote">Watching: editing needs a wider screen.</p>
            <p id="capNote" role="status" hidden>Some components weren&apos;t drawn: this page holds too many.</p>
          </div>
          <div className="zoom">
            <button id="zoomOut" type="button" aria-label="Zoom out">&minus;</button>
            <span className="pct" id="zoomPct">100%</span>
            <button id="zoomIn" type="button" aria-label="Zoom in">+</button>
            <button id="zoomFit" type="button">Fit</button>
          </div>
          <p id="msg" role="status" hidden></p>
          <div className="say">
            <p id="banner" role="status" hidden></p>
            <p id="toast" role="status" hidden></p>
          </div>
          <div className="tools" id="tools" role="toolbar" aria-label="Tools" hidden>
            <button type="button" data-tool="move" aria-pressed="true" aria-label="Move" title="Move (V)"><span className="tn">Move</span> <kbd>V</kbd></button>
            <button type="button" data-tool="frame" aria-pressed="false" aria-label="Frame" title="Frame (F)"><span className="tn">Frame</span> <kbd>F</kbd></button>
            <button type="button" data-tool="text" aria-pressed="false" aria-label="Text" title="Text (T)"><span className="tn">Text</span> <kbd>T</kbd></button>
            <button type="button" data-tool="rect" aria-pressed="false" aria-label="Rectangle" title="Rectangle (R)"><span className="tn">Rectangle</span> <kbd>R</kbd></button>
            <button type="button" data-tool="ellipse" aria-pressed="false" aria-label="Ellipse" title="Ellipse (O)"><span className="tn">Ellipse</span> <kbd>O</kbd></button>
            <button type="button" data-tool="vector" aria-pressed="false" aria-label="Vector" title="Vector (P)"><span className="tn">Vector</span> <kbd>P</kbd></button>
            <button type="button" data-tool="image" aria-pressed="false" aria-label="Image" title="Image (I)"><span className="tn">Image</span> <kbd>I</kbd></button>
          </div>
          <div className="pinbar" id="pinBar" hidden><button type="button" id="pinTool" aria-pressed="false" title="Comment (C)">Comment <kbd>C</kbd></button></div>
          <input type="file" id="imageFile" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Image file" hidden />
        </section>
        <aside className="panel right">
          <h2 className="ptitle">Properties</h2>
          <div className="props" id="props"><p className="note">Select a layer to see what it is.</p></div>
        </aside>
      </main>
      <Mount />
    </>
  );
}

// ---- called by other views (APPS.md, The view stubs: canvas), and start (ruling D4) ----
export const $ = page.$;
export const clamp = checkers.clamp;
export const color = checkers.color;
export const drawPage = drawing.drawPage;
export const fail = page.fail;
export const finite = checkers.finite;
export const font = checkers.font;
export const fontWords = checkers.fontWords;
export const frameOk = page.frameOk;
export const getPath = nodes.getPath;
export const hideMsg = page.hideMsg;
export const imageFile = checkers.imageFile;
export const imagesSettled = page.imagesSettled;
export const isObj = page.isObj;
export const isRef = checkers.isRef;
export const kidsOf = nodes.kidsOf;
export const layout = drawing.layout;
export const mark = drawing.mark;
export const nodeOf = nodes.nodeOf;
export const own = page.own;
export const pageById = page.pageById;
export const pageName = page.pageName;
export const pages = page.pages;
export const pathOk = checkers.pathOk;
export const pick = checkers.pick;
export const ref = checkers.ref;
export const renderPages = page.renderPages;
export const renderPageSel = page.renderPageSel;
export const setState = page.setState;
export const showMsg = page.showMsg;
export const showRepo = page.showRepo;
export const size = drawing.size;
export const token = checkers.token;
export const start = begin.start;
