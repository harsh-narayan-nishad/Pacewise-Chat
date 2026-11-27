import { chatApi } from "@/lib/chat";
import { decryptFile, type FileMeta } from "@/lib/crypto";

/** Attachments: any file type, up to 25 MB, encrypted in the browser before it is uploaded. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Images shown inline (SVG is not: it can carry scripts). */
export const isImage = (type: string) => /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(type);

export function sizeLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** "PDF", "DOCX", "ZIP" … from the file name (or its type). */
export function kindLabel(name: string, type: string): string {
  const ext = name.includes(".") ? name.split(".").pop()! : type.split("/").pop() ?? "file";
  return ext.slice(0, 6).toUpperCase();
}

/** What a chat list / notification says for a message with a file. */
export const isAudio = (type: string) => /^audio\//i.test(type);
/** Videos that browsers play inline. */
export const isVideo = (type: string) => /^video\/(mp4|webm|ogg|quicktime)$/i.test(type);
/** A document's badge colour by kind, as in Files/Finder: PDF red, Word blue, Excel green, slides orange, archives grey. */
export function kindColor(name: string, type: string): string {
  const k = kindLabel(name, type).toLowerCase();
  if (k === "pdf") return "#E5484D";
  if (/^(doc|docx|rtf|odt|pages|txt|md)$/.test(k)) return "#2F6FED";
  if (/^(xls|xlsx|csv|ods|number|numbers)$/.test(k)) return "#1E9E5A";
  if (/^(ppt|pptx|odp|key)$/.test(k)) return "#F0782C";
  if (/^(zip|rar|7z|tar|gz)$/.test(k)) return "#7A7F87";
  return "#6E56CF";
}
export const fileLabel = (f: { name: string; type: string }) => (isImage(f.type) ? "📷 Photo" : isAudio(f.type) ? "🎤 Voice message" : isVideo(f.type) ? "🎥 Video" : `📎 ${f.name}`);

/** Downloaded and decrypted files, as local addresses (blob URLs), kept while the page is open. */
const cache = new Map<string, Promise<string>>();
export function fileUrl(conversationId: string, f: FileMeta): Promise<string> {
  let p = cache.get(f.id);
  if (!p) {
    p = (async () => {
      const sealed = await chatApi.downloadFile(conversationId, f.id);
      const plain = await decryptFile(sealed, f.key, f.iv);
      return URL.createObjectURL(new Blob([plain], { type: f.type || "application/octet-stream" }));
    })();
    p.catch(() => cache.delete(f.id));
    cache.set(f.id, p);
  }
  return p;
}

/** Saves a decrypted file to the device under its own name. */
export async function saveFile(conversationId: string, f: FileMeta): Promise<void> {
  const href = await fileUrl(conversationId, f);
  const a = document.createElement("a");
  a.href = href;
  a.download = f.name || "file";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
