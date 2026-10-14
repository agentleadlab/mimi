// Text files teammates attach (Ads Manager CSV exports, notes) are read
// inline so Mimi can analyze them.
const TEXT_EXT = /\.(csv|tsv|txt|md|json)$/i;
const MAX_FILES = 3;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHARS = 60_000;

export function isTextAttachment(a) {
  const type = a.contentType?.split(";")[0] ?? "";
  return TEXT_EXT.test(a.name ?? "") || type.startsWith("text/") || type === "application/json";
}

/** Download text attachments and format them for the prompt. */
export async function readTextFiles(files) {
  const parts = [];
  for (const f of files.slice(0, MAX_FILES)) {
    try {
      if (f.size > MAX_BYTES) {
        parts.push(`[attached file: ${f.name} — too large to read (over 2 MB); ask for a filtered export]`);
        continue;
      }
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let text = await res.text();
      const cut = text.length > MAX_CHARS;
      if (cut) text = text.slice(0, MAX_CHARS);
      parts.push(`[attached file: ${f.name}]\n${text}${cut ? "\n[…file cut off here — it's long; ask for fewer columns or rows if needed]" : ""}`);
    } catch (err) {
      parts.push(`[attached file: ${f.name} — couldn't be read (${err.message})]`);
    }
  }
  return parts.join("\n\n");
}
