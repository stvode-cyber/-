import { useState, useMemo, useCallback } from 'react'
import {
  ChefHat, Plus, Trash2, X, Heart, Search, ChevronLeft, Clock, Users, Flame, BookOpen,
} from 'lucide-react'
import {
  getRecipesByCategory, searchRecipes, getRecipeStat,
  addCustomRecipe, deleteCustomRecipe, toggleFavorite, isFavorite,
  CATEGORY_META, DIFFICULTY_META,
  type Recipe, type RecipeCategory, type Difficulty,
} from '../lib/recipeStore'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'

/**
 * 菜谱收藏页
 *
 * 视图：
 * 1. 列表视图：分类筛选 + 搜索 + 网格
 * 2. 详情视图：单菜谱完整步骤
 * 3. 添加自定义菜谱弹窗
 */

const TAB_OPTIONS: { key: RecipeCategory | 'all' | 'favorite'; label: string; emoji: string }[] = [
  { key: 'all', label: '全部', emoji: '📚' },
  { key: 'favorite', label: '收藏', emoji: '❤️' },
  ...(Object.keys(CATEGORY_META) as RecipeCategory[]).map((c) => ({
    key: c,
    label: CATEGORY_META[c].label,
    emoji: CATEGORY_META[c].emoji,
  })),
]

export default function RecipePage() {
  const toast = useToast((s) => s.show)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<RecipeCategory | 'all' | 'favorite'>('all')
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const recipes = useMemo(() => {
    if (search.trim()) return searchRecipes(search)
    return getRecipesByCategory(tab)
  }, [tab, search, version])

  const stat = useMemo(() => getRecipeStat(), [version])

  const favSet = useMemo(() => {
    const map = new Set<string>()
    recipes.forEach((r) => { if (isFavorite(r.id)) map.add(r.id) })
    return map
  }, [recipes, version])

  const selected = useMemo(
    () => selectedId ? getRecipesByCategory('all').find((r) => r.id === selectedId) || null : null,
    [selectedId, version],
  )

  const handleOpen = useCallback((id: string) => {
    setSelectedId(id)
    setView('detail')
  }, [])

  const handleBack = useCallback(() => {
    setView('list')
    setSelectedId(null)
  }, [])

  const handleFavorite = useCallback((r: Recipe) => {
    const was = isFavorite(r.id)
    toggleFavorite(r.id)
    toast(was ? '已取消收藏' : '已收藏 ❤️', was ? 'info' : 'success')
    refresh()
  }, [toast, refresh])

  const handleDelete = useCallback((r: Recipe) => {
    if (r.source !== 'custom') return
    deleteCustomRecipe(r.id)
    toast(`已删除《${r.name}》`, 'info')
    refresh()
  }, [toast, refresh])

  const handleAdd = useCallback((data: Omit<Recipe, 'id' | 'source' | 'createdAt'>) => {
    addCustomRecipe(data)
    toast(`已添加《${data.name}》`, 'success')
    setShowAdd(false)
    refresh()
  }, [toast, refresh])

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {view === 'list' ? (
          <>
            {/* 顶栏 */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <ChefHat size={22} className="text-orange-500" /> 菜谱收藏
                </h1>
                <p className="text-xs text-gray-400 mt-0.5">
                  共 {stat.total} 道 · 收藏 {stat.favorites} · 自定义 {stat.custom}
                </p>
              </div>
              <button
                onClick={() => setShowAdd(true)}
                className="px-3 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 active:scale-95 transition-all flex items-center gap-1"
              >
                <Plus size={15} /> 添加
              </button>
            </div>

            {/* 搜索框 */}
            <div className="relative mb-3">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜菜名、食材或标签"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-orange-400 bg-white"
              />
            </div>

            {/* 分类筛选 Tab */}
            <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
              {TAB_OPTIONS.map((opt) => {
                const active = tab === opt.key
                const count = opt.key === 'all' ? stat.total : opt.key === 'favorite' ? stat.favorites : undefined
                return (
                  <button
                    key={opt.key}
                    onClick={() => setTab(opt.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all whitespace-nowrap ${
                      active ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    <span>{opt.emoji}</span>
                    {opt.label}
                    {count !== undefined && (
                      <span className={`tabular-nums ${active ? 'text-white/70' : 'text-gray-400'}`}>{count}</span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* 菜谱网格 */}
            {recipes.length === 0 ? (
              <div className="card p-8 text-center">
                <div className="text-2xl mb-1.5">{search ? '🔍' : '🍳'}</div>
                <p className="text-xs text-gray-400">
                  {search ? '没有匹配的菜谱' : '该分类暂无菜谱'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {recipes.map((r) => {
                  const meta = CATEGORY_META[r.category]
                  const diffMeta = DIFFICULTY_META[r.difficulty]
                  const fav = favSet.has(r.id)
                  return (
                    <div
                      key={r.id}
                      onClick={() => handleOpen(r.id)}
                      className="card p-4 cursor-pointer group hover:shadow-md transition-shadow"
                      style={{ borderLeft: `3px solid ${meta.color}` }}
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-base">{meta.emoji}</span>
                        <span className="text-[10px] font-medium" style={{ color: meta.color }}>{meta.label}</span>
                        {r.source === 'custom' && (
                          <span className="text-[9px] rounded-full px-1.5 py-0.5 bg-orange-50 text-orange-500">自定义</span>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleFavorite(r) }}
                          className="ml-auto p-1.5 rounded-lg transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                          style={fav ? { color: '#EF4444' } : { color: 'rgb(209,213,219)' }}
                        >
                          <Heart size={13} className={fav ? 'fill-current' : ''} />
                        </button>
                      </div>
                      <h3 className="text-sm font-bold text-gray-800 mb-1">{r.name}</h3>
                      <p className="text-xs text-gray-500 mb-2 line-clamp-2 leading-relaxed">{r.desc}</p>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400">
                        <span className="flex items-center gap-0.5">
                          <Clock size={11} /> {r.cookTime}分
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Users size={11} /> {r.servings}人
                        </span>
                        <span style={{ color: diffMeta.color }}>
                          {r.difficulty === 'easy' ? '简单' : r.difficulty === 'medium' ? '中等' : '困难'}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <button
              onClick={handleBack}
              className="flex items-center gap-1 text-xs text-gray-500 mb-3 hover:text-orange-600"
            >
              <ChevronLeft size={16} /> 返回列表
            </button>

            {selected ? (
              <RecipeDetail recipe={selected} onFavorite={handleFavorite} onDelete={handleDelete} />
            ) : (
              <div className="card p-8 text-center text-xs text-gray-400">菜谱不存在或已删除</div>
            )}
          </>
        )}
      </div>

      {showAdd && (
        <RecipeModal onClose={() => setShowAdd(false)} onSave={handleAdd} />
      )}
    </div>
  )
}

// ===== 菜谱详情 =====

function RecipeDetail({ recipe, onFavorite, onDelete }: {
  recipe: Recipe
  onFavorite: (r: Recipe) => void
  onDelete: (r: Recipe) => void
}) {
  const meta = CATEGORY_META[recipe.category]
  const diffMeta = DIFFICULTY_META[recipe.difficulty]
  const fav = isFavorite(recipe.id)

  return (
    <div
      className="rounded-2xl overflow-hidden mb-4"
      style={{
        background: `linear-gradient(135deg, ${meta.color}20 0%, ${meta.color}08 100%)`,
        border: `1px solid ${meta.color}30`,
      }}
    >
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">{meta.emoji}</span>
          <span className="text-xs font-medium" style={{ color: meta.color }}>{meta.label}</span>
          {recipe.source === 'custom' && (
            <span className="text-[10px] rounded-full px-2 py-0.5 bg-orange-100 text-orange-600">自定义</span>
          )}
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">{recipe.name}</h2>
        <p className="text-sm text-gray-600 mb-3">{recipe.desc}</p>

        <div className="flex flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-1 text-gray-600">
            <Clock size={14} style={{ color: meta.color }} />
            {recipe.cookTime} 分钟
          </div>
          <div className="flex items-center gap-1 text-gray-600">
            <Users size={14} style={{ color: meta.color }} />
            {recipe.servings} 人份
          </div>
          <div className="flex items-center gap-1" style={{ color: diffMeta.color }}>
            <Flame size={14} />
            {diffMeta.label}
          </div>
        </div>

        {recipe.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {recipe.tags.map((t) => (
              <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-white/70" style={{ color: meta.color }}>
                #{t}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => onFavorite(recipe)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1 transition ${
              fav ? 'bg-rose-50 text-rose-500' : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            <Heart size={14} className={fav ? 'fill-current' : ''} />
            {fav ? '已收藏' : '收藏'}
          </button>
          {recipe.source === 'custom' && (
            <button
              onClick={() => onDelete(recipe)}
              className="p-2 rounded-lg bg-white text-gray-400 hover:text-rose-500 hover:bg-rose-50 border border-gray-200"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 食材 */}
      <div className="px-5 pb-5 bg-white/40">
        <h3 className="text-sm font-semibold text-gray-700 mb-2.5 mt-1 flex items-center gap-1.5">
          <BookOpen size={15} style={{ color: meta.color }} /> 食材清单
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {recipe.ingredients.map((ing, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-gray-700 py-1.5 px-2 rounded bg-white/70">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
              {ing}
            </div>
          ))}
        </div>
      </div>

      {/* 步骤 */}
      <div className="px-5 pb-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-2.5 flex items-center gap-1.5">
          <Flame size={15} style={{ color: meta.color }} /> 烹饪步骤
        </h3>
        <ol className="space-y-2.5">
          {recipe.steps.map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                style={{ background: meta.color }}
              >
                {i + 1}
              </div>
              <p className="text-sm text-gray-700 leading-relaxed pt-0.5">{step}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

// ===== 添加菜谱弹窗 =====

const CATEGORY_LIST = Object.keys(CATEGORY_META) as RecipeCategory[]
const DIFFICULTY_LIST: Difficulty[] = ['easy', 'medium', 'hard']

function RecipeModal({ onClose, onSave }: {
  onClose: () => void
  onSave: (data: Omit<Recipe, 'id' | 'source' | 'createdAt'>) => void
}) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [category, setCategory] = useState<RecipeCategory>('meat')
  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  const [cookTime, setCookTime] = useState('15')
  const [servings, setServings] = useState('2')
  const [ingredients, setIngredients] = useState('')
  const [steps, setSteps] = useState('')
  const [tags, setTags] = useState('')

  const valid = name.trim().length >= 1 && ingredients.trim().length >= 4 && steps.trim().length >= 4

  const submit = () => {
    if (!valid) return
    onSave({
      name: name.trim(),
      desc: desc.trim() || '自定义菜谱',
      category,
      difficulty,
      cookTime: parseInt(cookTime, 10) || 15,
      servings: parseInt(servings, 10) || 2,
      ingredients: ingredients.split(/\n/).map((s) => s.trim()).filter(Boolean),
      steps: steps.split(/\n/).map((s) => s.trim()).filter(Boolean),
      tags: tags.split(/[,，#\s]+/).map((t) => t.trim()).filter(Boolean),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between sticky top-0 bg-white z-10">
          <span className="font-semibold text-sm flex items-center gap-1.5">
            <ChefHat size={15} className="text-orange-500" /> 添加菜谱
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3.5">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">菜名 *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={30}
              placeholder="如：青椒土豆丝"
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-orange-400"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">简介</label>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              maxLength={50}
              placeholder="一句话描述"
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-orange-400"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">时长(分)</label>
              <input
                value={cookTime}
                onChange={(e) => setCookTime(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                className="w-full px-3 py-2 rounded-lg text-sm border border-gray-200 outline-none focus:border-orange-400"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">人份</label>
              <input
                value={servings}
                onChange={(e) => setServings(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                className="w-full px-3 py-2 rounded-lg text-sm border border-gray-200 outline-none focus:border-orange-400"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">难度</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                className="w-full px-2 py-2 rounded-lg text-sm border border-gray-200 outline-none focus:border-orange-400 bg-white"
              >
                {DIFFICULTY_LIST.map((d) => <option key={d} value={d}>{DIFFICULTY_META[d].label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">分类</label>
            <div className="grid grid-cols-4 gap-1.5">
              {CATEGORY_LIST.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`py-2 rounded-lg text-[11px] border transition flex items-center justify-center gap-1 ${
                    category === c ? 'border-orange-400 bg-orange-50 font-semibold' : 'border-gray-200 text-gray-500'
                  }`}
                  style={category === c ? { color: CATEGORY_META[c].color } : {}}
                >
                  <span>{CATEGORY_META[c].emoji}</span>
                  {CATEGORY_META[c].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">食材（每行一项）*</label>
            <textarea
              value={ingredients}
              onChange={(e) => setIngredients(e.target.value)}
              rows={4}
              placeholder={'主料适量\n辅料适量\n调料适量'}
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-orange-400 resize-none"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">步骤（每行一步）*</label>
            <textarea
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              rows={5}
              placeholder={'第一步…\n第二步…\n第三步…'}
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-orange-400 resize-none"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">标签</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              maxLength={100}
              placeholder="如：家常, 快手, 辣"
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-orange-400"
            />
          </div>
        </div>

        <div className="border-t border-gray-100 px-5 py-3 flex gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className="flex-1 py-2.5 text-sm rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  )
}
