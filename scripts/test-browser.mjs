import {spawn} from 'node:child_process';
// Each suite loads the 1,756-row SAT app. Run serially for stable browser startup.
const checks=['browser-smoke.mjs','browser-integrity.mjs','browser-learn.mjs','browser-transcript.mjs','browser-library.mjs'];
for(const name of checks){await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tests/'+name],{stdio:'inherit',env:process.env});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(name+' failed with exit '+code)));});console.log('PASS '+name);}
