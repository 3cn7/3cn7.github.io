import {mkdir,rm,copyFile,readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),dist=join(root,'dist');
for(const folder of ['assets','scripts'])for(const name of await readdir(join(root,folder))){if(/\.(js|mjs)$/.test(name)){const result=spawnSync(process.execPath,['--check',join(root,folder,name)],{encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr||'JavaScript syntax check failed: '+name);}}
await rm(dist,{recursive:true,force:true});await mkdir(join(dist,'assets'),{recursive:true});
for(const name of ['index.html','sat.html','sw.js'])await copyFile(join(root,name),join(dist,name));
for(const name of await readdir(join(root,'assets'))){if(!/\.(js|css|svg)$/.test(name))throw new Error('Unexpected public asset: '+name);await copyFile(join(root,'assets',name),join(dist,'assets',name));}
await writeFile(join(dist,'.nojekyll'),'');
const html=await readFile(join(dist,'index.html'),'utf8');if(html.includes('legacy_reference'))throw new Error('Legacy archive referenced by the active page.');
console.log('Production artifact built in dist/. Only the public allowlist was copied.');
