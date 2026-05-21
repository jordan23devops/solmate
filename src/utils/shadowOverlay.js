const SHADOW_COLOR = '#1a237e'
const SHADOW_ALPHA = 0.35
const SHADOW_PIXEL_SIZE = 12
const GRID_ENTITY_PREFIX = 'solmate-grid-'
const MAX_OVERLAY_ENTITIES = 25

export function clearShadowOverlay(viewer) {
  const toRemove = viewer.entities.values.filter((e) =>
    String(e.id ?? '').startsWith(GRID_ENTITY_PREFIX),
  )
  for (const entity of toRemove) {
    viewer.entities.remove(entity)
  }
}

export function removeShadowOverlay(viewer) {
  clearShadowOverlay(viewer)
}

/**
 * Render shadow cells for the given time key (in shadow = visible dot).
 */
export function renderShadowOverlay(viewer, cache, timeKey, heightMeters) {
  const Cesium = window.Cesium
  clearShadowOverlay(viewer)

  if (!cache?.points?.length || !timeKey) return 0
  if (!Array.isArray(cache.points)) return 0
  if (cache.points.length > MAX_OVERLAY_ENTITIES) {
    console.warn(
      `[Solmate] renderShadowOverlay: ${cache.points.length} points exceeds cap, truncating to ${MAX_OVERLAY_ENTITIES}`,
    )
  }

  const ellipsoid = viewer.scene.globe?.ellipsoid ?? Cesium.Ellipsoid.WGS84
  const color = Cesium.Color.fromCssColorString(SHADOW_COLOR).withAlpha(
    SHADOW_ALPHA,
  )

  const renderPoints = cache.points.slice(0, MAX_OVERLAY_ENTITIES)
  let shadowCount = 0

  renderPoints.forEach((point, index) => {
    if (point.sunByTime?.[timeKey]) return

    try {
      viewer.entities.add({
        id: `${GRID_ENTITY_PREFIX}${index}`,
        position: Cesium.Cartesian3.fromDegrees(
          point.lng,
          point.lat,
          heightMeters,
          ellipsoid,
        ),
        point: {
          pixelSize: SHADOW_PIXEL_SIZE,
          color,
          outlineWidth: 0,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(50, 1.2, 2000, 0.6),
        },
      })
      shadowCount++
    } catch (error) {
      console.warn('[Solmate] Failed to add shadow entity', index, error)
    }
  })

  viewer.scene.requestRender()
  return shadowCount
}
