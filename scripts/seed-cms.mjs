import fs from "node:fs";
import { defaultContent } from "../src/content/defaults.js";
import { validateContent } from "../src/content/schema.js";
const data = JSON.stringify(validateContent(defaultContent)).replaceAll(
  "'",
  "''",
);
fs.writeFileSync(
  "migrations/0002_seed_content.sql",
  `-- Initial content only. Later deploys do not overwrite CMS edits.\nINSERT INTO cms_content (id,data,change_note) VALUES (1,'${data}','初始化：80张卡牌、3个衍生单位、2个阵营、2套入门牌组、2套AI策略');\n`,
);
