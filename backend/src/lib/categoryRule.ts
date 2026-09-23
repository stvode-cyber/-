import { prisma } from './prisma.js'
import type { CategoryRuleInput } from './classifyAsset.js'

/**
 * 加载某空间的分类自定义映射规则（仅启用项），按 priority 降序返回，
 * 供 classifyAsset 在上传/同步/重算时注入。零额外依赖，纯 DB 读取。
 */
export async function loadCategoryRules(spaceId: string): Promise<CategoryRuleInput[]> {
  const rows = await prisma.categoryRule.findMany({
    where: { spaceId, enabled: true },
    orderBy: { priority: 'desc' },
  })
  return rows.map((r) => ({
    matchType: r.matchType as CategoryRuleInput['matchType'],
    pattern: r.pattern,
    targetCategory: r.targetCategory,
    priority: r.priority,
    enabled: r.enabled,
  }))
}
