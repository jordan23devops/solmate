export default function SunCompass({ azimuthDeg }) {
  const rotation =
    typeof azimuthDeg === 'number' && Number.isFinite(azimuthDeg)
      ? azimuthDeg
      : 0

  return (
    <div className="sun-compass" aria-label={`Sun direction ${rotation.toFixed(0)} degrees`}>
      <div className="sun-compass__dial">
        <span className="sun-compass__north" aria-hidden="true">
          N
        </span>
        <div
          className="sun-compass__arrow"
          style={{ transform: `rotate(${rotation}deg)` }}
          aria-hidden="true"
        />
      </div>
      <span className="sun-compass__label">SUN</span>
    </div>
  )
}
