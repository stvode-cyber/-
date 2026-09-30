const http = require('http');
const BASE = 'http://127.0.0.1:3001';
function req(m,p,d,t){return new Promise((a,e)=>{const u=new URL(BASE+p);const b=d?JSON.stringify(d):null;const o={hostname:u.hostname,port:u.port,path:u.pathname+u.search,method:m,headers:{'Content-Type':'application/json'}};if(t)o.headers.Authorization='Bearer '+t;if(b)o.headers['Content-Length']=Buffer.byteLength(b);const r=http.request(o,res=>{let x='';res.on('data',c=>x+=c);res.on('end',()=>{try{a({status:res.statusCode,data:JSON.parse(x)})}catch{a({status:res.statusCode,data:x})}})});r.on('error',e);if(b)r.write(b);r.end()})}
(async()=>{
const R=Date.now();
await req('POST','/api/v1/auth/register',{username:'SR_'+R,password:'Test123456',agreeTerms:true});
const lg=await req('POST','/api/v1/auth/login',{username:'SR_'+R,password:'Test123456'});
const tok=lg.data.data.token;
await req('POST','/api/v1/task-team',{title:'团队测试TeamX',description:'abc',status:'pending',priority:'high',origin:'team'},tok);
await req('POST','/api/v1/task-team',{title:'PersonalY',description:'xyz',status:'pending',priority:'low',origin:'personal'},tok);
const r1=await req('GET','/api/v1/task-team?origin=all&search=Team',null,tok);
console.log('search=Team:',JSON.stringify(r1.data));
const r2=await req('GET','/api/v1/task-team?origin=all&search=Personal',null,tok);
console.log('search=Personal:',JSON.stringify(r2.data));
const r3=await req('GET','/api/v1/task-team?origin=all&search=团队',null,tok);
console.log('search=团队:',JSON.stringify(r3.data));
})();