import { useEffect, useRef, useState } from 'react'

/**
 * 对值进行防抖（debounce）处理
 *
 * 适用于搜索输入、过滤器等高频变化的场景：
 * 仅在 value 停止变化 delay 毫秒后才更新返回值，
 * 避免每次按键都触发请求。
 *
 * @param value 需要防抖的值
 * @param delay 防抖延迟（毫秒），默认 300ms
 * @returns 防抖后的值
 *
 * @example
 * const [input, setInput] = useState('')
 * const debouncedInput = useDebounce(input, 300)
 * useEffect(() => { if (debouncedInput) search(debouncedInput) }, [debouncedInput])
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState<T>(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // 清除上一次定时器，重新计时
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setDebounced(value)
    }, delay)

    // 卸载时清理定时器，避免内存泄漏
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [value, delay])

  return debounced
}
