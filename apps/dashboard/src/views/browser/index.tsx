// The browser view (browser.html 53-89): its markup, rendered at build time into the exported page, and
// Start, its one client component, which runs the page's script (view.ts) once the page is hydrated.
// A {' '} stands where browser.html has white space between two elements, so each element's text reads
// as it did (the confirm dialog's, for one).
import './browser.css';
import Start from './start';

export default function Browser() {
  return (
    <>
      <main data-view="browser">
        <form className="bar" id="go" autoComplete="off">
          <button type="button" className="btn" id="back" aria-label="Back" title="Back">←</button>{' '}
          <input id="addr" aria-label="Address" autoComplete="off" autoCapitalize="off" spellCheck={false} />{' '}
          <button type="button" className="btn danger" id="signout" disabled>Sign out of everything</button>
        </form>{' '}
        <p className="note" id="note" role="status"></p>{' '}
        <div className="area down" id="area">
          <canvas id="screen" className="empty" tabIndex={0} aria-label="The supervisor's browser"></canvas>{' '}
          <p className="waiting" id="waiting">Connecting to the supervisor&apos;s browser…</p>{' '}
          <div className="bye" id="bye" hidden>
            <div>
              <p className="why" id="bye-why"></p>{' '}
              <p className="sub">You can close this page.</p>{' '}
              <button type="button" className="btn" id="again">Show it again</button>
            </div>
          </div>
        </div>{' '}
        <div className="foot" id="footbar"><span id="foot"></span><span className="chip" id="chip">Connecting…</span></div>
      </main>{' '}
      <dialog id="confirm" aria-labelledby="confirm-text">
        <p id="confirm-text">Sign this project&apos;s browser out of every site? Every site it is signed into forgets it, and the browser starts again empty.</p>{' '}
        <div className="actions">
          <button type="button" className="btn" id="cancel">Cancel</button>{' '}
          <button type="button" className="btn danger" id="forget">Sign out of every site</button>
        </div>
      </dialog>{' '}
      <dialog id="ask" aria-labelledby="ask-from" aria-describedby="ask-said">
        <p className="from" id="ask-from" tabIndex={-1}></p>{' '}
        <p className="said" id="ask-said" dir="auto"></p>{' '}
        <input id="ask-text" aria-label="Your answer" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={10000} />{' '}
        <div className="actions">
          <button type="button" className="btn" id="ask-no"></button>{' '}
          <button type="button" className="btn" id="ask-yes"></button>
        </div>
      </dialog>
      <Start />
    </>
  );
}
