// kit-1001: attachments' file helpers (index.html's attachments lines): the limit and its words, a file's icon,
// size, served URL and kind, the words files sent alone are recorded with, and whether a drag carries files. As
// index.html has them, with types and exports. No imports and no DOM at import: compiled to
// lib-dist/lib/attachments-files.js.
// `Loose` is `any`: a file row and a drag event as the page passes them, untyped there.
type Loose = any;

export const FILES_MAX = 10;
export const fileIcon = (name: Loose) => (/\.(png|jpe?g|gif|webp)$/i.test(String(name)) ? 'icon-image' : /\.(pdf|txt|md)$/i.test(String(name)) ? 'icon-file-text' : 'icon-file');
export const fileSize = (n: Loose) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);
export const ATT_TOO_MANY = `At most ${FILES_MAX} files go with one message`;
export const ATT_CUT = "The upload was cut off: the file may be over this machine's limit, or the dashboard stopped.";
// Files sent alone: the words the server records for them (devteam.mjs's answer and thread commands), which a
// pending turn carries too, so it lands on the server's turn once.
export const filesWords = (n: Loose) => (n === 1 ? '1 file dropped' : `${n} files dropped`);
export const hasFiles = (e: Loose) => [...(e.dataTransfer?.types || [])].includes('Files');
// The chips (spec §6): each file sent, under a turn's words and under an answer. A stored file is served back at
// /upload/<folder>/<name>, its path's last two segments; a path with fewer has no link (the name and size only).
export const fileUrl = (path: Loose) => {
  const s = String(path ?? '').split('/').filter(Boolean);
  return s.length >= 2 ? `/upload/${s.slice(-2).map(encodeURIComponent).join('/')}` : null;
};
// the four the server serves as images (devteam.mjs UPLOAD_IMAGES, matched as it matches them); any other downloads
export const isImageName = (n: Loose) => /\.(png|jpg|gif|webp)$/.test(String(n ?? ''));
// Files sent alone are recorded with the words filesWords gives (§4): a turn or an answer whose words are exactly
// those, for that many files, shows its chips and not the words.
export const isFilled = (text: Loose, files: Loose) => Array.isArray(files) && files.length > 0 && text === filesWords(files.length);
