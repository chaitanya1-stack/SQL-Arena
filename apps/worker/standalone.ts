import {startWorker} from './main.js';
console.info('[hf-judge] Starting standalone worker');
const stop = await startWorker();
let stopping = false;
async function shutdown() {
 if(stopping)return;
 stopping=true;
 await stop();
 process.exitCode=0;
}
process.on('SIGINT',()=>void shutdown());
process.on('SIGTERM',()=>void shutdown());
