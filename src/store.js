import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

// Small JSON key-value store for state that must survive restarts.
const file = path.join(config.dataDir, "mimi-state.json");

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function getState(key) {
  return readAll()[key];
}

export function setState(key, value) {
  const all = readAll();
  if (value === undefined) delete all[key];
  else all[key] = value;
  fs.mkdirSync(config.dataDir, { recursive: true });
  // Write then rename, so a crash mid-write can't corrupt the file.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
