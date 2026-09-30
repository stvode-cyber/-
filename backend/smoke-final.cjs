const http = require('http');
const BASE = 'http://127.0.0.1:3001';
function req(m,p,d,t){return new Promise((a,e)=>{const u=new URL(BASE+p);const b=d?JSON.stringify(d):null;const o={hostname:u.hostname,port:u.port,path:u.pathname+u.search,method:m,headers:{'Content-Type':'application/json'}};if(t)o.headers.Authorization='Bearer '+t;if(b)o.headers['Content-Length']=Buffer.byteLength(b);const r=http.request(o,res=>{let x='';res.on('data',c=>x+=c);res.on('end',()=>{try{a({status:res.statusCode,data:JSON.parse(x)})}catch{a({status:res.statusCode,data:x})}})});r.on('error',e);if(b)r.write(b);r.end()})}
function tasksOf(r){return r.data?.data?.tasks||r.data?.tasks||[]}
let pass=0,fail=0;
function c(n,r,s,ok){if(r.status!==s){console.log('  FAIL '+n+' exp '+s+' got '+r.status);fail++;return}if(ok&&!ok(r)){console.log('  FAIL '+n+' assert');fail++;return}console.log('  PASS '+n);pass++}
(async()=>{
const R=Date.now();
await req('POST','/api/v1/auth/register',{username:'SF_'+R,password:'Test123456',agreeTerms:true});
const lg=await req('POST','/api/v1/auth/login',{username:'SF_'+R,password:'Test123456'});
const tok=lg.data.data.token;const me=lg.data.data.user;
console.log('userId='+me.id+' role='+me.employeeRole);

console.log('\n=== 团队任务 API 16 项 ===');
const r1=await req('GET','/api/v1/task-team',null,tok);        c('1.list-empty',r1,200,r=>tasksOf(r).length===0);
const r2=await req('POST','/api/v1/task-team',{title:'TeamS',status:'pending',priority:'high',origin:'team'},tok);const tid=r2.data.data.id; c('2.create-team',r2,200,r=>r.data.data.origin==='team'&&r.data.data.id);
const r3=await req('POST','/api/v1/task-team',{title:'PersS',status:'pending',priority:'low',origin:'personal'},tok);const pid=r3.data.data.id; c('3.create-pers',r3,200,r=>r.data.data.origin==='personal');
const r4=await req('GET','/api/v1/task-team/'+tid,null,tok);   c('4.get-detail',r4,200,r=>r.data.data.id===tid);
const r5=await req('GET','/api/v1/task-team?origin=team',null,tok);  c('5.origin-team=1',r5,200,r=>tasksOf(r5).length===1);
const r6=await req('GET','/api/v1/task-team?origin=personal',null,tok); c('6.origin-pers=1',r6,200,r=>tasksOf(r6).length===1);
const r7=await req('GET','/api/v1/task-team?origin=all',null,tok);  c('7.origin-all=2',r7,200,r=>tasksOf(r7).length===2);
const r8=await req('GET','/api/v1/task-team',null,tok);           c('8.default-team=1',r8,200,r=>tasksOf(r8).length===1);
const r9=await req('GET','/api/v1/task-team?origin=all&search=Team',null,tok); c('9.search',r9,200,r=>tasksOf(r9).length===1);
const r10=await req('PATCH','/api/v1/task-team/'+tid+'/status',{status:'in_progress'},tok); c('10.pending->prog',r10,200,r=>r10.data.data.status==='in_progress');
const r11=await req('PATCH','/api/v1/task-team/'+tid+'/status',{status:'completed'},tok);   c('11.prog->done',r11,200,r=>r11.data.data.status==='completed');
const r12=await req('GET','/api/v1/task-team/'+tid,null,tok);   c('12.completedAt-auto',r12,200,r=>!!r12.data.data.completedAt);
const r13=await req('PATCH','/api/v1/task-team/'+tid+'/reassign',{assigneeId:me.id},tok);   c('13.reassign',r13,200,r=>r13.data.data.assigneeId===me.id);
const r14=await req('DELETE','/api/v1/task-team/'+tid,null,tok); c('14.del-team',r14,200);
const r15=await req('DELETE','/api/v1/task-team/'+pid,null,tok); c('15.del-pers',r15,200);
const r16=await req('GET','/api/v1/task-team?origin=all',null,tok); c('16.final-clear',r16,200,r=>tasksOf(r16).length===0);

console.log('\n========== '+pass+'/16 PASS, '+fail+' FAIL ==========');
process.exit(fail>0?1:0);
})();