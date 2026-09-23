import { useEffect, useState } from 'react'
import { MapPin, Wind, Droplets, Sunrise, Sunset, RefreshCw, Eye, Gauge } from 'lucide-react'
import { api, unwrap } from '../../lib/api'

/**
 * WT-01 天气卡片组件（独立卡片版 · 纯白极简风）
 *
 * 设计：白底 + 浅灰边框 + 深色文字，作为首页独立卡片区块
 * 风格对齐 Notion / Apple Settings：去除所有彩色渐变，仅用黑白灰 + 橙黄强调
 *
 * 数据来源：GET /home/weather?lat=xxx&lon=xxx
 * - 优先使用 navigator.geolocation 获取经纬度
 * - 失败时使用 IP 定位（由 wttr.in 默认行为）
 * - 失败时静默隐藏，不影响首页其他模块
 *
 * 缓存：服务端 10 分钟缓存 + 客户端 sessionStorage 简单缓存
 */

interface WeatherData {
  location: string
  region: string
  country: string
  current: {
    tempC: number
    feelsLikeC: number
    humidity: number
    windSpeedKmph: number
    windDir: string
    weatherCode: number
    weatherDesc: string
    weatherIcon: string
    uvIndex: number
    visibility: number
    pressure: number
    cloudcover: number
    isDay: boolean
  }
  today: {
    date: string
    maxTempC: number
    minTempC: number
    avgTempC: number
    sunrise: string
    sunset: string
    maxUvIndex: number
    hourly: Array<{
      time: string
      tempC: number
      weatherCode: number
      weatherDesc: string
      chanceOfRain: number
    }>
  }
  source: string
  fetchedAt: string
}

const SESSION_CACHE_KEY = 'home_weather_cache'
const SESSION_CACHE_TTL = 10 * 60 * 1000 // 10 分钟

/** UV 等级评估（橙黄色系内分级） */
function getUvLevel(uv: number): { label: string; textClass: string } {
  if (uv <= 2) return { label: '弱', textClass: 'text-gray-500' }
  if (uv <= 5) return { label: '中等', textClass: 'text-amber-600' }
  if (uv <= 7) return { label: '强', textClass: 'text-orange-600' }
  if (uv <= 10) return { label: '很强', textClass: 'text-red-600' }
  return { label: '极强', textClass: 'text-red-700' }
}

/** 获取当前小时附近的 hourly 索引 */
function getCurrentHourlyIndex(hourly: WeatherData['today']['hourly']): number {
  const nowHour = new Date().getHours()
  let closestIdx = 0
  let closestDiff = 24
  hourly.forEach((h, idx) => {
    const hHour = Number(h.time.split(':')[0])
    const diff = Math.abs(hHour - nowHour)
    if (diff < closestDiff) {
      closestDiff = diff
      closestIdx = idx
    }
  })
  return closestIdx
}

/** 天气背景渐变：根据 weatherCode 和昼夜返回 Tailwind 渐变色（对标墨迹天气沉浸式背景） */
function getWeatherBg(code: number, isDay: boolean): string {
  const type = getWeatherType(code)
  if (!isDay && type === 'sunny') return 'from-indigo-700 via-blue-800 to-slate-900'
  if (type === 'sunny') return 'from-sky-400 via-sky-500 to-blue-600'
  if (type === 'cloudy') return isDay
    ? 'from-sky-300 via-blue-400 to-slate-500'
    : 'from-slate-600 via-slate-700 to-slate-900'
  if (type === 'overcast') return 'from-gray-400 via-gray-500 to-slate-600'
  if (type === 'rainy') return 'from-slate-400 via-slate-500 to-slate-700'
  if (type === 'thunder') return 'from-slate-600 via-slate-700 to-gray-900'
  if (type === 'snowy') return 'from-blue-200 via-indigo-300 to-slate-400'
  if (type === 'foggy') return 'from-gray-300 via-gray-400 to-slate-500'
  return 'from-sky-400 to-blue-600'
}

export default function WeatherCard() {
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(false)

    // 1. 非强制刷新时优先读取 sessionStorage 缓存
    if (!forceRefresh) {
      try {
        const cached = sessionStorage.getItem(SESSION_CACHE_KEY)
        if (cached) {
          const parsed = JSON.parse(cached) as { data: WeatherData; ts: number }
          if (Date.now() - parsed.ts < SESSION_CACHE_TTL) {
            setWeather(parsed.data)
            setLoading(false)
            return
          }
        }
      } catch {
        // 缓存解析失败忽略
      }
    }

    // 2. 获取经纬度（失败时仍请求，让后端走 IP 定位）
    let lat = 39.9 // 默认北京
    let lon = 116.4
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('no geolocation'))
          return
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 3000,
          maximumAge: 5 * 60 * 1000,
        })
      })
      lat = position.coords.latitude
      lon = position.coords.longitude
    } catch {
      // 定位失败：使用默认坐标（北京）
    }

    // 3. 调用后端获取天气
    try {
      const data = await unwrap<WeatherData>(
        api.get(`/home/weather?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`),
      )
      setWeather(data)
      try {
        sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }))
      } catch {
        // sessionStorage 写入失败忽略
      }
    } catch (err) {
      setError(true)
      console.warn('[WeatherCard] 获取天气失败:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // 加载中：渐变背景骨架（对标墨迹天气沉浸式风格）
  if (loading) {
    return (
      <div className="rounded-2xl overflow-hidden shadow-lg shadow-black/5 animate-pulse">
        <div className="bg-gradient-to-br from-sky-400 to-blue-600 h-36" />
        <div className="bg-white h-20" />
      </div>
    )
  }

  // 失败且无数据：渐变背景错误条
  if (error && !weather) {
    return (
      <div className="rounded-2xl overflow-hidden shadow-lg shadow-black/5">
        <div className="bg-gradient-to-br from-slate-400 to-slate-600 text-white px-4 py-5">
          <div className="flex items-center gap-1.5 text-xs">
            <MapPin size={12} className="opacity-80" />
            <span className="font-medium">天气获取失败</span>
          </div>
          <button
            onClick={() => load(true)}
            className="mt-3 bg-white/20 backdrop-blur rounded-lg px-4 py-1.5 text-xs hover:bg-white/30 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> 点击重试
          </button>
        </div>
      </div>
    )
  }

  if (!weather) return null

  const { current, today, location } = weather
  const uv = getUvLevel(current.uvIndex)
  const currentHourlyIdx = getCurrentHourlyIndex(today.hourly)
  const upcomingHours = [
    ...today.hourly.slice(currentHourlyIdx),
    ...today.hourly.slice(0, currentHourlyIdx),
  ].slice(0, 8)
  const weatherBg = getWeatherBg(current.weatherCode, current.isDay)

  return (
    <div className="rounded-2xl overflow-hidden shadow-lg shadow-black/5">
        {/* === 主天气区：沉浸式渐变背景（对标墨迹天气） === */}
        <div className={`relative bg-gradient-to-br ${weatherBg} text-white px-4 pt-4 pb-5 overflow-hidden`}>
          {/* 天气动效层（半透明背景装饰） */}
          <div className="absolute inset-0 opacity-20 pointer-events-none">
            <WeatherAnimation weatherCode={current.weatherCode} isDay={current.isDay} />
          </div>

          {/* 装饰大 emoji */}
          <div
            className="absolute -right-3 -bottom-3 text-8xl opacity-10 select-none"
            style={{ animation: 'float 6s ease-in-out infinite' }}
          >
            {current.weatherIcon}
          </div>

          <div className="relative">
            {/* 位置 + 刷新 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 text-xs">
                <MapPin size={12} className="opacity-80" />
                <span className="truncate max-w-[140px] font-medium">{location}</span>
              </div>
              <button
                onClick={() => load(true)}
                disabled={refreshing}
                className="p-1.5 rounded-full bg-white/15 backdrop-blur hover:bg-white/25 transition-colors disabled:opacity-50"
                aria-label="刷新天气"
              >
                <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* 大号温度（墨迹天气风格：超大数字 + 天气图标） */}
            <div className="mt-3 flex items-start gap-2">
              <div className="text-5xl leading-none mt-1">{current.weatherIcon}</div>
              <div className="flex items-start">
                <span className="text-7xl font-thin tabular-nums leading-none">{current.tempC}</span>
                <span className="text-3xl font-thin mt-1">°</span>
              </div>
            </div>

            {/* 天气描述 + 温度区间 */}
            <div className="mt-2 flex items-center gap-3 text-sm">
              <span className="font-medium">{current.weatherDesc}</span>
              <span className="opacity-70">{today.minTempC}° / {today.maxTempC}°</span>
            </div>
            <div className="text-xs opacity-70 mt-0.5">
              体感 {current.feelsLikeC}° · {current.windDir} {current.windSpeedKmph}km/h
            </div>
          </div>
        </div>

        {/* === 24小时预报条 === */}
        <div className="bg-white px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-gray-400 font-medium">24小时预报</span>
            <span className="text-[10px] text-gray-300">{today.sunrise} → {today.sunset}</span>
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {upcomingHours.map((h, idx) => (
              <div
                key={idx}
                className={`flex flex-col items-center gap-1 flex-shrink-0 min-w-[42px] rounded-lg py-1.5 ${
                  idx === 0 ? 'bg-primary-50' : ''
                }`}
              >
                <span className="text-[10px] text-gray-400">{idx === 0 ? '现在' : h.time}</span>
                <span className="text-lg leading-none">{getWeatherEmoji(h.weatherCode)}</span>
                <span className="text-xs font-semibold tabular-nums text-gray-700">{h.tempC}°</span>
                {h.chanceOfRain > 30 ? (
                  <span className="text-[9px] text-blue-500">{h.chanceOfRain}%</span>
                ) : (
                  <span className="text-[9px] text-transparent">·</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* === 生活指数网格（风速/湿度/能见度/气压） === */}
        <div className="bg-white px-4 py-3 border-t border-gray-50">
          <div className="grid grid-cols-4 gap-2">
            <div className="flex flex-col items-center gap-0.5">
              <Wind size={14} className="text-gray-400" />
              <span className="text-[9px] text-gray-400">风速</span>
              <span className="text-xs font-medium text-gray-700">
                {current.windSpeedKmph}
                <span className="text-[9px] text-gray-400 ml-0.5">km/h</span>
              </span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <Droplets size={14} className="text-gray-400" />
              <span className="text-[9px] text-gray-400">湿度</span>
              <span className="text-xs font-medium text-gray-700">
                {current.humidity}
                <span className="text-[9px] text-gray-400 ml-0.5">%</span>
              </span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <Eye size={14} className="text-gray-400" />
              <span className="text-[9px] text-gray-400">能见度</span>
              <span className="text-xs font-medium text-gray-700">
                {current.visibility}
                <span className="text-[9px] text-gray-400 ml-0.5">km</span>
              </span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <Gauge size={14} className="text-gray-400" />
              <span className="text-[9px] text-gray-400">气压</span>
              <span className="text-xs font-medium text-gray-700">
                {current.pressure}
                <span className="text-[9px] text-gray-400 ml-0.5">hPa</span>
              </span>
            </div>
          </div>
        </div>

        {/* === 紫外线 + 日出日落 === */}
        <div className="bg-white px-4 py-3 border-t border-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sunrise size={14} className="text-amber-400" />
            <span className="text-xs text-gray-500">{today.sunrise}</span>
            <span className="text-[10px] text-gray-300 mx-1">·</span>
            <Sunset size={14} className="text-orange-400" />
            <span className="text-xs text-gray-500">{today.sunset}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-400">紫外线</span>
            <span className={`text-xs font-medium ${uv.textClass}`}>
              {current.uvIndex} · {uv.label}
            </span>
          </div>
        </div>
      </div>
  )
}

/** 通过 weatherCode 获取 emoji（与后端一致，支持日夜区分） */
function getWeatherEmoji(code: number, isDay: boolean = true): string {
  // 夜间晴朗/多云使用月亮图标
  if (!isDay) {
    if (code === 113) return '🌙'
    if (code === 116) return '☁️'
  }
  const map: Record<number, string> = {
    113: '☀️', 116: '⛅', 119: '☁️', 122: '☁️', 143: '🌫️',
    176: '🌦️', 179: '🌨️', 182: '🌨️', 185: '🌨️', 200: '⛈️',
    227: '🌨️', 230: '❄️', 248: '🌫️', 260: '🌫️', 263: '🌦️',
    266: '🌦️', 281: '🌧️', 284: '🌧️', 293: '🌦️', 296: '🌦️',
    299: '🌧️', 302: '🌧️', 305: '🌧️', 308: '🌧️', 311: '🌧️',
    314: '🌧️', 317: '🌨️', 320: '🌨️', 323: '🌨️', 326: '🌨️',
    329: '❄️', 332: '❄️', 335: '❄️', 338: '❄️', 350: '🌧️',
    353: '🌦️', 356: '🌧️', 359: '🌧️', 362: '🌨️', 365: '🌨️',
    368: '🌨️', 371: '❄️', 374: '🌨️', 377: '🌨️', 386: '⛈️',
    389: '⛈️', 392: '🌨️', 395: '🌨️',
  }
  return map[code] || '🌡️'
}

/** 根据 weatherCode 判断天气类型（用于动效渲染） */
function getWeatherType(
  code: number,
): 'sunny' | 'cloudy' | 'overcast' | 'rainy' | 'thunder' | 'snowy' | 'foggy' {
  if (code === 113) return 'sunny'
  if (code === 116) return 'cloudy'
  if (code === 119 || code === 122) return 'overcast'
  if (code === 200 || code === 386 || code === 389) return 'thunder'
  if (
    [179, 182, 185, 227, 230, 320, 323, 326, 329, 332, 335, 338, 362, 365, 368, 371, 374, 377, 392, 395].includes(
      code,
    )
  )
    return 'snowy'
  if (
    [176, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314, 317, 350, 353, 356, 359].includes(code)
  )
    return 'rainy'
  if ([143, 248, 260].includes(code)) return 'foggy'
  return 'sunny'
}

/** 晴天（白天）动效：旋转发光太阳 + 光线辐射 */
function SunnyAnimation() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-amber-100 to-orange-50">
      <div className="relative w-10 h-10">
        <div
          className="absolute inset-0 rounded-full bg-gradient-to-br from-yellow-300 to-orange-400"
          style={{ animation: 'spin-slow 8s linear infinite, pulse-glow 2s ease-in-out infinite' }}
        />
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="absolute top-1/2 left-1/2 origin-left"
            style={{
              width: '20px',
              height: '2px',
              background: 'linear-gradient(to right, rgba(251,191,36,0.6), transparent)',
              transform: `rotate(${i * 45}deg) translateX(8px)`,
              animation: 'sun-ray 8s linear infinite',
              animationDelay: `${i * 0.1}s`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

/** 晴天（夜间）动效：月亮 + 闪烁星星 */
function NightAnimation() {
  return (
    <div className="absolute inset-0 bg-gradient-to-b from-indigo-900 to-slate-800 overflow-hidden flex items-center justify-center">
      <div className="text-2xl" style={{ animation: 'float 4s ease-in-out infinite' }}>
        🌙
      </div>
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="absolute text-[8px] text-yellow-200"
          style={{
            left: `${15 + i * 18}%`,
            top: `${20 + (i % 2) * 30}%`,
            animation: `twinkle ${1.5 + i * 0.3}s ease-in-out infinite`,
            animationDelay: `${i * 0.2}s`,
          }}
        >
          ⭐
        </div>
      ))}
    </div>
  )
}

/** 多云动效：太阳/月亮 + 飘动云朵 */
function CloudyAnimation({ isDay }: { isDay: boolean }) {
  return (
    <div className="absolute inset-0 bg-gradient-to-b from-sky-50 to-slate-50 overflow-hidden flex items-center">
      {isDay && (
        <div
          className="absolute left-4 w-8 h-8 rounded-full bg-gradient-to-br from-yellow-300 to-orange-300"
          style={{ animation: 'pulse-glow 3s ease-in-out infinite' }}
        />
      )}
      <div
        className="absolute text-2xl"
        style={{ left: '40%', animation: 'cloud-drift 8s ease-in-out infinite' }}
      >
        ☁️
      </div>
      <div
        className="absolute text-xl opacity-70"
        style={{ left: '70%', animation: 'cloud-drift 10s ease-in-out infinite', animationDelay: '2s' }}
      >
        ☁️
      </div>
    </div>
  )
}

/** 阴天动效：灰色云层缓慢移动 */
function OvercastAnimation() {
  return (
    <div className="absolute inset-0 bg-gradient-to-b from-gray-200 to-gray-100 overflow-hidden flex items-center">
      <div
        className="absolute text-2xl opacity-60"
        style={{ left: '30%', animation: 'cloud-drift 12s ease-in-out infinite' }}
      >
        ☁️
      </div>
      <div
        className="absolute text-xl opacity-50"
        style={{ left: '60%', animation: 'cloud-drift 15s ease-in-out infinite', animationDelay: '3s' }}
      >
        ☁️
      </div>
    </div>
  )
}

/** 雨天动效：雨滴下落 */
function RainAnimation() {
  return (
    <div className="absolute inset-0 bg-gradient-to-b from-slate-200 to-slate-100 overflow-hidden">
      {[...Array(15)].map((_, i) => (
        <div
          key={i}
          className="absolute w-0.5 h-4 bg-blue-300/60 rounded-full"
          style={{
            left: `${5 + i * 6.5}%`,
            top: '-10px',
            animation: `rain-fall ${0.6 + (i % 3) * 0.2}s linear infinite`,
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </div>
  )
}

/** 雷暴动效：闪电 + 雨滴 */
function ThunderAnimation() {
  return (
    <div className="absolute inset-0 bg-gradient-to-b from-slate-300 to-slate-200 overflow-hidden">
      {[...Array(15)].map((_, i) => (
        <div
          key={i}
          className="absolute w-0.5 h-4 bg-blue-400/60 rounded-full"
          style={{
            left: `${5 + i * 6.5}%`,
            top: '-10px',
            animation: `rain-fall ${0.5 + (i % 3) * 0.2}s linear infinite`,
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
      <div className="absolute inset-0 bg-white" style={{ animation: 'flash 3s ease-in-out infinite' }} />
    </div>
  )
}

/** 雪天动效：雪花飘落 */
function SnowAnimation() {
  return (
    <div className="absolute inset-0 bg-gradient-to-b from-blue-50 to-slate-50 overflow-hidden">
      {[...Array(12)].map((_, i) => (
        <div
          key={i}
          className="absolute text-sm"
          style={{
            left: `${5 + i * 8}%`,
            top: '-10px',
            animation: `snow-fall ${3 + (i % 3) * 1}s linear infinite`,
            animationDelay: `${i * 0.3}s`,
          }}
        >
          ❄
        </div>
      ))}
    </div>
  )
}

/** 雾天动效：雾气浮动 */
function FogAnimation() {
  return (
    <div className="absolute inset-0 bg-gradient-to-b from-gray-100 to-gray-50 overflow-hidden">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="absolute w-full h-4 bg-white/30 rounded-full blur-sm"
          style={{
            top: `${15 + i * 20}%`,
            animation: `fog-drift ${6 + i * 2}s ease-in-out infinite`,
            animationDelay: `${i * 0.5}s`,
          }}
        />
      ))}
    </div>
  )
}

/** 天气形象动效容器：根据 weatherCode 与 isDay 渲染对应动画 */
function WeatherAnimation({ weatherCode, isDay }: { weatherCode: number; isDay: boolean }) {
  const weatherType = getWeatherType(weatherCode)
  return (
    <div className="relative h-16 overflow-hidden rounded-xl mb-2">
      {weatherType === 'sunny' && isDay && <SunnyAnimation />}
      {weatherType === 'sunny' && !isDay && <NightAnimation />}
      {weatherType === 'cloudy' && <CloudyAnimation isDay={isDay} />}
      {weatherType === 'overcast' && <OvercastAnimation />}
      {weatherType === 'rainy' && <RainAnimation />}
      {weatherType === 'thunder' && <ThunderAnimation />}
      {weatherType === 'snowy' && <SnowAnimation />}
      {weatherType === 'foggy' && <FogAnimation />}
    </div>
  )
}
