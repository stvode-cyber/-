cp /root/backend/prisma/prod.db /root/backend/prisma/prod.db.bak-pm-latest
sqlite3 /root/backend/prisma/prod.db < /tmp/migrate-pm.sql
echo sql_exit: $?
sqlite3 /root/backend/prisma/prod.db .tables | tr ' ' '\n' | grep pm_