import {Decimal} from 'decimal.js';
import type {Result} from './question.js';
export function compare(expected:Result,actual:{columns:string[],rows:unknown[][]},ordered=false,tolerance=0):boolean{
  if(actual.columns.length!==expected.columns.length||actual.rows.length!==expected.rows.length)return false;
  const equal=(a:unknown,b:unknown,type:string)=>{
    if(a===null||b===null)return a===b;
    if(type==='number'){
      try{const x=new Decimal(String(a)),y=new Decimal(String(b));return x.isFinite()&&y.isFinite()&&x.sub(y).abs().lte(tolerance);}catch{return false;}
    }
    if(type==='boolean'){const norm=(v:unknown)=>['true','t','1'].includes(String(v).toLowerCase())?'true':['false','f','0'].includes(String(v).toLowerCase())?'false':String(v);return norm(a)===norm(b);}
    return String(a)===String(b);
  };
  const rowEqual=(a:unknown[],b:unknown[])=>a.length===b.length&&a.every((v,i)=>equal(v,b[i],expected.columns[i].type));
  if(ordered)return expected.rows.every((r,i)=>rowEqual(r,actual.rows[i]));
  // Bipartite matching preserves duplicates and handles overlapping numeric tolerances.
  const matching=Array(actual.rows.length).fill(-1) as number[];
  function assign(i:number,seen:Set<number>):boolean{
    for(let j=0;j<actual.rows.length;j++)if(!seen.has(j)&&rowEqual(expected.rows[i],actual.rows[j])){
      seen.add(j);if(matching[j]===-1||assign(matching[j],seen)){matching[j]=i;return true;}
    }return false;
  }
  return expected.rows.every((_,i)=>assign(i,new Set()));
}
