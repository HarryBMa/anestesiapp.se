/**
 * The signature backdrop shared with Förrådet: SVG fractal noise over the
 * page colour, with three slowly drifting colour blobs behind everything.
 * Purely ambient, so it is hidden from screen readers and ignores pointers.
 */
export function GrainyBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
      <div className="absolute inset-0 bg-background" />

      <div className="absolute inset-0 overflow-hidden">
        <div className="animate-drift-a absolute top-[18%] left-[8%] size-56 rounded-full bg-chart-1 opacity-50 blur-[70px]" />
        <div className="animate-drift-b absolute top-[30%] -right-10 h-64 w-52 rounded-full bg-chart-2 opacity-45 blur-[70px]" />
        <div className="animate-drift-c absolute top-[4%] right-[20%] h-52 w-64 rounded-full bg-chart-3 opacity-40 blur-[70px]" />
      </div>

      <svg className="absolute inset-0 size-full opacity-[0.35] mix-blend-multiply dark:mix-blend-soft-light">
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </div>
  );
}
