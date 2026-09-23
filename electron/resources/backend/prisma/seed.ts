import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 开始种子数据初始化...')

  // 1. 创建/更新管理员账号
  // #14 修复：从 env 读取密码（轮换后的强随机值），upsert 时同步更新密码（确保已存在账号也能被新密码覆盖）
  const adminUsername = process.env.ADMIN_USERNAME || 'admin'
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword) {
    throw new Error('[seed] 缺少环境变量 ADMIN_PASSWORD，请在 .env 中配置强随机密码')
  }
  const adminPwd = await bcrypt.hash(adminPassword, 10)
  const admin = await prisma.user.upsert({
    where: { username: adminUsername },
    update: { password: adminPwd },
    create: {
      username: adminUsername,
      password: adminPwd,
      nickname: '系统管理员',
      role: 'admin',
      onboarded: true,
      preferredTone: 'professional',
      wallet: { create: { balance: 10000 } },
    },
  })
  console.log(`  ✓ 管理员账号已就绪: ${adminUsername}（密码已从 .env 注入，此处不打印明文）`)

  // 2. 创建演示用户
  // #14 修复：demo 账号原密码 123456 已暴露，改为随机密码（不打印明文，仅开发演示用）
  const demoPwd = await bcrypt.hash(crypto.randomBytes(12).toString('base64url'), 10)
  const demo = await prisma.user.upsert({
    where: { username: 'demo' },
    update: { password: demoPwd },
    create: {
      username: 'demo',
      password: demoPwd,
      nickname: '小明',
      role: 'user',
      onboarded: true,
      preferredTone: 'gentle',
      primaryGoal: '完成产品V3上线',
      wallet: { create: { balance: 158.50 } },
    },
  })
  console.log(`  ✓ 演示账号已就绪: demo（密码已随机化，如需登录请通过 admin 重置）`)

  // 3. 为演示用户创建示例数据
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const inThreeDays = new Date(now)
  inThreeDays.setDate(inThreeDays.getDate() + 3)
  const inTwelveDays = new Date(now)
  inTwelveDays.setDate(inTwelveDays.getDate() + 12)
  const inEightySixDays = new Date(now)
  inEightySixDays.setDate(inEightySixDays.getDate() + 86)

  await prisma.task.createMany({
    data: [
      {
        userId: demo.id,
        title: '产品方案V3评审',
        priority: 'urgent',
        progress: 75,
        dueDate: tomorrow,
        category: 'work',
        important: true,
      },
      {
        userId: demo.id,
        title: '客户演示准备',
        priority: 'high',
        progress: 30,
        dueDate: inThreeDays,
        category: 'work',
      },
      {
        userId: demo.id,
        title: '周报提交',
        priority: 'medium',
        progress: 0,
        dueDate: tomorrow,
        category: 'work',
      },
      {
        userId: demo.id,
        title: '产品上线',
        priority: 'high',
        progress: 60,
        dueDate: inTwelveDays,
        category: 'work',
        important: true,
      },
      {
        userId: demo.id,
        title: '买iPhone',
        priority: 'low',
        progress: 20,
        dueDate: inEightySixDays,
        category: 'finance',
      },
    ],
  })

  await prisma.diet.createMany({
    data: [
      {
        userId: demo.id,
        mealType: 'breakfast',
        foodName: '燕麦粥 + 鸡蛋',
        calories: 380,
        protein: 18,
        carbs: 55,
        fat: 8,
        eatenAt: new Date(now.getTime() - 3600000 * 4),
      },
      {
        userId: demo.id,
        mealType: 'lunch',
        foodName: '鸡胸肉沙拉',
        calories: 520,
        protein: 35,
        carbs: 30,
        fat: 18,
        eatenAt: new Date(now.getTime() - 3600000 * 1),
      },
    ],
  })

  await prisma.bill.createMany({
    data: [
      {
        userId: demo.id,
        type: 'expense',
        amount: 29.9,
        category: '购物',
        title: '暗夜主题皮肤',
        account: '微信',
        billDate: now,
      },
      {
        userId: demo.id,
        type: 'income',
        amount: 105,
        category: '充值',
        title: '微信充值',
        account: '微信',
        billDate: now,
      },
    ],
  })

  // 钱包交易记录
  const wallet = await prisma.wallet.findUnique({ where: { userId: demo.id } })
  if (wallet) {
    await prisma.transaction.createMany({
      data: [
        {
          walletId: wallet.id,
          userId: demo.id,
          type: 'recharge',
          amount: 105,
          balanceAfter: 158.5,
          title: '微信充值',
          status: 'success',
        },
        {
          walletId: wallet.id,
          userId: demo.id,
          type: 'consume',
          amount: 29.9,
          balanceAfter: 128.6,
          title: '暗夜主题皮肤',
          category: '购物',
          status: 'success',
        },
        {
          walletId: wallet.id,
          userId: demo.id,
          type: 'refund',
          amount: 5,
          balanceAfter: 158.5,
          title: '产品Bug奖励退还',
          status: 'success',
        },
      ],
    })
  }

  // 提醒
  const fifteenLater = new Date(now.getTime() + 15 * 60 * 1000)
  const twoHourLater = new Date(now.getTime() + 2 * 3600000)
  await prisma.reminder.createMany({
    data: [
      {
        userId: demo.id,
        title: '喝水提醒',
        content: '该补充水分啦',
        level: 'normal',
        remindAt: fifteenLater,
        repeat: 'daily',
      },
      {
        userId: demo.id,
        title: '产品方案评审',
        content: '15:00 会议室A',
        level: 'urgent',
        remindAt: twoHourLater,
        repeat: 'once',
        relatedType: 'task',
      },
    ],
  })

  // 创建一个默认对话会话
  const session = await prisma.chatSession.create({
    data: { userId: demo.id, title: '今日对话' },
  })
  await prisma.message.create({
    data: {
      sessionId: session.id,
      userId: demo.id,
      role: 'assistant',
      content: '早安！昨晚睡了7.2h，深度睡眠不错~ 今天的晨会我准备了3个要点，想听吗？',
      messageType: 'text',
    },
  })

  // 工作交接表演示数据
  // - 一份草稿（首页会展示提示）
  // - 一份已提交（供查看完整结构）
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  await prisma.handover.createMany({
    data: [
      {
        userId: demo.id,
        title: '8月3日工作交接（草稿）',
        shift: 'all-day',
        handoverDate: now,
        summary: '今日完成产品方案V3评审准备，处理客户演示材料初稿。整体进度符合预期。',
        completedItems: JSON.stringify([
          '完成产品方案V3评审材料',
          '修复登录页一处样式问题',
          '与客户对齐演示时间',
        ]),
        pendingItems: JSON.stringify([
          { text: '客户演示彩排', priority: 'high', dueDate: tomorrow.toISOString() },
          { text: '周报整理并提交', priority: 'medium' },
          { text: '跟进设计稿评审反馈', priority: 'low' },
        ]),
        notes: '客户演示在下午3点，请提前1小时到会议室A调试设备。',
        status: 'draft',
      },
      {
        userId: demo.id,
        title: '8月2日夜班交接',
        shift: 'night',
        handoverDate: yesterday,
        summary: '夜班处理了2个线上告警，均已定位并修复。监控无异常。',
        completedItems: JSON.stringify([
          '处理订单服务 502 告警（重启 + 日志排查）',
          '修复消息队列堆积问题',
        ]),
        pendingItems: JSON.stringify([
          { text: '跟进订单服务根因分析', priority: 'urgent', dueDate: tomorrow.toISOString() },
        ]),
        notes: '订单服务的 502 问题已临时恢复，但根因待定位，建议早班优先排查。',
        status: 'submitted',
        submittedAt: now,
      },
    ],
  })

  // 8. 社区示例帖子（让社区初始有内容，避免空状态）
  await prisma.post.createMany({
    data: [
      {
        userId: demo.id,
        content: '连续打卡100天了！每天坚持早起，从最难的"起床"开始改变，没想到真能坚持下来。分享给大家一句话：完成比完美重要。',
        category: 'life',
        aiSource: JSON.stringify({ name: '行为心理学研究', confidence: 92 }),
        likesCount: 234,
        commentsCount: 2,
      },
      {
        userId: admin.id,
        content: '减脂期一日三餐怎么搭配？分享我的经验：早餐高蛋白+复合碳水，午餐均衡，晚餐少碳水。关键是坚持记录！',
        category: 'life',
        aiSource: JSON.stringify({ name: '中国营养学会', confidence: 95 }),
        likesCount: 156,
        commentsCount: 1,
      },
      {
        userId: demo.id,
        content: '记账3年，终于攒下了人生第一个10万。方法很简单：每月发工资先存30%，剩下的再花。绿角犀帮我自动分类，省了好多时间。',
        category: 'finance',
        likesCount: 389,
        commentsCount: 0,
      },
      {
        userId: admin.id,
        content: '番茄工作法真的有用：25分钟专注 + 5分钟休息，一天能多完成3件事。任务多的时候特别管用。',
        category: 'work',
        likesCount: 98,
        commentsCount: 1,
      },
    ],
  })
  // 为第一条帖子（打卡100天）添加示例评论
  const checkinPost = await prisma.post.findFirst({ where: { content: { contains: '连续打卡' } } })
  if (checkinPost) {
    await prisma.comment.createMany({
      data: [
        { postId: checkinPost.id, userId: admin.id, content: '太厉害了！我也想坚持早起，求分享方法~' },
        { postId: checkinPost.id, userId: demo.id, content: '关键就是早睡，手机放客厅，闹钟放床头！' },
      ],
    })
  }
  console.log('  ✓ 社区示例帖子已创建')

  console.log('  ✓ 演示数据已创建')
  console.log('\n✅ 种子数据初始化完成')
  console.log('   管理员账号: admin（密码见 .env 中 ADMIN_PASSWORD）')
  console.log('   演示账号: demo（密码已随机化）\n')
}

main()
  .catch((e) => {
    console.error('❌ 种子数据初始化失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
