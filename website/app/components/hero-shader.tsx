import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '../motion.js'

/**
 * Fragment program for the docs-home hero: slow domain-warped noise drawn as topographic contour
 * lines over a faint dot grid, in the brand indigo/teal pair. Output is premultiplied alpha so the
 * page canvas shows through; `u_dark` switches to the lifted dark-theme palette.
 */
const FRAGMENT_SHADER = `precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dark;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);vec2 u=f*f*(3.0-2.0*f);
return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x),u.y);}
float fbm(vec2 p){float v=0.0;float a=0.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.02+vec2(1.7,9.2);a*=0.5;}return v;}
void main(){
vec2 uv=gl_FragCoord.xy/u_res;
vec2 p=(gl_FragCoord.xy-0.5*u_res)/u_res.y;
float t=u_time*0.035;
vec2 q=vec2(fbm(p*1.5+t),fbm(p*1.5-t+3.1));
float f=fbm(p*1.3+q*1.7+vec2(t*0.6,-t*0.4));
float band=abs(fract(f*9.0)-0.5);
float line=smoothstep(0.03,0.0,band)*(0.55+0.45*smoothstep(0.3,0.8,f));
vec3 indigo=mix(vec3(0.33,0.36,0.82),vec3(0.62,0.66,1.0),u_dark);
vec3 teal=mix(vec3(0.12,0.56,0.6),vec3(0.4,0.82,0.84),u_dark);
vec3 col=mix(indigo,teal,smoothstep(0.35,0.75,q.x));
float glow=smoothstep(0.25,0.95,f);
vec2 g=fract(gl_FragCoord.xy/24.0)-0.5;
float dots=smoothstep(0.1,0.0,length(g));
float mask=smoothstep(0.05,0.95,uv.x)*smoothstep(-0.3,1.0,uv.y);
float a=(glow*0.1+line*0.5+dots*glow*0.16)*mask;
gl_FragColor=vec4(col*a,a);
}`

/** Full-screen triangle pair; the fragment program does all the drawing. */
const VERTEX_SHADER = `attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.0,1.0);}`

/** Upper bound on frames per second; the field moves slowly, so 30fps is visually identical. */
const FRAME_INTERVAL_MS = 1000 / 30

/** Device-pixel-ratio ceiling; contour lines stay crisp while fill cost stays bounded. */
const MAX_PIXEL_RATIO = 1.5

/** Compiles one shader stage, returning null when the driver rejects it. */
function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  console.error(gl.getShaderInfoLog(shader))
  gl.deleteShader(shader)
  return null
}

/**
 * Decorative WebGL background for the docs home hero. Runs entirely on this page: no network, no
 * telemetry, no assets. It pauses when scrolled away or the tab is hidden, renders a single static
 * frame under reduced motion, and leaves the CSS gradient fallback in place (via
 * `data-shader="off"`) when WebGL is unavailable.
 */
export function HeroShader() {
  /** Canvas owned by this component; sized to its CSS box on every resize. */
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false })
    /** Host element switches between the shader and the static gradient fallback. */
    const host = canvas.parentElement
    if (!gl) {
      if (host) host.dataset.shader = 'off'
      return
    }
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!vertex || !fragment || !program) {
      if (host) host.dataset.shader = 'off'
      return
    }
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    // Called through Reflect.apply: React Compiler treats any `use*` call as a Hook.
    Reflect.apply(gl.useProgram, gl, [program])
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const resolution = gl.getUniformLocation(program, 'u_res')
    const time = gl.getUniformLocation(program, 'u_time')
    const dark = gl.getUniformLocation(program, 'u_dark')
    if (host) host.dataset.shader = 'on'

    /** Pending animation frame, or 0 while paused. */
    let frame = 0
    /** Timestamp of the last drawn frame, used for the 30fps cap. */
    let lastDraw = 0
    /** True while the hero intersects the viewport. */
    let visible = true
    /** Constant reduced-motion decision for this mount; only one frame is drawn when set. */
    const still = prefersReducedMotion()
    /** Start time so the field begins mid-motion rather than from a uniform first frame. */
    const origin = performance.now() - 40_000

    /** Matches the drawing buffer to the canvas CSS size at a bounded pixel ratio. */
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio))
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        gl.viewport(0, 0, width, height)
      }
    }
    /** Draws one frame with the current theme and elapsed time. */
    const draw = (now: number) => {
      resize()
      gl.uniform2f(resolution, canvas.width, canvas.height)
      gl.uniform1f(time, (now - origin) / 1000)
      gl.uniform1f(dark, document.documentElement.dataset.theme === 'dark' ? 1 : 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    /** Frame loop honouring the cap; stops itself whenever the hero is hidden. */
    const tick = (now: number) => {
      frame = 0
      if (!visible || document.hidden) return
      if (now - lastDraw >= FRAME_INTERVAL_MS) {
        lastDraw = now
        draw(now)
      }
      frame = requestAnimationFrame(tick)
    }
    /** Resumes the loop (or redraws the still frame) after a visibility or theme change. */
    const resume = () => {
      if (still) return draw(performance.now())
      if (!frame && visible && !document.hidden) frame = requestAnimationFrame(tick)
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting)
      resume()
    })
    observer.observe(canvas)
    /** Theme switches must repaint the still frame immediately. */
    const themeObserver = new MutationObserver(resume)
    themeObserver.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('resize', resume)
    resume()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      themeObserver.disconnect()
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('resize', resume)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
    }
  }, [])

  return <canvas aria-hidden="true" className="hero-shader-canvas" ref={canvasRef} />
}
