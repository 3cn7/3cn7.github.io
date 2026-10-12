export const $=selector=>document.querySelector(selector);
export const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export const attr=esc;
export const date=value=>value?new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'Not studied yet';
export const duration=ms=>`${Math.floor(ms/60000)}m ${Math.floor(ms/1000)%60}s`;
export const button=(label,action,extra='',classes='')=>`<button ${/\btype=/.test(extra)?'':'type="button"'} class="${classes}" data-action="${action}" ${extra}>${label}</button>`;
export const star=(card,extra='')=>`<button class="icon-btn star ${card.starred?'on':''}" data-action="star" data-id="${attr(card.id)}" aria-label="${card.starred?'Unstar':'Star'} ${attr(card.term)}" aria-pressed="${!!card.starred}" ${extra}>${card.starred?'⭐':'☆'}</button>`;
export function toast(message){const el=$('#toast');el.textContent=message;el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,5500);}
export function modal(title,content,submit,onSubmit,{submitLabel='Save',wide=false}={}){
 // Each dialog owns its handlers. Reusing a node retains editor/import listeners.
 const previous=$('#modal');if(previous.open)previous.close();const dialog=previous.cloneNode(false);previous.replaceWith(dialog);dialog.innerHTML=`<form id="modalForm"><div class="row between"><h2 id="modalTitle">${esc(title)}</h2><button type="button" data-close aria-label="Close dialog">×</button></div>${content}<div id="modalError" class="notice error" hidden role="alert"></div><div class="modal-actions"><button type="button" data-close>Cancel</button>${submit?`<button type="submit" class="primary">${esc(submitLabel)}</button>`:''}</div></form>`;
 dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dialog.close());
 dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;if(b)b.disabled=true;try{const result=await onSubmit(new FormData(e.target),e.target);if(result!==false)dialog.close();}catch(error){const el=dialog.querySelector('#modalError');el.textContent=error.message;el.hidden=false;}finally{if(b)b.disabled=false;}};dialog.showModal();return dialog;
}
export const options=(pairs,value)=>pairs.map(([id,label])=>`<option value="${attr(id)}" ${String(value??'')===String(id)?'selected':''}>${esc(label)}</option>`).join('');
export const selectField=(label,name,pairs,value)=>`<label>${esc(label)}<select name="${name}" aria-label="${esc(label)}">${options(pairs,value)}</select></label>`;
export const field=(label,name,value='',type='text',extra='')=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${attr(value)}" ${extra}></label>`;
export const check=(label,name,value=false)=>`<label class="check"><input type="checkbox" name="${name}" ${value?'checked':''}>${esc(label)}</label>`;
export const empty=(title,text,action='')=>`<div class="empty"><span class="empty-symbol" aria-hidden="true">📁</span><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
export function download(filename,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
export function safeImage(value){try{const u=new URL(value,location.origin);if(u.protocol==='https:'||u.origin===location.origin)return u.href;}catch{}return '';}
export function confirmAction(title,message,action,label='Confirm'){return modal(title,`<p>${esc(message)}</p>`,true,action,{submitLabel:label});}
