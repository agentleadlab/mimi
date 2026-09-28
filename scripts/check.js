// Sanity-check the Anthropic side without Discord: sends Mimi one message.
import { askMimi } from "../src/mimi.js";

const prompt = process.argv.slice(2).join(" ") || "Hey Mimi!";
console.log(`> ${prompt}\n`);
console.log(await askMimi([{ role: "user", content: [{ type: "text", text: `Tester: ${prompt}` }] }]));
