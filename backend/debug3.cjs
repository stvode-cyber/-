const http = require('http');
const BASE = 'http://127.0.0.1:3001';
function req(m,p,d,t){return new Promise((a,e)=>{const u=new URL(BASE+p);const b=d?JSON.stringify(d):null;const o={hostname:u.hostname,port:u.port,path:u.pathname+u.search,method:m,headers:{'Content-Type':'application/json'}};if(t){o.headers.Authorization='Bearer '+t;console.log('    -> auth header set len='+t.length)}else{console.log('    -> NO auth header!')};if(b)o.headers['Content-Length']=Buffer.byteLength(b);const r=http.request(o,res=>{let x='';res.on('data',c=>x+=c);res.on('end',()=>{try{a({status:res.statusCode,data:JSON.parse(x),raw:x})}catch{a({status:res.statusCode,data:x})}})});r.on('error',e);if(b)r.write(b);r.end()})}
(async()=>{
const R=Date.now();
console.log('1. register');
await req('POST','/api/v1/auth/register',{username:'Z_'+R,password:'Test123456',agreeTerms:true});
console.log('2. login');
const lg=await req('POST','/api/v1/auth/login',{username:'Z_'+R,password:'Test123456'});
const tok=lg.data.data.token;console.log('   tok ok len='+tok.length);
console.log('3. create team');
const c=await req('POST','/api/v1/task-team',{title:'ZTeam',status:'pending',priority:'high',origin:'team'},tok);
console.log('   status='+c.status+' raw='+c.raw.slice(0,150));
})();