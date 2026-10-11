import {normalize} from './core.js';
export function levenshtein(a,b){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const temp=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=temp;}}return row[b.length];}
function normalized(value,settings){let s=normalize(value);if(settings.tolerateAccents)s=s.normalize('NFD').replace(/\p{M}/gu,'');if(settings.requireArticles===false)s=s.replace(/^(?:il|lo|la|i|gli|le|un|uno|una|the|a|an)\s+|^(?:l'|un')/u,'');return s;}
export function gradeAnswer(response,question,settings={}){
  if(question.type==='mc'||question.type==='tf')return {correct:String(response)===String(question.correctAnswer),reason:'Exact choice'};
  const opts={grading:'strict',requireArticles:true,tolerateAccents:false,...settings};
  const answer=normalized(response,opts),accepted=[question.correctAnswer,...(question.acceptedAnswers||[])].map(v=>normalized(v,opts));
  if(!answer)return {correct:false,reason:'Unanswered'};
  if(accepted.includes(answer))return {correct:true,reason:'Accepted answer'};
  // Only internal one-character typos on long single words. Endings and short words are meaningful.
  if(opts.grading!=='strict')for(const target of accepted){
    if(answer.length>=6&&target.length>=6&&!answer.includes(' ')&&!target.includes(' ')&&answer[0]===target[0]&&answer.slice(-2)===target.slice(-2)&&levenshtein(answer,target)===1)return {correct:true,reason:'Minor internal typo'};
  }
  return {correct:false,reason:'Answer does not match an approved answer'};
}
