const fs=require("fs"),path=require("path");const dir=require("path").join(__dirname,"..","migrations");
const tables={};
const strip=s=>s.replace(/--.*$/gm,"");
for(const f of fs.readdirSync(dir).sort()){const s=strip(fs.readFileSync(path.join(dir,f),"utf8"));
 for(const m of s.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(/gi)){let i=m.index+m[0].length,d=1,j=i;while(d&&j<s.length){if(s[j]=="(")d++;else if(s[j]==")")d--;j++}
  const body=s.slice(i,j-1);const cols=new Set();let depth=0,cur="";const parts=[];for(const ch of body){if(ch=="(")depth++;if(ch==")")depth--;if(ch==","&&!depth){parts.push(cur);cur=""}else cur+=ch}parts.push(cur);
  for(const p of parts){const w=p.trim().split(/\s+/)[0];if(w&&!/^(primary|unique|check|constraint|foreign|exclude|like)$/i.test(w))cols.add(w.replace(/"/g,""))}
  tables[m[1]]=tables[m[1]]||new Set();cols.forEach(c=>tables[m[1]].add(c))}
 for(const m of s.matchAll(/alter table (?:if exists )?(?:only )?(?:public\.)?(\w+)([\s\S]*?);/gi)){for(const a of m[2].matchAll(/add column (?:if not exists )?(\w+)/gi)){(tables[m[1]]=tables[m[1]]||new Set()).add(a[1])}}
 for(const m of s.matchAll(/alter table (?:if exists )?(?:public\.)?(\w+)\s+rename column (\w+) to (\w+)/gi)){tables[m[1]]&&tables[m[1]].add(m[3])}
}
module.exports=tables;
if(require.main===module){for(const t of ["chapters","concepts","books","subjects","ssc_exams","ssc_tiers","ssc_subjects","ssc_topics","ssc_subtopics","ncert_ssc_mappings","pyqs","pyq_topics","pyq_subtopics","pyq_attempts","exam_papers","practice_sessions","study_sessions","user_progress","revision_schedule","revision_reviews","notes","resources","tasks","sources"])console.log(t.padEnd(20),tables[t]?[...tables[t]].join(","):"MISSING")}
