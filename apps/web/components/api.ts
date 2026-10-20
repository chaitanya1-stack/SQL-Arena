export async function api<T=Record<string,unknown>>(path:string,options:RequestInit={}):Promise<T>{
 const res=await fetch('/api'+path,{credentials:'include',...options,headers:{'Content-Type':'application/json',...options.headers}});
 const data=await res.json().catch(()=>({error:'The service is unavailable. Please try again.'}));
 if(!res.ok)throw new Error(data.error+(data.details?' '+data.details.map((d:{path:string,message:string})=>`${d.path}: ${d.message}`).join('; '):''));return data;
}
export const post=<T=Record<string,unknown>>(path:string,body:unknown={})=>api<T>(path,{method:'POST',body:JSON.stringify(body)});
export type User={id:string,name:string,email:string|null,role:string,verified:boolean};
export type Problem={id:string,slug:string,title:string,difficulty:string,topics:string[],companies:string[],minutes:number,solved?:boolean,bookmarked?:boolean,acceptance?:string|null,attempts?:number};
export type Output={columns:{name:string,type:string}[],rows:(string|number|boolean|null)[][]};
export type Detail=Problem&{versionId:string,statement:string,constraints:string[],hints:string[],edgeCases:string[],ordered:boolean,attribution:string,schema:Record<string,string>,tables:{name:string,columns:string[],rows:(string|number|null)[][]}[],tests:{id:string,expected:Output}[]};
export type Job={id:string,state:string,verdict?:string,result?:{passed:number,total:number,error?:string,actual?:{columns:string[],rows:unknown[][],elapsedMs:number},elapsedMs?:number}};
