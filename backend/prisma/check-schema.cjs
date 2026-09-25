const s = require('better-sqlite3');
const path = './prisma/prod.db';
const db = new s(path);

console.log('=== 当前表清单 ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
tables.forEach(t => console.log(' ', t.name));

console.log('\n=== User 表存在? ===');
const hasUser = tables.some(t => t.name === 'User');
console.log('  User:', hasUser);
if (hasUser) {
  const cols = db.prepare('PRAGMA table_info("User")').all();
  console.log('  列:', cols.map(c => c.name).join(', '));
}

console.log('\n=== Task 表存在? ===');
const hasTask = tables.some(t => t.name === 'Task');
console.log('  Task:', hasTask);
if (hasTask) {
  const cols = db.prepare('PRAGMA table_info("Task")').all();
  console.log('  列:', cols.map(c => c.name).join(', '));
}