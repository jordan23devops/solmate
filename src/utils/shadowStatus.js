import { timeKeyToDisplay } from './shadowGrid'

/**
 * Derive center-pin status from pre-computed sunByTime series.
 */
export function getSunStatusFromCache(centerSunByTime, timeSlots, currentTimeKey) {
  if (!centerSunByTime || !timeSlots?.length) {
    return { inSun: false, message: 'Analyzing sun exposure…' }
  }

  const idx = timeSlots.findIndex((s) => s.key === currentTimeKey)
  const safeIdx = idx >= 0 ? idx : 0
  const inSun = Boolean(centerSunByTime[currentTimeKey])

  if (inSun) {
    for (let i = safeIdx + 1; i < timeSlots.length; i++) {
      const key = timeSlots[i].key
      if (!centerSunByTime[key]) {
        return {
          inSun: true,
          message: `☀️ Direct sun until ${timeKeyToDisplay(key)}`,
        }
      }
    }
    return { inSun: true, message: '☀️ Direct sun until sunset' }
  }

  for (let i = safeIdx + 1; i < timeSlots.length; i++) {
    const key = timeSlots[i].key
    if (centerSunByTime[key]) {
      return {
        inSun: false,
        message: `☀️ Next sun at ${timeKeyToDisplay(key)}`,
      }
    }
  }

  return { inSun: false, message: '🌑 In shadow until sunset' }
}
