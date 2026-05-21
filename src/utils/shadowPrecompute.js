import { isSceneReadyForRaycast } from '../cesium/sceneReady'
import { dateAtMinutes, getSunAltitudeAzimuth } from './sunCalc'
import { generateShadowGridPoints, generateTimeSlots } from './shadowGrid'
import { computeSunExposure } from './shadowRaycast'

const YIELD_EVERY = 40

function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Pre-compute sun/shadow for every grid point × 15-minute time slot.
 */
export async function precomputeShadowGrid(
  viewer,
  {
    centerLat,
    centerLng,
    heightMeters,
    radiusM,
    sunriseMinutes,
    sunsetMinutes,
  },
  onProgress,
) {
  if (!isSceneReadyForRaycast(viewer)) {
    throw new Error('Globe ellipsoid is not ready for shadow pre-computation')
  }

  const gridPoints = generateShadowGridPoints(centerLat, centerLng, radiusM)
  const timeSlots = generateTimeSlots(sunriseMinutes, sunsetMinutes)
  const totalWork = gridPoints.length * timeSlots.length
  let doneWork = 0

  const points = []
  let centerSunByTime = null

  for (const gridPoint of gridPoints) {
    const sunByTime = {}
    const isCenter =
      gridPoint.east === 0 &&
      gridPoint.north === 0

    for (const slot of timeSlots) {
      const date = dateAtMinutes(slot.minutes)
      const { altitudeDeg, azimuthDeg } = getSunAltitudeAzimuth(
        date,
        gridPoint.lat,
        gridPoint.lng,
      )
      const { inSun } = computeSunExposure(
        viewer,
        gridPoint.lng,
        gridPoint.lat,
        heightMeters,
        altitudeDeg,
        azimuthDeg,
      )
      sunByTime[slot.key] = inSun
      doneWork++

      if (doneWork % YIELD_EVERY === 0) {
        const percent = Math.round((doneWork / totalWork) * 100)
        onProgress?.({
          percent,
          pointCount: gridPoints.length,
          totalWork,
          doneWork,
          message: `Analyzing sun exposure… ${percent}%`,
          detail: `Analyzing ${gridPoints.length} points…`,
        })
        await yieldToMain()
      }
    }

    const entry = {
      lat: gridPoint.lat,
      lng: gridPoint.lng,
      sunByTime,
    }
    points.push(entry)

    if (isCenter) {
      centerSunByTime = { ...sunByTime }
    }
  }

  if (!centerSunByTime) {
    const centerPoint = points.reduce((best, p) => {
      const d =
        (p.lat - centerLat) ** 2 + (p.lng - centerLng) ** 2
      const bd = best
        ? (best.lat - centerLat) ** 2 + (best.lng - centerLng) ** 2
        : Infinity
      return d < bd ? p : best
    }, null)
    centerSunByTime = centerPoint?.sunByTime ?? {}
  }

  onProgress?.({
    percent: 100,
    pointCount: gridPoints.length,
    totalWork,
    doneWork: totalWork,
    message: 'Analyzing sun exposure… 100%',
    detail: `Analyzing ${gridPoints.length} points…`,
  })

  return {
    centerLat,
    centerLng,
    radiusM,
    heightMeters,
    timeSlots,
    points,
    centerSunByTime,
  }
}
