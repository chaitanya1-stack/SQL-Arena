import {cpSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));mkdirSync(root+'apps/web/public/monaco',{recursive:true});cpSync(root+'node_modules/monaco-editor/min/vs',root+'apps/web/public/monaco/vs',{recursive:true});
