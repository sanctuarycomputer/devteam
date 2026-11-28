// kit-999: the review view of the dashboard's / route, mounted by the shell (spec, The view). It renders
// index.html's html-review section (1509-1517; the shell renders the three closing tags after it), filled later by
// the lib's innerHTML writes as the shell's other regions are, and <ReviewClient />. Below are the 13 functions
// other views call from it (APPS.md), each delegating to review-page's binding of the same name with its args whole.
import './review.css';
import './wire';
import * as P from '../../lib/review-page';
import ReviewClient from './client';

export default function View() {
  return (
    <>
      <section id="review-view" className="no-shell" hidden>
        <div id="rv-head"></div>
        <div id="rv-link" className="banner stale rv-link" role="alert" hidden></div>
        <div id="rv-frame-wrap"></div>
        <div className="rv-panel" id="rv-panel" hidden>
          <div id="rv-preview" aria-live="polite"></div>
          <div id="rv-actions"></div>
        </div>
      </section>
      <ReviewClient />
    </>
  );
}

export function closeReview(...a: Parameters<typeof P.closeReview>): ReturnType<typeof P.closeReview> {
  return P.closeReview(...a);
}

export function emptyVal(...a: Parameters<typeof P.emptyVal>): ReturnType<typeof P.emptyVal> {
  return P.emptyVal(...a);
}

export function fleetMoveReady(...a: Parameters<typeof P.fleetMoveReady>): ReturnType<typeof P.fleetMoveReady> {
  return P.fleetMoveReady(...a);
}

export function holdState(...a: Parameters<typeof P.holdState>): ReturnType<typeof P.holdState> {
  return P.holdState(...a);
}

export function lsDel(...a: Parameters<typeof P.lsDel>): ReturnType<typeof P.lsDel> {
  return P.lsDel(...a);
}

export function lsGet(...a: Parameters<typeof P.lsGet>): ReturnType<typeof P.lsGet> {
  return P.lsGet(...a);
}

export function lsSet(...a: Parameters<typeof P.lsSet>): ReturnType<typeof P.lsSet> {
  return P.lsSet(...a);
}

export function openReview(...a: Parameters<typeof P.openReview>): ReturnType<typeof P.openReview> {
  return P.openReview(...a);
}

export function renderReviewPreview(...a: Parameters<typeof P.renderReviewPreview>): ReturnType<typeof P.renderReviewPreview> {
  return P.renderReviewPreview(...a);
}

export function reviewAnswer(...a: Parameters<typeof P.reviewAnswer>): ReturnType<typeof P.reviewAnswer> {
  return P.reviewAnswer(...a);
}

export function reviewCard(...a: Parameters<typeof P.reviewCard>): ReturnType<typeof P.reviewCard> {
  return P.reviewCard(...a);
}

export function reviewDecline(...a: Parameters<typeof P.reviewDecline>): ReturnType<typeof P.reviewDecline> {
  return P.reviewDecline(...a);
}

export function sitesKey(...a: Parameters<typeof P.sitesKey>): ReturnType<typeof P.sitesKey> {
  return P.sitesKey(...a);
}
