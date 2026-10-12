import fs from "node:fs";
const raw = fs
  .readFileSync(
    new URL("../design/coldwar-cards-v0.1.csv", import.meta.url),
    "utf8",
  )
  .replace(/^\uFEFF/, "");
const rows = [];
let row = [],
  field = "",
  quoted = false;
for (let i = 0; i < raw.length; i++) {
  const c = raw[i];
  if (c === '"') {
    if (quoted && raw[i + 1] === '"') {
      field += '"';
      i++;
    } else quoted = !quoted;
  } else if (c === "," && !quoted) {
    row.push(field);
    field = "";
  } else if (c === "\n" && !quoted) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
    row = [];
    field = "";
  } else field += c;
}
const headers = rows.shift();
const cards = rows
  .filter((r) => r.length === headers.length)
  .map((r) =>
    Object.fromEntries(
      headers.map((h, i) => [
        h,
        ["cost", "operation_cost", "attack", "defense"].includes(h)
          ? r[i] === ""
            ? null
            : Number(r[i])
          : ["fictional", "alternate_timeline"].includes(h)
            ? r[i] === "True"
            : r[i],
      ]),
    ),
  );
if (cards.length !== 80 || new Set(cards.map((c) => c.id)).size !== 80)
  throw Error("Expected 80 unique CSV cards");
const meta = JSON.parse(
  fs.readFileSync(
    new URL("../design/coldwar-cards-v0.1.json", import.meta.url),
  ),
);
fs.writeFileSync(
  new URL("../src/game/catalog.js", import.meta.url),
  "// Generated from design/coldwar-cards-v0.1.csv. Edit CSV, then npm run import.\nexport const cards = " +
    JSON.stringify(cards, null, 2) +
    ";\nexport const starterDecks = " +
    JSON.stringify(meta.starter_decks) +
    ";\nexport const tokens = " +
    JSON.stringify(meta.tokens) +
    ";\nexport const catalog = Object.fromEntries([...cards,...tokens].map(c=>[c.id,c]));\n",
);
console.log("Imported 80 cards from CSV.");
