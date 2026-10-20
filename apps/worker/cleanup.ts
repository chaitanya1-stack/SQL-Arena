import {command} from './sandbox.js';
// Only containers created by this judge, older than the hard job deadline plus
// a generous grace period. Multiple workers can safely race to remove one.
export async function cleanupOrphans(){
 const names=(await command(['ps','-aq','--filter','label=sql-arena.sandbox=true'])).trim().split(/\s+/).filter(Boolean);
 for(const name of names){try{const state=JSON.parse(await command(['inspect',name]))[0];if(Date.now()-new Date(state.Created).getTime()>10*60*1000)await command(['rm','-f',name]);}catch{/* another worker may already have removed it */}}
}
