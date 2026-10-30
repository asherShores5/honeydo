// Contact sheet of tour screenshots: npx tsx sheet.ts <phone|desktop|dark> <columns> <width px>
import { chromium } from "playwright";
import { readdirSync, readFileSync } from "node:fs";
const [mode, cols, w] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
const files = readdirSync("/tmp/e2e").filter((f) => f.startsWith(`tour-${mode}-`)).sort();
const html = `<body style="margin:0;background:#888;display:grid;grid-template-columns:repeat(${cols},${w}px);gap:6px;font:12px sans-serif">` +
  files.map((f) => `<div><div style="background:#000;color:#fff">${f.replace(`tour-${mode}-`, "")}</div><img style="width:${w}px" src="data:image/png;base64,${readFileSync("/tmp/e2e/" + f).toString("base64")}"></div>`).join("") + "</body>";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: cols * (w + 6), height: 400 } });
await p.setContent(html); await p.screenshot({ path: `/tmp/e2e/sheet-${mode}.png`, fullPage: true }); await b.close();
