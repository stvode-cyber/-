const http = require('http');
const BASE = 'http://127.0.0.1:3001';
function req(m,p,d,t){return new Promise((a,e)=>{const u=new URL(BASE+p);const b=d?JSON.stringify(d):null;const o={hostname:u.hostname,port:u.port,path:u.pathname+u.search,method:m,headers:{'Content-Type':'application/json'}};if(t)o.headers.Authorization='Bearer '+t;if(b)o.headers['Content-Length']=Buffer.byteLength(b);const r=http.request(o,res=>{let x='';res.on('data',c=>x+=c);res.on('end',()=>{try{a({status:res.statusCode,data:JSON.parse(x)})}catch{a({status:res.statusCode,data:x})}})});r.on('error',e);if(b)r.write(b);r.end()})}
let pass=0,fail=0;
async function t(n,f,s){try{const r=await f();if(s&&r.status!==s){console.log('  FAIL',n,'exp',s,'got',r.status);fail++;return r}console.log('  PASS',n);pass++;return r}catch(e){console.log('  FAIL',n,e.message);fail++}}
(async()=>{
const R=Date.now();
console.log('=== 1. register ===');
const reg=await t('register',()=>req('POST','/api/v1/auth/register',{username:'tt_'+R,password:'Test123456',agreeTerms:true}),200);
console.log('=== 2. login ===');
const lg=await t('login',()=>req('POST','/api/v1/auth/login',{username:'tt_'+R,password:'Test123456'}),200);
const tok=lg.data?.data?.token||lg.data?.token;const me=lg.data?.data?.user||lg.data?.user;console.log('userId=',me?.id,'role=',me?.role);
console.log('=== 3. list empty ===');
await t('list-empty',()=>req('GET','/api/v1/task-team',null,tok),200);
console.log('=== 4. create team task ===');
const c=await t('create-team',()=>req('POST','/api/v1/task-team',{title:'Team Test',description:'smoke',status:'pending',priority:'high',origin:'team',dueDate:new Date(Date.now()+86400000).toISOString()},tok),200);
const tid=c.data?.data?.id;console.log('taskId=',tid);
console.log('=== 5. create personal task ===');
const p2=await t('create-personal',()=>req('POST','/api/v1/task-team',{title:'Personal',description:'smoke',status:'pending',priority:'low',origin:'personal'},tok),200);
const p2id=p2.data?.data?.id;
console.log('=== 6. get detail ===');
await t('get',()=>req('GET','/api/v1/task-team/'+tid,null,tok),200);
console.log('=== 7. list with search ===');
await t('search',()=>req('GET','/api/v1/task-team?search=Team',null,tok),200);
console.log('=== 8. list origin=team ===');
const lt=await req('GET','/api/v1/task-team?origin=team',null,tok);if((lt.data?.data||[]).length>=1){console.log('  PASS origin-team='+(lt.data?.data||[]).length);pass++}else{console.log('  FAIL');fail++}
console.log('=== 9. list origin=personal ===');
const lp=await req('GET','/api/v1/task-team?origin=personal',null,tok);if((lp.data?.data||[]).length>=1){console.log('  PASS origin-personal='+(lp.data?.data||[]).length);pass++}else{console.log('  FAIL');fail++}
console.log('=== 10. PATCH status pending->in_progress ===');
await t('st-prog',()=>req('PATCH','/api/v1/task-team/'+tid+'/status',{status:'in_progress'},tok),200);
console.log('=== 11. PATCH status in_progress->completed ===');
await t('st-done',()=>req('PATCH','/api/v1/task-team/'+tid+'/status',{status:'completed'},tok),200);
console.log('=== 12. verify completedAt auto written ===');
const d=await req('GET','/api/v1/task-team/'+tid,null,tok);const cA=d.data?.data?.completedAt;if(cA){console.log('  PASS completedAt='+cA);pass++}else{console.log('  FAIL completedAt missing');fail++}
console.log('=== 13. verify status=completed ===');
if(d.data?.data?.status==='completed'){console.log('  PASS status=completed');pass++}else{console.log('  FAIL status='+d.data?.data?.status);fail++}
console.log('=== 14. PATCH reassign self ===');
await t('reassign',()=>req('PATCH','/api/v1/task-team/'+tid+'/reassign',{assigneeId:me.id},tok),200);
console.log('=== 15. DELETE team ===');
await t('del-team',()=>req('DELETE','/api/v1/task-team/'+tid,null,tok),200);
console.log('=== 16. DELETE personal ===');
await t('del-personal',()=>req('DELETE','/api/v1/task-team/'+p2id,null,tok),200);
console.log('=== 17. final list cleared ===');
const f=await req('GET','/api/v1/task-team',null,tok);if((f.data?.data||[]).length===0){console.log('  PASS all clear');pass++}else{console.log('  FAIL residual');fail++}
console.log('');
console.log('========== RESULT: '+pass+' PASS / '+fail+' FAIL ==========');
process.exit(fail>0?1:0);
})();