import { isSceneReadyForRaycast } from '../cesium/sceneReady'
import { sunDirectionECEF } from './sunDirection'

const PICKER_EXCLUDE_IDS = [
  'sunspot-pin',
  'sunspot-pin-glow',
  'sunspot-ground',
  'sunspot-height-line',
  'sunspot-sun-ray',
  'sunspot-sun-dot',
]

/**
 * Lift a Cartesian3 along the ellipsoid surface normal ("up") by N meters.
 */
export function liftAlongNormal(clickedPosition, meters) {
  const Cesium = window.Cesium
  if (!meters) return Cesium.Cartesian3.clone(clickedPosition)
  const up = new Cesium.Cartesian3()
  Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(clickedPosition, up)
  const offset = Cesium.Cartesian3.multiplyByScalar(
    up,
    meters,
    new Cesium.Cartesian3(),
  )
  return Cesium.Cartesian3.add(clickedPosition, offset, new Cesium.Cartesian3())
}

function getRaycastExcludes(viewer) {
  const exclude = []
  for (const id of PICKER_EXCLUDE_IDS) {
    const entity = viewer.entities.getById(id)
    if (entity) exclude.push(entity)
  }
  return exclude
}

/**
 * Cast a ray from `origin` toward the sun and return {inSun, direction}.
 * `origin` is supplied by the caller — pin and ray must share this exact
 * Cartesian3 reference for the two to stay aligned.
 */
export function computeSunExposure(
  viewer,
  origin,
  lat,
  lng,
  altitudeDeg,
  azimuthDeg,
) {
  if (!origin) {
    return { inSun: false, direction: null }
  }
  if (!Number.isFinite(altitudeDeg) || altitudeDeg <= 0) {
    return { inSun: false, direction: null }
  }
  if (!isSceneReadyForRaycast(viewer)) {
    return { inSun: false, direction: null }
  }

  try {
    const Cesium = window.Cesium
    const scene = viewer.scene
    const direction = sunDirectionECEF(
      lng,
      lat,
      altitudeDeg,
      azimuthDeg,
      scene.globe.ellipsoid,
    )
    if (!direction) {
      return { inSun: false, direction: null }
    }

    if (typeof scene.pickFromRay !== 'function') {
      console.warn('[SunSpot] scene.pickFromRay is not available')
      return { inSun: true, direction }
    }

    const ray = new Cesium.Ray(origin, direction)
    // Exclude only our marker entities; the Google Photorealistic tileset
    // stays in the pickable set so building hits are reported.
    const exclude = getRaycastExcludes(viewer)
    const result = scene.pickFromRay(ray, exclude)
    console.log('[SunSpot] raycast result:', result)

    const inSun = !result?.position
    return { inSun, direction }
  } catch (error) {
    console.warn('[SunSpot] computeSunExposure failed:', error)
    return { inSun: false, direction: null }
  }
}
