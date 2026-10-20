// Opt-in only: point at a test deployment you own. Does not create accounts.
const base=process.env.LOAD_BASE_URL||'http://localhost:3000';
const users=Number(process.env.LOAD_USERS||10),duration=Number(process.env.LOAD_SECONDS||30);
if(!Number.isInteger(users)||users<1||users>10000||duration<1||duration>600)throw new Error('Invalid load settings');
const samples=[],errors=[];const deadline=performance.now()+duration*1000;
await Promise.all(Array.from({length:users},async(_,i)=>{while(performance.now()<deadline){const start=performance.now();try{const r=await fetch(base+'/api/questions?limit=20&page='+((i%3)+1),{signal:AbortSignal.timeout(10000)});if(!r.ok)errors.push(r.status);await r.arrayBuffer();}catch{errors.push('network');}samples.push(performance.now()-start);await new Promise(r=>setTimeout(r,200));}}));
samples.sort((a,b)=>a-b);const percentile=p=>samples[Math.min(samples.length-1,Math.floor(samples.length*p))];console.log(JSON.stringify({workload:'question-browsing-only',virtualUsers:users,requests:samples.length,errors:errors.length,errorTypes:[...new Set(errors)],p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99)},null,2));
