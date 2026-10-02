const fs = require("fs"), path = require("path");
const { html } = require("./dist/ssr.js");
for (const s of ["study", "study-weak", "review"]) {
  fs.writeFileSync(path.join(__dirname, "dist", s + ".html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${s}</title></head><body><div id="root">${html(s)}</div><script>window.__SCEN__=${JSON.stringify(s)}</script><script src="client.js"></script></body></html>`);
}
console.log("generated 3 SSR pages");
