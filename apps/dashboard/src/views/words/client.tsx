'use client';
// kit-990: words's client code (spec, The view). Its top level runs once when its chunk loads in the browser and
// registers words's 5 COMPAT globals, each the lib's own function: window.when shadows EventTarget.prototype.when,
// which the window only inherits. expose() registers nothing on the server. WordsClient renders nothing: words has
// no markup of its own in index.html.
import { expose } from '../../shared/compat';
import * as W from '../../lib/words-plain';
import './wire';

expose('artNameLink', W.artNameLink);
expose('norm', W.norm);
expose('questionCard', W.questionCard);
expose('when', W.when);
expose('words', W.words);

export default function WordsClient(): null {
  return null;
}
