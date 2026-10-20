import {createHash} from 'node:crypto';
export type Candidate={id:string,difficulty:string,topics:string[]};
export function selectQuestions(candidates:Candidate[],count:number,seed:string):Candidate[]{
  if(count<1||count>50||count>candidates.length)throw new Error('Not enough matching questions. Relax filters or reduce question count.');
  const rank=(id:string)=>createHash('sha256').update(seed+':'+id).digest('hex');
  const pool=[...candidates].sort((a,b)=>rank(a.id).localeCompare(rank(b.id)));
  const counts=new Map<string,number>(),topics=new Map<string,number>(),selected:Candidate[]=[];
  while(selected.length<count){pool.sort((a,b)=>{
    const score=(x:Candidate)=>(counts.get(x.difficulty)||0)*3+x.topics.reduce((s,t)=>s+(topics.get(t)||0),0)/x.topics.length;
    return score(a)-score(b)||rank(a.id).localeCompare(rank(b.id));
  });const q=pool.shift()!;selected.push(q);counts.set(q.difficulty,(counts.get(q.difficulty)||0)+1);q.topics.forEach(t=>topics.set(t,(topics.get(t)||0)+1));}
  return selected.sort((a,b)=>rank('order:'+a.id).localeCompare(rank('order:'+b.id)));
}
