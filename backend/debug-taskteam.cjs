const http = require('http');
const BASE = 'http://127.0.0.1:3001';
function req(m,p,d,t){return new Promise((a,e)=>{const u=new URL(BASE+p);const b=d?JSON.stringify(d):null;const o={hostname:u.hostname,port:u.port,path:u.pathname+u.search,method:m,headers:{'Content-Type':'application/json'}};if(t)o.headers.Authorization='Bearer '+t;if(b)o.headers['Content-Length']=Buffer.byteLength(b);const r=http.request(o,res=>{let x='';res.on('data',c=>x+=c);res.on('end',()=>{try{a({status:res.statusCode,data:JSON.parse(x)})}catch{a({status:res.statusCode,data:x})}})});r.on('error',e);if(b)r.write(b);r.end()})}
(async()=>{
const R=Date.now();
const reg=await req('POST','/api/v1/auth/register',{username:'dt_'+R,password:'Test123456',agreeTerms:true});
const lg=await req('POST','/api/v1/auth/login',{username:'dt_'+R,password:'Test123456'});
const tok=lg.data.data.token;
const c=await req('POST','/api/v1/task-team',{title:'Team X',description:'',status:'pending',priority:'high',origin:'team'},tok);
const p=await req('POST','/api/v1/task-team',{title:'Personal X',description:'',status:'pending',priority:'low',origin:'personal'},tok);
console.log('created team:',c.data.data.id,'origin=',c.data.data.origin,'status=',c.data.data.status);
console.log('created personal:',p.data.data.id,'origin=',p.data.data.origin);

// 测试不同 origin 查询
const all=await req('GET','/api/v1/task-team',null,tok);
console.log('ALL:',all.data.data.length,'items');
const teamQ=await req('GET','/api/v1/task-team?origin=team',null,tok);
console.log('origin=team:',teamQ.data.data.length,'items');
const personalQ=await req('GET','/api/v1/task-team?origin=personal',null,tok);
console.log('origin=personal:',personalQ.data.data.length,'items');
const allRaw=await req('GET','/api/v1/task-team?origin=all',null,tok);
console.log('origin=all:',allRaw.data.data.length,'items');

// 打印完整列表
for (const t of all.data.data||[]) {
  console.log('  -',t.id,'origin='+t.origin,'status='+t.status,'userId='+t.userId,'assigneeId='+t.assigneeId);
}
})();