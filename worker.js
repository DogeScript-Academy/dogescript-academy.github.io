/* DogeScript Online: interpreteur isole dans un Worker. */
const send=(type,data={})=>postMessage({type,...data});
let pendingRead=null;
onmessage=async({data})=>{
 if(data.type==='input'){if(pendingRead){const cb=pendingRead;pendingRead=null;cb(data.value)}return;}
 if(data.type!=='run')return;
 try{let program=parse(data.source);send('started');await execute(program);send('done');}
 catch(e){if(e?.stopped){send('done');return}send('error',{message:e.message||String(e)});}
};
const fail=(line,message)=>{throw Error(`Ligne ${line} : ${message}`)};
function strip(s,n){let quote=false,esc=false;for(let i=0;i<s.length;i++){let c=s[i];if(esc){esc=false;continue}if(quote&&c==='\\'){esc=true;continue}if(c==='"'){quote=!quote;continue}if(!quote&&(c==='#'||(c==='/'&&s[i+1]==='/')))return s.slice(0,i)}if(quote)fail(n,'guillemet fermant manquant');return s}
function parse(source){
 const lines=[];source.replace(/^\uFEFF/,'').split(/\r?\n/).forEach((raw,i)=>{let s=strip(raw,i+1).trim();if(!s)return;let m=s.match(/^}\s*(else|sinon)\s*\{$/);if(m){lines.push({s:'}',n:i+1},{s:m[1]+' {',n:i+1});}else lines.push({s,n:i+1})});
 let index=0, funcs={}, start=null,run=null, top=[],vars=new Set();
 const decl=/^(int|number|nombre|text|texte|tf|textList|numberList)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/;
 function parseBlock(){let out=[];while(index<lines.length){let {s,n}=lines[index++],m;if(s==='}')return out;
  if((m=s.match(/^(if|si|while|tantque|repeat|repeter)\s*(.*?)\s*\{$/))){let kind=({si:'if',tantque:'while',repeter:'repeat'})[m[1]]||m[1];if(!m[2].trim())fail(n,'condition ou nombre manquant');let node={kind,arg:m[2].trim(),body:parseBlock(),n};if(kind==='if'&&index<lines.length&&/^(else|sinon)\s*\{$/.test(lines[index].s)){index++;node.other=parseBlock()}out.push(node);continue;}
  if(/^(else|sinon)\b/.test(s))fail(n,'else sans if correspondant');
  s=s.replace(/;\s*$/,'').trim();
  if((m=s.match(decl))){if(vars.has(m[2]))fail(n,'variable déjà déclarée : '+m[2]);if(['t','f','true','false','vrai','faux'].includes(m[2]))fail(n,'nom réservé : '+m[2]);vars.add(m[2]);out.push({kind:'decl',vtype:m[1],name:m[2],arg:m[3],n});continue;}
  if((m=s.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/))){out.push({kind:'assign',name:m[1],arg:m[2],n});continue;}
  if((m=s.match(/^(sayL|say|print|dire|afficher|wait|sleep|attendre|read|lire)\b\s*(.*)$/))){let arg=m[2].trim();if(arg.startsWith('(')&&arg.endsWith(')'))arg=arg.slice(1,-1).trim();if(!arg)fail(n,'argument manquant');out.push({kind:m[1],arg,n});continue;}
  if(/^(stop|arreter)(\(\))?$/.test(s)){out.push({kind:'stop',n});continue;}
  if((m=s.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)$/))){out.push({kind:'call',name:m[1],n});continue;}
  fail(n,'instruction inconnue ou syntaxe incorrecte');
 }fail(lines.at(-1)?.n||1,'accolade fermante manquante')}
 while(index<lines.length){let {s,n}=lines[index++],m;
  if((m=s.match(/^(?:doge\.Start|start|doge\s+infos)\s*\{$/))){if(start||run)fail(n,'doge.Start doit précéder doge.Run et être unique');start=parseBlock();continue}
  if((m=s.match(/^(?:doge\.Run|loop|doge\s+action)\s*\{$/))){if(run)fail(n,'doge.Run existe déjà');run=parseBlock();continue}
  if((m=s.match(/^(?:function|fonction)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{$/))){if(funcs[m[1]])fail(n,'fonction déjà définie : '+m[1]);funcs[m[1]]=parseBlock();continue}
  s=s.replace(/;\s*$/,'').trim();if((m=s.match(decl))){if(vars.has(m[2]))fail(n,'variable déjà déclarée : '+m[2]);if(['t','f','true','false','vrai','faux'].includes(m[2]))fail(n,'nom réservé : '+m[2]);vars.add(m[2]);top.push({kind:'decl',vtype:m[1],name:m[2],arg:m[3],n});continue}
  fail(n,'instruction en dehors d’un bloc DogeScript');
 }
 if(!start&&!run)fail(1,'ajoutez doge.Start ou doge.Run');return {top,start,run,funcs};
}
function expression(source,vars,n){
 let toks=[],i=0;while(i<source.length){let c=source[i];if(/\s/.test(c)){i++;continue}if(c==='"'){let j=i+1,s='';while(j<source.length&&source[j]!=='"'){if(source[j]==='\\'){j++;if(j>=source.length)fail(n,'échappement incomplet');let map={n:'\n',r:'\r',t:'\t','\\':'\\','"':'"'};if(!(source[j] in map))fail(n,'échappement inconnu');s+=map[source[j++]]}else s+=source[j++]}if(source[j]!=='"')fail(n,'guillemet fermant manquant');toks.push({v:s,type:'str'});i=j+1;continue}
 let m=source.slice(i).match(/^(\d+|[A-Za-z_][A-Za-z0-9_]*|==|!=|<=|>=|&&|\|\||[()+\-*/%<>!])/);if(!m)fail(n,'expression invalide près de : '+source.slice(i));toks.push({v:m[0],type:/^\d/.test(m[0])?'num':'op'});i+=m[0].length;}
 let k=0,prec={'or':1,'ou':1,'||':1,'and':2,'et':2,'&&':2,'==':3,'!=':3,'<':3,'>':3,'<=':3,'>=':3,'+':4,'-':4,'*':5,'/':5,'%':5};
 function primary(){let t=toks[k++];if(!t)fail(n,'expression incomplète');
  if(t.type==='str')return ()=>t.v;
  if(t.type==='num'){let x=Number(t.v);if(x>2147483647)fail(n,'entier trop grand');return ()=>x}
  if(t.v==='('){let v=expr(1);if(toks[k++]?.v!==')')fail(n,'parenthèse fermante manquante');return v}
  if(['!','not','-'].includes(t.v)){let a=primary();return ()=>{let v=a();if(typeof v!=='number')fail(n,'nombre attendu');return t.v==='-'?(-v|0):Number(!v)}}
  if(['true','t','vrai'].includes(t.v))return ()=>1;if(['false','f','faux'].includes(t.v))return ()=>0;
  return ()=>{let v=vars.get(t.v);if(!v)fail(n,'variable inconnue : '+t.v);return v.value};
 }
 function expr(min){let left=primary();while(k<toks.length&&toks[k].type==='op'&&prec[toks[k].v]>=min){let op=toks[k++].v,right=expr(prec[op]+1),old=left;
  left=()=>{let a=old();if(typeof a!=='number'&&!(op==='+'&&typeof a==='string'))fail(n,'types incompatibles dans l’expression');
   if(['and','et','&&'].includes(op)&&!a)return 0;if(['or','ou','||'].includes(op)&&a)return 1;
   let b=right();if(op==='+'&&typeof a==='string'&&typeof b==='string')return a+b;
   if(typeof a!=='number'||typeof b!=='number')fail(n,'types incompatibles dans l’expression');
   switch(op){case '+':return(a+b)|0;case '-':return(a-b)|0;case '*':return Math.imul(a,b);case '/':case '%':if(!b)fail(n,'division par zéro');if(a===-2147483648&&b===-1)fail(n,'dépassement de division');return op==='/'?(Math.trunc(a/b)|0):(a%b|0);case '==':return +(a===b);case '!=':return +(a!==b);case '<':return +(a<b);case '<=':return +(a<=b);case '>':return +(a>b);case '>=':return +(a>=b);case 'and':case 'et':case '&&':return +(!!a&&!!b);case 'or':case 'ou':case '||':return +(!!a||!!b)}
  };
 }return left}

 let result=expr(1);if(k!==toks.length)fail(n,'expression incomprise');return result();
}
function decode(s,n){if(!s)fail(n,'textList vide');let o='';for(const p of s.split(';')){let m=p.trim().match(/^(-?)(\d+)(_*)$/);if(!m||+m[2]<1||+m[2]>26)fail(n,'textList : nombres de 1 à 26 séparés par ; attendus');o+=String.fromCharCode((m[1]?65:97)+(+m[2])-1)+' '.repeat(m[3].length)}return o}
function encode(s,n){let out='';for(const ch of s){if(ch===' '){if(!out)fail(n,'numberList ne peut pas commencer par un espace');out+='_';continue}if(!/[A-Za-z]/.test(ch))fail(n,'numberList accepte seulement les lettres A-Z et les espaces');let upper=ch>='A'&&ch<='Z',num=ch.toLowerCase().charCodeAt(0)-96;out+=(out?';':'')+(upper?'-':'')+num}return out}
async function execute(program){let vars=new Map(),steps=0,depth=0;const textTypes=['text','texte','textList','numberList'];
 function value(v,raw,n){let result;if(v.type==='textList'&&/^\s*-?\d/.test(raw))result=decode(raw,n);else {result=expression(raw,vars,n);if(textTypes.includes(v.type)){if(typeof result!=='string')fail(n,'texte attendu');if(v.type==='textList')result=decode(result,n);if(v.type==='numberList')result=encode(result,n)}else{if(typeof result!=='number')fail(n,'nombre attendu');if(v.type==='tf')result=+!!result}}if(typeof result==='string'&&new TextEncoder().encode(result).length>1024)fail(n,'texte trop long (1024 octets maximum)');v.value=result}
 async function tick(){if(++steps%500===0)await new Promise(r=>setTimeout(r,0))}
 async function block(nodes){for(const node of nodes){await tick();let {kind,n,arg}=node,v;
  if(kind==='decl'){if(!vars.has(node.name))vars.set(node.name,{type:node.vtype,value:textTypes.includes(node.vtype)?'':0});v=vars.get(node.name);value(v,arg,n);continue}
  if(kind==='assign'){v=vars.get(node.name);if(!v)fail(n,'variable inconnue : '+node.name);value(v,arg,n);continue}
  if(['say','sayL','print','dire','afficher'].includes(kind)){let val=expression(arg,vars,n);send('output',{text:String(val)+(kind==='sayL'?'':'\n')});continue}
  if(['wait','sleep','attendre'].includes(kind)){let ms=expression(arg,vars,n);if(typeof ms!=='number')fail(n,'nombre attendu');await new Promise(r=>setTimeout(r,Math.max(0,ms)));continue}
  if(['read','lire'].includes(kind)){v=vars.get(arg);if(!v||textTypes.includes(v.type))fail(n,'read attend une variable numérique existante');send('read');let input=await new Promise(r=>pendingRead=r);let match=String(input).match(/^-?\d+/);let number=match?(Number(match[0])|0):0;v.value=v.type==='tf'?+!!number:number;continue}
  if(kind==='stop')throw {stopped:true};
  if(kind==='call'){let fn=program.funcs[node.name];if(!fn)fail(n,'fonction inconnue : '+node.name);if(++depth>300)fail(n,'trop d’appels imbriqués');await block(fn);depth--;continue}
  if(kind==='if'){if(expression(arg,vars,n))await block(node.body);else if(node.other)await block(node.other);continue}
  if(kind==='repeat'){let count=expression(arg,vars,n);if(typeof count!=='number')fail(n,'nombre attendu');for(let i=0;i<count;i++){await tick();await block(node.body)}continue}
  if(kind==='while'){while(expression(arg,vars,n)){await tick();await block(node.body)}continue}
 }}
 await block(program.top);if(program.start)await block(program.start);if(program.run)while(true){await tick();await block(program.run)}
}
