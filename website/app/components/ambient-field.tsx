import { log } from '../log.js'
import { useProvidedStore } from '@migaia/store-react'
import { resolveTheme, uiStoreToken } from '../ui-state.js'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigation, useNavigationType } from 'react-router'
import { prefersReducedMotion } from '../motion.js'
import { trackCardFocus } from '../card-focus.js'
import { domainPath, LOCALES } from '../route-contract.js'

/**
 * WGSL program for the site-wide background. A slow aurora (domain-warped noise in the brand
 * indigo/teal pair) sits under a sparse field of drifting particles. Motion comes from accumulated
 * offsets (`flow` for the aurora, `drift` for the particles) that the host advances faster while a
 * route transition runs, so speed changes never make the field jump. `level` (0..1) is the eased
 * transition strength: particles stretch along the travel direction and lose some contrast.
 * `release` (0..1) tells the route story: while the old page releases what it owned, particles
 * shrink and pull back to their cell centres; once the new route commits, `release` falls while
 * `level` is still held, and the difference blooms the particles back out, larger and brighter.
 * `hero` is the docs home glass search box, a standing window like the focused card. `corner`
 * (0..1) is set on the docs home: the aurora and contour waves gain strength as they flow through
 * the top-right of the viewport, so the light is carried by the moving waves, not painted on. Faint
 * topographic contour lines cover the whole viewport as texture behind the text. Output is
 * premultiplied alpha so the page `--canvas` color shows through.
 */
const AMBIENT_SHADER = /* wgsl */ `
struct Uniforms {
  res: vec2f, time: f32, dark: f32, level: f32, flow: f32, drift: vec2f,
  focus: vec4f, focusLevel: f32, release: f32, corner: f32,
  hero: vec4f, heroLevel: f32, tint: f32, breath: f32
};
@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn noise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), w.x),
             mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), w.x), w.y);
}
fn fbm(p0: vec2f) -> f32 {
  var p = p0; var v = 0.0; var a = 0.5;
  for (var i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2f(1.7, 9.2); a *= 0.5; }
  return v;
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / u.res;
  let aspect = u.res.x / u.res.y;
  let p = vec2f(uv.x * aspect, uv.y);
  let t = u.flow;
  let indigo = mix(vec3f(0.36, 0.39, 0.84), vec3f(0.55, 0.6, 1.0), u.dark);
  let teal = mix(vec3f(0.12, 0.55, 0.6), vec3f(0.36, 0.8, 0.82), u.dark);
  // Not-found page: the flowing waves turn blue and cyan and run a little stronger.
  let blue = mix(vec3f(0.2, 0.44, 0.96), vec3f(0.36, 0.62, 1.0), u.dark);
  let cyan = mix(vec3f(0.05, 0.62, 0.78), vec3f(0.3, 0.9, 0.96), u.dark);
  let waveLow = mix(indigo, blue, u.tint);
  let waveHigh = mix(teal, cyan, u.tint);

  // Aurora: two warped noise layers, strongest toward the top of the viewport.
  let n = fbm(p * 1.1 + vec2f(t, -t * 0.7));
  let m = fbm(p * 1.8 - vec2f(t * 0.6, t) + n * 1.4);
  let auroraColor = mix(waveLow, waveHigh, smoothstep(0.35, 0.7, n));
  // Docs home: waves passing the top-right corner swell; empty sky there stays empty.
  let cornerWeight = u.corner * (1.0 - smoothstep(0.1, 1.05, length(p - vec2f(aspect, 0.0))));
  // Not-found page: lower threshold and no top bias spread the bands over the whole viewport.
  let aurora = smoothstep(0.38 - 0.08 * cornerWeight - 0.1 * u.tint, 0.85, m) * mix(0.07, 0.11, u.dark)
    * (1.0 - 0.55 * uv.y * (1.0 - u.tint)) * (1.0 + 2.4 * cornerWeight) * (1.0 + 0.5 * u.tint);

  // Particles: one jittered point per grid cell, carried by the accumulated drift.
  let grid = 30.0;
  let q = p * grid + u.drift;
  let id = floor(q);
  let h = hash(id);
  // Release pulls every particle back to its cell centre; bloom is the re-forming after commit.
  let bloom = max(u.level - u.release, 0.0);
  let jitter = (vec2f(hash(id + 1.3), hash(id + 7.1)) - 0.5) * 0.55 * (1.0 - 0.85 * u.release);
  var d = fract(q) - 0.5 - jitter;
  // Motion streak while transitioning: stretch along x, softer edge, lower peak.
  d.x = d.x / (1.0 + u.level * 1.2);
  let radius = mix(0.05, 0.11, h) * (1.0 - 0.75 * u.release) * (1.0 + 0.6 * bloom);
  let dotMask = smoothstep(radius, radius * mix(0.35, 0.0, u.level), length(d)) * step(0.62, h);
  let twinkle = 0.55 + 0.45 * sin(u.time * 0.9 + h * 40.0);
  // Not-found page: particles breathe against the CSS dot grid, bright while the grid dims.
  let breathe = mix(1.0, mix(1.7, 0.25, u.breath), u.tint);
  let particles = dotMask * mix(0.14, 0.2, u.dark) * twinkle * (1.0 - u.level * 0.35)
    * (1.0 - 0.5 * u.release) * (1.0 + 1.4 * bloom) * breathe;
  let particleColor = mix(indigo, teal, h);

  // Focused card: inside the hovered card's rect the aurora thickens and a second, finer particle
  // layer appears, so the card reads as a window onto denser light. Soft 24px falloff at the edge.
  let edge = min(min(pos.x - u.focus.x, u.focus.z - pos.x), min(pos.y - u.focus.y, u.focus.w - pos.y));
  // Docs home: the glass search box is a standing window of the same kind. The strength fades in
  // over 16 buffer pixels inside the box edge, so it stays within the border and rounded corners.
  let heroEdge = min(min(pos.x - u.hero.x, u.hero.z - pos.x), min(pos.y - u.hero.y, u.hero.w - pos.y));
  let heroInside = smoothstep(0.0, 16.0, heroEdge) * u.heroLevel;
  let inside = max(smoothstep(-24.0, 16.0, edge) * u.focusLevel, heroInside);
  let q2 = p * grid * 2.1 + u.drift * 1.7 + vec2f(13.7, 5.1);
  let id2 = floor(q2);
  let h2 = hash(id2);
  let jitter2 = (vec2f(hash(id2 + 2.9), hash(id2 + 4.4)) - 0.5) * 0.6;
  let d2 = fract(q2) - 0.5 - jitter2;
  let radius2 = mix(0.06, 0.12, h2);
  let dotMask2 = smoothstep(radius2, radius2 * 0.3, length(d2)) * step(0.5, h2);
  let twinkle2 = 0.5 + 0.5 * sin(u.time * 1.3 + h2 * 50.0);
  // The hero window runs hotter than a hovered card: it is the page's standing visual centre.
  let heroBoost = 1.0 + 1.3 * heroInside;
  let focusParticles = dotMask2 * mix(0.2, 0.28, u.dark) * twinkle2 * inside * heroBoost;
  let focusAurora = smoothstep(0.26, 0.8, m) * mix(0.12, 0.18, u.dark) * inside * heroBoost;

  // Full-viewport contours: warped topographic lines, kept faint behind the text.
  let c = (pos.xy - 0.5 * u.res) / u.res.y;
  let ct = u.flow * 1.9;
  let w = vec2f(fbm(c * 1.5 + ct), fbm(c * 1.5 - ct + 3.1));
  let f = fbm(c * 1.3 + w * 1.7 + vec2f(ct * 0.6, -ct * 0.4));
  let band = abs(fract(f * 9.0) - 0.5);
  let line = smoothstep(0.035, 0.0, band) * (0.55 + 0.45 * smoothstep(0.3, 0.8, f));
  let glow = smoothstep(0.25, 0.95, f);
  let contour = (glow * (0.008 + 0.05 * cornerWeight + 0.03 * u.tint) + line * mix(0.065, 0.05, u.dark)
    * (1.0 + 1.6 * cornerWeight + 0.9 * u.tint)) * (1.0 - 0.3 * uv.y);
  let contourColor = mix(waveLow, waveHigh, smoothstep(0.35, 0.75, w.x));

  let a = clamp(aurora + particles + contour + focusParticles + focusAurora, 0.0, 1.0);
  let color =
    (auroraColor * (aurora + focusAurora) + particleColor * particles
      + mix(indigo, teal, h2) * focusParticles + contourColor * contour) / max(a, 0.0001);
  return vec4f(color * a, a);
}
`

/** Idle frame rate cap; the aurora moves slowly, so 30fps is visually identical. */
const IDLE_FRAME_INTERVAL_MS = 1000 / 30

/**
 * How long the transition stays engaged after the new route commits, so prerendered pages whose
 * data arrives instantly still get a visible, brief effect before everything settles.
 */
const TRANSITION_HOLD_MS = 450

/** Time constant (seconds) of the exponential ease toward and away from the transition state. */
const TRANSITION_EASE_SECONDS = 0.22

/** Idle motion speeds (units per second): aurora flow, particle drift along x and y. */
const IDLE_SPEED = { flow: 0.024, driftX: 0.14, driftY: -0.156 } as const

/**
 * Extra aurora flow speed at full blue-cyan tint, as a multiple of the idle flow. The not-found
 * page has no reading content to protect, so its waves drift visibly, but slowly enough to stay
 * smooth.
 */
const TINT_FLOW_BOOST = 1.5

/**
 * Extra particle drift speed at full tint while the not-found grid is darkest, as a multiple of the
 * idle drift. Particles brighten and quicken as the grid fades, then calm as it returns.
 */
const TINT_DRIFT_BOOST = 2

/** Seconds per not-found breath cycle shared by the CSS dot grid and the shader particles. */
const BREATH_PERIOD_SECONDS = 7

/**
 * CSS custom property (0..1) carrying the breath phase to the not-found dot grid in app.css, so the
 * grid and the particles follow one clock in opposite phase.
 */
const BREATH_PROPERTY = '--not-found-breath'

/**
 * Extra speed at full transition strength. Particles race along the navigation direction (x, signed
 * by `dir`) and rise faster; the aurora flows a few times quicker.
 */
const TRANSITION_SPEED = { flow: 0.07, driftX: 2.4, driftY: -0.5 } as const

/** CSS blur radius (px) applied to the canvas at full transition strength. */
const TRANSITION_BLUR_PX = 6

/** Canvas opacity at full transition strength; the field dims while the route changes. */
const TRANSITION_OPACITY = 0.55

/** Below this strength the transition counts as finished and every style is restored. */
const TRANSITION_EPSILON = 0.002

/**
 * Drawing-buffer scale relative to CSS pixels. The field is soft, so a reduced buffer keeps the
 * full-viewport fill cheap on high-density displays.
 */
const BUFFER_SCALE = 0.75

/** `GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST`; the DOM lib in use lacks the namespace. */
const UNIFORM_COPY_DST_USAGE = 0x40 | 0x08

/**
 * Uniform block size in bytes: res, time, dark, level, flow, drift (8 × f32), the focused card rect
 * (vec4f at offset 32), its strength (f32 at 48), the release strength (f32 at 52), the corner
 * strength (f32 at 56), the docs home search rect (vec4f at 64), its strength (f32 at 80) and the
 * blue-cyan wave tint (f32 at 84) and the not-found breath phase (f32 at 88), padded to the
 * struct's 16-byte alignment.
 */
const UNIFORM_BYTES = 96

/**
 * Minimum time (ms) the release phase stays engaged after a route commits. Prerendered routes often
 * load too fast for the loading state alone to show the particles being collected.
 */
const RELEASE_HOLD_MS = 180

/** Time constant (seconds) of the release ease; quicker than the transition so the bloom shows. */
const RELEASE_EASE_SECONDS = 0.12

/** Time constant (seconds) of the corner strength ease when entering or leaving the docs home. */
const CORNER_EASE_SECONDS = 0.6

/** Scroll distance, in viewport heights, over which the corner strength fades out on the home. */
const CORNER_SCROLL_FADE = 0.8

/** Docs home search box (`language.tsx`) whose rect becomes the shader's standing hero window. */
const HERO_WINDOW_SELECTOR = '.docs-hero-search'

/**
 * Open command palette overlay (`components/ui/dialog.tsx`). While it is open the field is lifted
 * above the overlay (app.css), so the search window must fade out or it would show through.
 */
const OPEN_PALETTE_SELECTOR = ".search-overlay[data-state='open']"

/** Empty rect in CSS pixels, used before a docs home block has been measured. */
const EMPTY_RECT = { left: 0, top: 0, right: 0, bottom: 0 } as const

/**
 * Returns the viewport rect of the first element matching `selector`, or null when the page has
 * none. The blocks scroll with the page while the canvas is fixed, so callers read it every step.
 */
function viewportRect(selector: string): DOMRect | null {
  return document.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null
}

/** Returns true when `pathname` is a language home, which is also the docs home. */
function isDocsHome(pathname: string): boolean {
  /** Pathname without a trailing slash, matching `domainPath` output. */
  const path = pathname.replace(/\/+$/, '')
  return LOCALES.some((locale) => path === domainPath(locale))
}

/** Time constant (seconds) of the ease toward and away from a focused card. */
const FOCUS_EASE_SECONDS = 0.18

/**
 * Reads React Router's history index for the current entry; Back lowers it, Forward raises it.
 * Returns null when the entry was not created by the router.
 */
function historyIndex(): number | null {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx
  return typeof idx === 'number' ? idx : null
}

/**
 * Site-wide decorative WebGPU background with route-transition particles. Runs entirely on the
 * page: no network, no assets. Browsers without WebGPU, or a failed device request, keep the plain
 * `--canvas` color. It pauses while the tab is hidden, draws one still frame under reduced motion
 * (with no transitions), and releases its GPU device on unmount.
 */
export default function AmbientField({
  blueCyan = false
}: {
  /** Tints the flowing aurora and contour waves blue and cyan; used by the not-found page. */
  readonly blueCyan?: boolean
}) {
  /** Wave tint read by the render loop each frame (0 = brand colors, 1 = blue and cyan). */
  const tintRef = useRef(blueCyan ? 1 : 0)
  tintRef.current = blueCyan ? 1 : 0
  /** Resolved appearance comes from the page owner, never from its DOM projection. */
  const theme = useProvidedStore(uiStoreToken, resolveTheme)
  /** The GPU loop reads the latest appearance without rebuilding its device. */
  const themeRef = useRef(theme)
  /** Fixed full-viewport canvas owned by this component. */
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /**
   * Transition request shared with the render loop: navigation direction (+1 forward, -1 back),
   * whether a navigation is loading, and the time until which a committed route keeps the effect
   * engaged. The loop eases its strength toward this target.
   */
  const transitionRef = useRef({ dir: 1, loading: false, holdUntil: 0, releaseUntil: 0 })
  /** Render-loop resume hook, installed once the device is ready. */
  const wakeRef = useRef<() => void>(() => {})
  /** A theme change also repaints a reduced-motion still frame. */
  useEffect(() => {
    themeRef.current = theme
    wakeRef.current()
  }, [theme])
  const { pathname } = useLocation()
  /** Whether the current route is the docs home; read by the render loop each step. */
  const homeRef = useRef(isDocsHome(pathname))
  homeRef.current = isDocsHome(pathname)
  const navigationType = useNavigationType()
  const navigation = useNavigation()
  /** Previous pathname and history index, used to skip the first render and infer direction. */
  const previousRef = useRef<{ pathname: string; idx: number | null } | null>(null)

  useEffect(() => {
    /** Engages the effect as soon as a navigation starts loading, before the route commits. */
    const loading = navigation.state !== 'idle' && navigation.location?.pathname !== pathname
    transitionRef.current.loading = loading
    if (loading && !prefersReducedMotion()) wakeRef.current()
  }, [navigation.state, navigation.location?.pathname, pathname])

  useEffect(() => {
    const idx = historyIndex()
    const previous = previousRef.current
    previousRef.current = { pathname, idx }
    if (!previous || previous.pathname === pathname || prefersReducedMotion()) return
    /** POP compares history indices; PUSH and REPLACE always move forward. */
    const dir =
      navigationType === 'POP' && idx !== null && previous.idx !== null && idx < previous.idx
        ? -1
        : 1
    transitionRef.current.dir = dir
    transitionRef.current.holdUntil = performance.now() + TRANSITION_HOLD_MS
    transitionRef.current.releaseUntil = performance.now() + RELEASE_HOLD_MS
    wakeRef.current()
  }, [navigationType, pathname])

  useEffect(() => {
    const canvas = canvasRef.current
    const gpu = navigator.gpu
    if (!canvas || !gpu) return
    /** Set by cleanup so an initialization still in flight releases what it acquired. */
    let disposed = false
    /** Device acquired for this mount; destroyed on cleanup. */
    let device: GPUDevice | undefined
    /** Pending animation frame, or 0 while paused. */
    let frame = 0
    /** Listener teardown installed once rendering starts. */
    let detach = () => {}

    const start = async () => {
      const adapter = await gpu.requestAdapter({ powerPreference: 'low-power' })
      if (!adapter || disposed) return
      device = await adapter.requestDevice()
      if (disposed) return device.destroy()
      const gpuDevice = device
      // The DOM lib in use has no `webgpu` overload for getContext.
      const context = canvas.getContext('webgpu') as GPUCanvasContext | null
      if (!context) return gpuDevice.destroy()
      const format = gpu.getPreferredCanvasFormat()
      context.configure({ device: gpuDevice, format, alphaMode: 'premultiplied' })
      const module = gpuDevice.createShaderModule({ code: AMBIENT_SHADER })
      const pipeline = gpuDevice.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' }
      })
      const uniformBuffer = gpuDevice.createBuffer({
        size: UNIFORM_BYTES,
        usage: UNIFORM_COPY_DST_USAGE
      })
      const bindGroup = gpuDevice.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
      })
      /** Reused uniform staging array. */
      const uniforms = new Float32Array(UNIFORM_BYTES / 4)
      /** Start time so the field begins mid-motion rather than from a uniform first frame. */
      const origin = performance.now() - 60_000
      /** Constant reduced-motion decision for this mount; only still frames are drawn. */
      const still = prefersReducedMotion()
      /** Not-found breath phase at `now`: 0 at rest, 1 at the brightest grid; still frames hold 0.5. */
      const breathAt = (now: number) =>
        still
          ? 0.5
          : 0.5 - 0.5 * Math.cos((2 * Math.PI * (now - origin)) / 1000 / BREATH_PERIOD_SECONDS)
      /** Timestamp of the last drawn frame, for the idle cap. */
      let lastDraw = 0
      /** Timestamp of the previous loop step, for speed integration and easing. */
      let lastStep = performance.now()
      /** Eased transition strength (0 idle, 1 full). */
      let level = 0
      /** Eased corner strength (0 elsewhere, 1 at the top of the docs home). */
      let corner = 0
      /** Eased hero window strength (0 elsewhere, 1 on the docs home). */
      let heroLevel = 0
      /** Union rect of the hero window blocks in CSS pixels, read every step while on the home. */
      let heroRect: { left: number; top: number; right: number; bottom: number } = EMPTY_RECT
      /** Eased release strength (0 settled, 1 old page fully collected). */
      let release = 0
      /** Accumulated aurora flow; integrating speed keeps motion continuous across speed changes. */
      let flow = 0
      /** Accumulated particle drift along x (signed by navigation direction during transitions). */
      let driftX = 0
      /** Accumulated upward particle drift. */
      let driftY = 0
      /** Card link under the pointer, or null; set by the card-focus tracker. */
      let focusCard: HTMLElement | null = null
      /** Eased focus strength (0 none, 1 full) of the current or last focused card. */
      let focusLevel = 0
      /** Last focused card rect in CSS pixels, kept while the focus eases out. */
      let focusRect = { left: 0, top: 0, right: 0, bottom: 0 }

      /** Matches the drawing buffer to the viewport at the reduced buffer scale. */
      const resize = () => {
        const ratio = Math.min(window.devicePixelRatio || 1, 2) * BUFFER_SCALE
        const width = Math.max(1, Math.round(canvas.clientWidth * ratio))
        const height = Math.max(1, Math.round(canvas.clientHeight * ratio))
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
        }
      }
      /**
       * Advances the transition strength and the motion accumulators to `now`, and mirrors the
       * strength onto the canvas as blur and reduced opacity. Returns true while the transition is
       * engaged or still easing out; at rest the inline filter is cleared.
       */
      const step = (now: number) => {
        // Clamp the step so a long pause (hidden tab) does not fling the particles.
        const dt = Math.min((now - lastStep) / 1000, 0.1)
        lastStep = now
        const transition = transitionRef.current
        const target = transition.loading || now < transition.holdUntil ? 1 : 0
        level += (target - level) * (1 - Math.exp(-dt / TRANSITION_EASE_SECONDS))
        if (target === 0 && level < TRANSITION_EPSILON) level = 0
        const releaseTarget = transition.loading || now < transition.releaseUntil ? 1 : 0
        release += (releaseTarget - release) * (1 - Math.exp(-dt / RELEASE_EASE_SECONDS))
        if (releaseTarget === 0 && release < TRANSITION_EPSILON) release = 0
        const cornerTarget = homeRef.current
          ? Math.max(0, 1 - window.scrollY / (window.innerHeight * CORNER_SCROLL_FADE))
          : 0
        corner += (cornerTarget - corner) * (1 - Math.exp(-dt / CORNER_EASE_SECONDS))
        /** Docs home search box rect; null away from the docs home. */
        const search =
          homeRef.current && !document.querySelector(OPEN_PALETTE_SELECTOR)
            ? viewportRect(HERO_WINDOW_SELECTOR)
            : null
        heroLevel += ((search ? 1 : 0) - heroLevel) * (1 - Math.exp(-dt / CORNER_EASE_SECONDS))
        if (search) heroRect = search
        flow +=
          dt *
          (IDLE_SPEED.flow * (1 + TINT_FLOW_BOOST * tintRef.current) +
            level * TRANSITION_SPEED.flow)
        /** Particle speed multiplier: quickest while the not-found grid is darkest. */
        const driftBoost = 1 + TINT_DRIFT_BOOST * tintRef.current * (1 - breathAt(now))
        driftX +=
          dt * (IDLE_SPEED.driftX * driftBoost + level * TRANSITION_SPEED.driftX * transition.dir)
        driftY += dt * (IDLE_SPEED.driftY * driftBoost + level * TRANSITION_SPEED.driftY)
        const focusTarget = focusCard ? 1 : 0
        focusLevel += (focusTarget - focusLevel) * (1 - Math.exp(-dt / FOCUS_EASE_SECONDS))
        if (focusTarget === 0 && focusLevel < TRANSITION_EPSILON) focusLevel = 0
        // The card scrolls with the page while the canvas is fixed: read its rect every step.
        if (focusCard) focusRect = focusCard.getBoundingClientRect()
        canvas.style.filter =
          level > 0
            ? `blur(${(level * TRANSITION_BLUR_PX).toFixed(2)}px) opacity(${(1 - level * (1 - TRANSITION_OPACITY)).toFixed(3)})`
            : ''
        return target === 1 || level > 0
      }
      /** Draws one frame at the current motion state. */
      const draw = (now: number) => {
        resize()
        uniforms[0] = canvas.width
        uniforms[1] = canvas.height
        uniforms[2] = (now - origin) / 1000
        uniforms[3] = themeRef.current === 'dark' ? 1 : 0
        uniforms[4] = level
        uniforms[5] = flow
        uniforms[6] = driftX
        uniforms[7] = driftY
        /** CSS pixels to drawing-buffer pixels. */
        const scale = canvas.width / Math.max(1, canvas.clientWidth)
        uniforms[8] = focusRect.left * scale
        uniforms[9] = focusRect.top * scale
        uniforms[10] = focusRect.right * scale
        uniforms[11] = focusRect.bottom * scale
        uniforms[12] = focusLevel
        uniforms[13] = release
        uniforms[14] = corner
        uniforms[16] = heroRect.left * scale
        uniforms[17] = heroRect.top * scale
        uniforms[18] = heroRect.right * scale
        uniforms[19] = heroRect.bottom * scale
        uniforms[20] = heroLevel
        uniforms[21] = tintRef.current
        /** Grid brightness phase shared with the CSS dot grid, opposite the particles. */
        const breath = breathAt(now)
        uniforms[22] = breath
        if (tintRef.current > 0)
          document.documentElement.style.setProperty(BREATH_PROPERTY, breath.toFixed(3))
        gpuDevice.queue.writeBuffer(uniformBuffer, 0, uniforms)
        const encoder = gpuDevice.createCommandEncoder()
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: { r: 0, g: 0, b: 0, a: 0 }
            }
          ]
        })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bindGroup)
        pass.draw(3)
        pass.end()
        gpuDevice.queue.submit([encoder.finish()])
      }
      /** Frame loop: capped while idle, every frame during a transition, stopped while hidden. */
      const tick = (now: number) => {
        frame = 0
        if (document.hidden) {
          lastStep = now
          return
        }
        const transitioning = step(now)
        // The not-found page draws every frame: its faster waves judder at the idle cap.
        if (transitioning || tintRef.current > 0 || now - lastDraw >= IDLE_FRAME_INTERVAL_MS) {
          lastDraw = now
          draw(now)
        }
        frame = requestAnimationFrame(tick)
      }
      /** Resumes the loop, or repaints the still frame after a theme or size change. */
      const resume = () => {
        if (disposed) return
        if (still) {
          draw(performance.now())
          return
        }
        if (!frame && !document.hidden) {
          lastStep = performance.now()
          frame = requestAnimationFrame(tick)
        }
      }

      wakeRef.current = resume
      document.addEventListener('visibilitychange', resume)
      window.addEventListener('resize', resume)
      /** Hover focus only animates; the reduced-motion still frame ignores it. */
      const stopFocus = still
        ? () => {}
        : trackCardFocus((card) => {
            focusCard = card
            resume()
          })
      detach = () => {
        stopFocus()
        document.documentElement.style.removeProperty(BREATH_PROPERTY)
        document.removeEventListener('visibilitychange', resume)
        window.removeEventListener('resize', resume)
        uniformBuffer.destroy()
      }
      void gpuDevice.lost.then((info) => {
        // A lost device ends the effect; the plain background stays. Report unexpected loss only.
        if (info.reason !== 'destroyed') log.error(info.message)
        canvas.dataset.ready = 'false'
        canvas.style.filter = ''
        if (frame) cancelAnimationFrame(frame)
        frame = 0
      })
      resume()
      canvas.dataset.ready = 'true'
    }

    start().catch((error: unknown) => {
      // Decorative only: report and keep the plain background.
      log.error(error)
    })
    return () => {
      disposed = true
      wakeRef.current = () => {}
      if (frame) cancelAnimationFrame(frame)
      detach()
      device?.destroy()
    }
  }, [])

  return <canvas aria-hidden="true" className="ambient-field" ref={canvasRef} />
}
