import {readFile,writeFile,rename} from 'node:fs/promises';
import {questionSchema} from '../packages/core/question.js';
import {contentHash} from '../packages/core/content-hash.js';
import {validateQuestion} from '../apps/worker/judge.js';
const file=new URL('../content/validation-report.json',import.meta.url);
const bank=(JSON.parse(await readFile(new URL('../content/questions.json',import.meta.url),'utf8')) as unknown[]).map(q=>questionSchema.parse(q));
type Entry={passed:boolean,hash:string,engines:string[],checkedAt:string,report:unknown};
let results:Record<string,Entry>={};try{results=JSON.parse(await readFile(file,'utf8')).questions;}catch{}
let failed=0;
for(const q of bank){if(results[q.id]?.passed&&results[q.id].hash===contentHash(q)&&!process.argv.includes('--force')){console.log(q.id+' already validated');continue;}
 const result=await validateQuestion(q);results[q.id]={...result,hash:contentHash(q)};if(!result.passed)failed++;
 const output=JSON.stringify({generatedAt:new Date().toISOString(),kind:'docker-dual-engine-validation',questions:results},null,2);const temp=new URL('../content/validation-report.tmp.json',import.meta.url);await writeFile(temp,output);await rename(temp,file);
 console.log(`${q.id} ${result.passed?'PASS':'FAIL'} ${q.title}`);
 if(!result.passed&&JSON.stringify(result.report).includes('Internal Judge Error')){console.error('Infrastructure failure. Fix Docker, then rerun; previous passes are retained.');process.exitCode=1;break;}
}
if(failed)process.exitCode=1;
