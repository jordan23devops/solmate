export function initCesiumIon() {
  if (typeof window.Cesium === 'undefined') {
    throw new Error(
      'CesiumJS is not loaded. Check the CDN scripts in index.html.',
    )
  }

  const token = import.meta.env.VITE_CESIUM_TOKEN
  if (!token) {
    console.warn(
      '[Solmate] VITE_CESIUM_TOKEN is not set. Copy .env.example to .env and add your Cesium ion token.',
    )
    return false
  }

  window.Cesium.Ion.defaultAccessToken = token
  return true
}
