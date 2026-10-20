// Defense in depth only. The boundary is a disposable, networkless container,
// SELECT-only credentials, a read-only transaction and hard resource/time limits.
export function queryPolicy(query:string):string|null{
  if(!query.trim()||Buffer.byteLength(query)>20000)return 'Enter one query of at most 20 KB.';
  const words:string[]=[];let i=0,ended=false;
  while(i<query.length){
    const c=query[i];
    if(/\s/.test(c)){i++;continue;}
    if(query.slice(i,i+2)==='--'||c==='#'){while(i<query.length&&query[i]!=='\n')i++;continue;}
    if(query.slice(i,i+2)==='/*'){
      if(query[i+2]==='!'||query[i+2]==='+')return 'Executable comments and optimizer hints are not supported.';
      const end=query.indexOf('*/',i+2);if(end<0)return 'Unclosed comment.';i=end+2;continue;
    }
    if(ended)return 'Only one SELECT statement is allowed.';
    if(c===';'){ended=true;i++;continue;}
    if(c==="'"||c==='"'||c==='`'){
      const quote=c;i++;let closed=false;
      while(i<query.length){if(query[i]===quote){if(query[i+1]===quote){i+=2;continue;}i++;closed=true;break;}if(query[i]==='\\')i+=2;else i++;}
      if(!closed)return 'Unclosed quoted value.';continue;
    }
    if(c==='$'||c==='\\')return 'Dollar quoting and client commands are not supported.';
    const m=/^[A-Za-z_][A-Za-z_0-9]*/.exec(query.slice(i));
    if(m){words.push(m[0].toUpperCase());i+=m[0].length;}else i++;
  }
  if(!['SELECT','WITH'].includes(words[0]))return 'Use SELECT or WITH.';
  const forbidden=new Set(['INSERT','UPDATE','DELETE','DROP','ALTER','TRUNCATE','CREATE','GRANT','REVOKE','COPY','CALL','DO','EXECUTE','PREPARE','SET','RESET','INTO','LOCK','UNLOCK','LOAD','HANDLER']);
  if(words.some(w=>forbidden.has(w)))return 'Only read queries are supported. Use SELECT to identify duplicate rows.';
  return null;
}
