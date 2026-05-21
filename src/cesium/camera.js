const RECOLETA = { lng: -58.393, lat: -34.5875 }
const DEFAULT_HEIGHT_AGL_M = 800
const DEFAULT_PITCH_DEG = -30
const MIN_HEIGHT_AGL_M = 50
const MAX_HEIGHT_AGL_M = 5000

export function setInitialCameraView(viewer) {
  const Cesium = window.Cesium
  viewer.scene.mode = Cesium.SceneMode.SCENE3D

  const carto = Cesium.Cartographic.fromDegrees(RECOLETA.lng, RECOLETA.lat)
  const ground =
    viewer.scene.globe.getHeight(carto) ?? carto.height ?? 0
  const cameraHeight = ground + DEFAULT_HEIGHT_AGL_M

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromRadians(
      carto.longitude,
      carto.latitude,
      cameraHeight,
    ),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(DEFAULT_PITCH_DEG),
      roll: 0,
    },
  })
}

export function setupCameraHeightLimits(viewer) {
  const Cesium = window.Cesium

  return viewer.scene.preUpdate.addEventListener(() => {
    const carto = viewer.camera.positionCartographic
    if (!carto) return

    const ground = viewer.scene.globe.getHeight(carto) ?? 0
    const agl = carto.height - ground

    if (agl < MIN_HEIGHT_AGL_M) {
      carto.height = ground + MIN_HEIGHT_AGL_M
      viewer.camera.position = Cesium.Cartesian3.fromRadians(
        carto.longitude,
        carto.latitude,
        carto.height,
      )
    } else if (agl > MAX_HEIGHT_AGL_M) {
      carto.height = ground + MAX_HEIGHT_AGL_M
      viewer.camera.position = Cesium.Cartesian3.fromRadians(
        carto.longitude,
        carto.latitude,
        carto.height,
      )
    }
  })
}
