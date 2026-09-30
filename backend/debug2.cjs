const http = require('http');
const BASE = 'http://127.0.0.1:3001';
function req(m,p,d,t){return new Promise((a,e)=>{const u=new URL(BASE+p);const b=d?JSON.stringify(d):null;const o={hostname:u.hostname,port:u.port,path:u.pathname+u.search,method:m,headers:{'Content-Type':'application/json'}};if(t)o.headers.Authorization='Bearer '+t;if(b)o.headers['Content-Length']=Buffer.byteLength(b);const r=http.request(o,res=>{let x='';res.on('data',c=>x+=c);res.on('end',()=>{try{a({status:res.statusCode,data:JSON.parse(x),raw:x})}catch{a({status:res.statusCode,data:x})}})});r.on('error',e);if(b)r.write(b);r.end()})}
(async()=>{
const R=Date.now();
const reg=await req('POST','/api/v1/auth/register',{username:'dt2_'+R,password:'Test123456',agreeTerms:true});
const lg=await req('POST','/api/v1/auth/login',{username:'dt2_'+R,password:'Test123456'});
const tok=lg.data.data.token;
const c=await req('POST','/api/v1/task-team',{title:'TeamX',status:'pending',priority:'high',origin:'team'},tok);
const p=await req('POST','/api/v1/task-team',{title:'PersX',status:'pending',priority:'low',origin:'personal'},tok);
console.log('created:',c.status,p.status);
const all=await req('GET','/api/v1/task-team',null,tok);
console.log('ALL raw JSON:');
console.log(all.raw);
})();