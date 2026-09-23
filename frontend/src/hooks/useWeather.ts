import { useEffect, useState, useCallback } from 'react'
import { api, unwrap } from '../lib/api'

/** 天气数据结构 */
export interface WeatherData {
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

/** 根据 weatherCode 判断天气类型 */
export function getWeatherType(
  code: number,
): 'sunny' | 'cloudy' | 'overcast' | 'rainy' | 'thunder' | 'snowy' | 'foggy' {
  if (code === 113) return 'sunny'
  if (code === 116) return 'cloudy'
  if (code === 119 || code === 122) return 'overcast'
  if (code === 200 || code === 386 || code === 389) return 'thunder'
  if (
    [179, 182, 185, 227, 230, 320, 323, 326, 329, 332, 335, 338, 362, 365, 368, 371, 374, 377, 392, 395].includes(code)
  )
    return 'snowy'
  if (
    [176, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314, 317, 350, 353, 356, 359].includes(code)
  )
    return 'rainy'
  if ([143, 248, 260].includes(code)) return 'foggy'
  return 'sunny'
}

/** 天气背景渐变：根据 weatherCode 和昼夜返回 Tailwind 渐变色 */
export function getWeatherBg(code: number, isDay: boolean): string {
  const type = getWeatherType(code)
  if (!isDay && type === 'sunny') return 'from-indigo-700 via-blue-800 to-slate-900'
  if (type === 'sunny') return 'from-sky-400 via-sky-500 to-blue-600'
  if (type === 'cloudy')
    return isDay
      ? 'from-sky-300 via-blue-400 to-slate-500'
      : 'from-slate-600 via-slate-700 to-slate-900'
  if (type === 'overcast') return 'from-gray-400 via-gray-500 to-slate-600'
  if (type === 'rainy') return 'from-slate-400 via-slate-500 to-slate-700'
  if (type === 'thunder') return 'from-slate-600 via-slate-700 to-gray-900'
  if (type === 'snowy') return 'from-blue-200 via-indigo-300 to-slate-400'
  if (type === 'foggy') return 'from-gray-300 via-gray-400 to-slate-500'
  return 'from-sky-400 to-blue-600'
}

/** 天气景图：根据 weatherCode 和昼夜返回对应场景图 URL */
export function getWeatherImage(code: number, isDay: boolean): string {
  const type = getWeatherType(code)
  if (!isDay && type === 'sunny') return '/weather-bg/night.jpg'
  if (type === 'sunny') return '/weather-bg/sunny.jpg'
  if (type === 'cloudy' || type === 'overcast' || type === 'foggy') return '/weather-bg/cloudy.jpg'
  if (type === 'rainy' || type === 'thunder') return '/weather-bg/rainy.jpg'
  if (type === 'snowy') return '/weather-bg/snowy.jpg'
  return '/weather-bg/sunny.jpg'
}

/** 通过 weatherCode 获取 emoji（支持日夜区分） */
export function getWeatherEmoji(code: number, isDay: boolean = true): string {
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

/**
 * 天气数据 Hook
 *
 * - 优先使用 navigator.geolocation 获取经纬度
 * - 失败时使用 IP 定位（由 wttr.in 默认行为）
 * - 客户端 sessionStorage 10 分钟缓存
 */
export function useWeather() {
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) {
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
      console.warn('[useWeather] 获取天气失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { weather, loading, error, refresh: () => load(true) }
}
