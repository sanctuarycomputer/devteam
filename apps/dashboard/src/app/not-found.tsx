// Next's built-in not-found page writes an inline <style> and style="" attributes, which the browser
// view's style-src 'self' refuses. This one has neither.
export default function NotFound() {
  return <p>Not found.</p>;
}
