// The /view/canvas/ route: the canvas, served at /view/canvas/<slug>. It renders its root view.
import Canvas from '../../../views/canvas';

// No metadata title: Next's streamed metadata would set the title again after the page's script set
// it (the slug's); the view renders its own <title>, which React hoists into <head> and never re-renders.
export const metadata = { title: null };

export default function Page() {
  return <Canvas />;
}
