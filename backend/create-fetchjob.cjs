const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
    const args = process.argv.slice(2);
    const mode = args[0] || 'create';

    if (mode === 'create') {
        const userId = args[1];
        const inst = await p.execInstance.findFirst({
            where: { ownerId: userId, status: 'online' },
            include: { resourceZones: true },
        });
        if (!inst) { console.log('NO_INSTANCE'); await p.$disconnect(); return; }
        console.log('INSTANCE', inst.id, 'online=' + inst.status, 'hasToken=' + !!inst.token);

        let zone;
        if (inst.resourceZones.length > 0) {
            zone = inst.resourceZones[0];
            console.log('ZONE_EXISTS', zone.id);
        } else {
            const space = await p.space.findFirst({ where: { ownerId: userId } });
            if (!space) { console.log('NO_SPACE'); await p.$disconnect(); return; }
            zone = await p.resourceZone.create({
                data: { instanceId: inst.id, spaceId: space.id, sourcePath: 'C:\\Users\\Administrator\\Desktop', zoneName: '桌面测试', fetchScope: 'specified_zone' }
            });
            console.log('ZONE_CREATED', zone.id);
        }

        const job = await p.fetchJob.create({
            data: {
                instanceId: inst.id,
                resourceZoneId: zone.id,
                spaceId: zone.spaceId,
                requesterId: userId,
                status: 'pending',
                requireConfirm: true,
            }
        });
        console.log('JOB_CREATED', job.id);
    } else if (mode === 'list') {
        const jobs = await p.fetchJob.findMany({
            orderBy: { requestedAt: 'desc' },
            take: 5,
            include: { resourceZone: { select: { sourcePath: true } } },
        });
        jobs.forEach(x => console.log(x.id, x.status, 'result=' + x.resultCount, 'zone=' + (x.resourceZone?.sourcePath || '?').substring(0, 30), 'finished=' + x.finishedAt));
    }

    await p.$disconnect();
})();
