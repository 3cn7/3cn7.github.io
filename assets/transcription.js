export async function detectAudio(blob){
 const b=new Uint8Array(await blob.slice(0,64).arrayBuffer()),s=String.fromCharCode(...b);
 if(s.startsWith('RIFF')&&s.slice(8,12)==='WAVE')return 'audio/wav';
 if(s.startsWith('ID3')||(b[0]===255&&(b[1]&224)===224))return 'audio/mpeg';
 if(s.slice(4,8)==='ftyp')return 'audio/mp4';
 if(b[0]===0x1a&&b[1]===0x45&&b[2]===0xdf&&b[3]===0xa3)return 'audio/webm';
 if(s.startsWith('OggS'))return 'audio/ogg';if(s.startsWith('fLaC'))return 'audio/flac';
 throw new Error('Unsupported audio signature. Choose an actual WAV, MP3, M4A/MP4, WebM, Ogg, or FLAC recording.');
}
export function validateTranscript(result){if(!result||typeof result.rawText!=='string'||!Array.isArray(result.segments))throw new Error('The provider returned an invalid transcript.');let last=-1;for(const s of result.segments){if(typeof s.text!=='string'||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.end<s.start||s.start<last)throw new Error('Invalid transcript segment timestamps.');last=s.start;}return result;}
export class Companion {
 constructor(url='http://127.0.0.1:8766',token=''){this.url=url.replace(/\/$/,'');this.token=token;}
 async request(path,options={}){if(!this.token)throw new Error('Transcription not configured. Enter the companion access token in Settings.');const u=new URL(this.url);if(u.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw new Error('Use HTTPS for a remote service, or a local loopback URL.');const res=await fetch(this.url+path,{...options,headers:{...options.headers,Authorization:'Bearer '+this.token}});const body=await res.json().catch(()=>({error:`Service returned ${res.status}`}));if(!res.ok)throw new Error(body.error||body.detail||`Companion ${res.status}`);return body;}
 health(){return this.request('/health');}
 async transcribe(blob,settings){await detectAudio(blob);if(blob.size>500*1024*1024)throw new Error('This companion accepts audio up to 500 MB. Split larger recordings first.');const q=new URLSearchParams(Object.fromEntries(Object.entries(settings).map(([k,v])=>[k,String(v)])));return this.request('/jobs?'+q,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:blob});}
 job(id){return this.request('/jobs/'+encodeURIComponent(id));}
 retry(id){return this.request('/jobs/'+encodeURIComponent(id)+'/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}
 cancel(id){return this.request('/jobs/'+encodeURIComponent(id),{method:'DELETE'});}
 generate(data){return this.request('/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
}
