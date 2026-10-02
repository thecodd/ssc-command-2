const fs=require("fs"),path=require("path");
const files=[];(function w(d){for(const f of fs.readdirSync(d)){if(["node_modules",".next",".git"].includes(f))continue;const p=path.join(d,f);fs.statSync(p).isDirectory()?w(p):/\.tsx?$/.test(f)&&files.push(p)}})(".");
const src=Object.fromEntries(files.map(f=>[f,fs.readFileSync(f,"utf8")]));
const resolve=(from,spec)=>{let b=spec.startsWith("@/")?spec.slice(2):path.join(path.dirname(from),spec);for(const c of [b+".ts",b+".tsx",b+"/index.ts",b+"/index.tsx",b])if(src[path.normalize(c)]!==undefined)return path.normalize(c);return null};
let problems=0;const P=(m)=>{problems++;console.log("PROBLEM:",m)};
// 1 import/export audit
for(const f of files){const re=/import\s+(?:type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:\*\s+as\s+\w+)?\s*from\s*["']([^"']+)["']/g;let m;while(m=re.exec(src[f])){const spec=m[3];if(!spec.startsWith("@/")&&!spec.startsWith("."))continue;const t=resolve(f,spec);if(!t){P(`${f}: unresolved ${spec}`);continue}
 const ts=src[t];if(m[1]&&!/export default/.test(ts))P(`${f}: default import from ${t} which has no default export`);
 if(m[2])for(let n of m[2].split(",")){n=n.trim().replace(/^type\s+/,"").split(/\s+as\s+/)[0].trim();if(!n)continue;if(!new RegExp(`export\\s+(?:async\\s+)?(?:function\\*?|const|let|class|interface|type|enum)\\s+${n}\\b|export\\s*\\{[^}]*\\b${n}\\b[^}]*\\}|export\\s+type\\s*\\{[^}]*\\b${n}\\b`).test(ts))P(`${f}: '${n}' not exported by ${t}`)}}}
// 2 boundary audit: "use client" files must not import server-only modules
const serverOnly=/^(services\/|lib\/auth|lib\/supabase\/server|app\/actions\/(?!.*$))/;
for(const f of files){const s=src[f];const client=/^\s*["']use client["']/.test(s);const re=/from\s*["']([^"']+)["']/g;let m;while(m=re.exec(s)){const spec=m[1];if(!spec.startsWith("@/"))continue;const t=spec.slice(2);
 if(client&&(/^services\//.test(t)||/^lib\/auth/.test(t)||/supabase\/server/.test(t))&&!/^import type/.test(s.slice(s.lastIndexOf("\n",m.index)+1,m.index+6))){ // allow type-only
   const line=s.slice(s.lastIndexOf("\n",m.index)+1,s.indexOf("\n",m.index));if(!/^import type/.test(line.trim()))P(`client ${f} imports server module ${t}`)}
 if(/^tests\//.test(t)&&!/^tests\//.test(f)&&!/dev\/study-preview/.test(f)&&!/^tests\//.test(f))P(`production file ${f} imports ${t}`);}
 if(/^services\/|^lib\/auth/.test(f)&&client)P(`${f} is both service and client`);}
// server actions files must start with "use server"
for(const f of files.filter(f=>f.startsWith("app/actions/")))if(!/^\s*["']use server["']/.test(src[f]))P(`${f} lacks "use server"`);
// non-async exports in "use server" files
for(const f of files.filter(f=>/^\s*["']use server["']/.test(src[f])))for(const m of src[f].matchAll(/export\s+(const|let|class)\s+(\w+)/g))P(`${f}: "use server" file exports non-function ${m[2]}`);
// 3 route audit
const routes=files.filter(f=>/\/page\.tsx$/.test(f)).map(f=>"/"+f.replace(/^app\//,"").replace(/\/page\.tsx$/,"").split("/").filter(s=>!/^\(.*\)$/.test(s)).join("/"));
const seen={};for(const r of routes){seen[r]=(seen[r]||0)+1}for(const [r,n] of Object.entries(seen))if(n>1)P(`duplicate route ${r}`);
console.log("routes with study/revision:",routes.filter(r=>/study|revision/.test(r)));
// 4 hygiene
for(const f of files){const s=src[f];if(/\b(TODO|FIXME|XXX|HACK)\b/.test(s))P(`${f}: TODO/FIXME`);}
// 5 fake-data scan: hard-coded numbers/words outside tests/fixtures
const FIXTURE_AWARE=new Set(["app/(focus)/dev/study-preview/page.dev.tsx","components/study/FixtureBanner.tsx","components/study/NotesSheet.tsx","components/study/StudyProvider.tsx","components/study/StudyScreen.tsx","components/practice/PracticeRunner.tsx","components/practice/PracticeConfig.tsx","app/(focus)/dev/revision-preview/page.dev.tsx","components/revision/ReviewRunner.tsx","components/revision/RevisionApiContext.ts","components/practice/PracticeApiContext.ts"]);   // the intentional `api.mode === "fixture"` switch + banner
for(const f of files.filter(f=>/^(components\/(study|practice)|services|app\/\(focus\)|app\/\(app\)\/(study|revision))/.test(f)&&!FIXTURE_AWARE.has(f))){if(/Fixture|lorem|dummy|mock/i.test(src[f].replace(/\/\/.*$/gm,"")))P(`${f}: fixture/mock wording in production code`);}
// 6 broken-link scan: static hrefs
const hrefs=new Set();for(const f of files){for(const m of src[f].matchAll(/href=\{?["'`](\/[^"'`$?#{]*)/g))hrefs.add(m[1]);}
const matches=(h)=>routes.some(r=>new RegExp("^"+r.replace(/\[\.\.\.\w+\]/g,".*").replace(/\[\w+\]/g,"[^/]+")+"$").test(h))||h==="/";
for(const h of hrefs)if(!matches(h.replace(/\/$/,"")||"/"))console.log("link w/o dedicated page (falls to catch-all placeholder?):",h);
console.log(problems?`${problems} problems`:"audit clean");
