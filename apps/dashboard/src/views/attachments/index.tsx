// kit-1001: the attachments view of the dashboard's / route (upload, pills, previews), ported from index.html
// (attachments' lines: the css-attachments region and the script's attachments region, with the answered card's
// three helpers after it). It has no markup of its own: its boxes, pills and chips are strings other views write
// into theirs, and its image goes on the viewer's stage. The shell renders it, and words and data import its
// functions from client code; it renders AttachmentsClient, which registers the globals and the listeners. Below, every function another view calls from it (APPS.md, The view
// stubs' exports), each a hoisted function that calls attachments' module at call time. Attachments' modules
// import other views, so call these from a function another view runs later, never at its top level.
import './attachments.css';
import * as Files from '../../lib/attachments-files';
import * as Answers from './answers';
import * as Chips from './chips';
import * as Image from './image';
import * as Pills from './pills';
import AttachmentsClient from './client';
// `Loose` is `any`. Each export keeps its stub's call shape, any arguments (`...a: Loose[]`), as words spreads its
// own into them (APPS.md: the same call shape); it returns what the function returns.
type Loose = any;

export default function View() {
  return <AttachmentsClient />;
}

export function avUploadOff(...a: Loose[]): ReturnType<typeof Image.avUploadOff> {
  return (Image.avUploadOff as (...x: Loose[]) => ReturnType<typeof Image.avUploadOff>)(...a);
}

export function chipsHtml(...a: Loose[]): ReturnType<typeof Chips.chipsHtml> {
  return (Chips.chipsHtml as (...x: Loose[]) => ReturnType<typeof Chips.chipsHtml>)(...a);
}

export function drawPills(...a: Loose[]): ReturnType<typeof Pills.drawPills> {
  return (Pills.drawPills as (...x: Loose[]) => ReturnType<typeof Pills.drawPills>)(...a);
}

export function dropBox(...a: Loose[]): ReturnType<typeof Pills.dropBox> {
  return (Pills.dropBox as (...x: Loose[]) => ReturnType<typeof Pills.dropBox>)(...a);
}

export function filesWords(...a: Loose[]): ReturnType<typeof Files.filesWords> {
  return (Files.filesWords as (...x: Loose[]) => ReturnType<typeof Files.filesWords>)(...a);
}

export function isFilled(...a: Loose[]): ReturnType<typeof Files.isFilled> {
  return (Files.isFilled as (...x: Loose[]) => ReturnType<typeof Files.isFilled>)(...a);
}

export function markAnswered(...a: Loose[]): ReturnType<typeof Answers.markAnswered> {
  return (Answers.markAnswered as (...x: Loose[]) => ReturnType<typeof Answers.markAnswered>)(...a);
}

export function moveAttach(...a: Loose[]): ReturnType<typeof Pills.moveAttach> {
  return (Pills.moveAttach as (...x: Loose[]) => ReturnType<typeof Pills.moveAttach>)(...a);
}

export function putAttach(...a: Loose[]): ReturnType<typeof Pills.putAttach> {
  return (Pills.putAttach as (...x: Loose[]) => ReturnType<typeof Pills.putAttach>)(...a);
}

export function qcardOf(...a: Loose[]): ReturnType<typeof Answers.qcardOf> {
  return (Answers.qcardOf as (...x: Loose[]) => ReturnType<typeof Answers.qcardOf>)(...a);
}

export function seenHash(...a: Loose[]): ReturnType<typeof Answers.seenHash> {
  return (Answers.seenHash as (...x: Loose[]) => ReturnType<typeof Answers.seenHash>)(...a);
}

export function sendable(...a: Loose[]): ReturnType<typeof Pills.sendable> {
  return (Pills.sendable as (...x: Loose[]) => ReturnType<typeof Pills.sendable>)(...a);
}

export function takeAttach(...a: Loose[]): ReturnType<typeof Pills.takeAttach> {
  return (Pills.takeAttach as (...x: Loose[]) => ReturnType<typeof Pills.takeAttach>)(...a);
}
