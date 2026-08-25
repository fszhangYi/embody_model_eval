import { useEffect, useRef } from 'react'

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  a: number
  hue: 0 | 1 // 0 teal, 1 amber
}

function countForSize(w: number, h: number): number {
  const area = w * h
  if (area < 480_000) return 28
  if (area < 900_000) return 42
  return 56
}

/**
 * Lightweight canvas particle field for the home hero background.
 * Caps DPR and particle count for low-memory hosts.
 */
export function HomeParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    let particles: Particle[] = []
    let w = 0
    let h = 0
    let dpr = 1
    let raf = 0
    let running = true
    let mx = -9999
    let my = -9999
    let linkDist = 110

    const teal = { r: 61, g: 214, b: 198 }
    const amber = { r: 240, g: 180, b: 41 }

    const spawn = (p?: Particle): Particle => {
      const out: Particle = p || {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        r: 1,
        a: 1,
        hue: 0,
      }
      out.x = Math.random() * w
      out.y = Math.random() * h
      out.vx = (Math.random() - 0.5) * 0.28
      out.vy = (Math.random() - 0.5) * 0.28
      out.r = 0.8 + Math.random() * 1.8
      out.a = 0.25 + Math.random() * 0.55
      out.hue = Math.random() > 0.82 ? 1 : 0
      return out
    }

    const resize = () => {
      const parent = canvas.parentElement
      const rect = parent?.getBoundingClientRect()
      w = Math.max(1, Math.floor(rect?.width || window.innerWidth))
      h = Math.max(1, Math.floor(rect?.height || window.innerHeight))
      dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      linkDist = Math.min(130, Math.max(90, Math.sqrt(w * h) * 0.045))

      const n = countForSize(w, h)
      if (particles.length !== n) {
        particles = Array.from({ length: n }, () => spawn())
      }
    }

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      mx = e.clientX - rect.left
      my = e.clientY - rect.top
    }
    const onLeave = () => {
      mx = -9999
      my = -9999
    }
    const onVis = () => {
      running = document.visibilityState === 'visible'
      if (running && !raf) raf = requestAnimationFrame(tick)
    }

    const tick = () => {
      raf = 0
      if (!running) return

      ctx.clearRect(0, 0, w, h)

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        // soft mouse attract / drift
        const dx = mx - p.x
        const dy = my - p.y
        const d2 = dx * dx + dy * dy
        if (d2 < 22_500 && d2 > 1) {
          const inv = 1 / Math.sqrt(d2)
          p.vx += dx * inv * 0.012
          p.vy += dy * inv * 0.012
        }

        p.x += p.vx
        p.y += p.vy
        p.vx *= 0.995
        p.vy *= 0.995

        // keep a slow wander so motion never fully dies
        p.vx += (Math.random() - 0.5) * 0.008
        p.vy += (Math.random() - 0.5) * 0.008

        const speed = Math.hypot(p.vx, p.vy)
        if (speed > 0.55) {
          p.vx = (p.vx / speed) * 0.55
          p.vy = (p.vy / speed) * 0.55
        }

        if (p.x < -20) p.x = w + 20
        else if (p.x > w + 20) p.x = -20
        if (p.y < -20) p.y = h + 20
        else if (p.y > h + 20) p.y = -20
      }

      // links (O(n²) but n≤56)
      const maxD = linkDist
      const maxD2 = maxD * maxD
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i]
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const d2 = dx * dx + dy * dy
          if (d2 > maxD2) continue
          const t = 1 - Math.sqrt(d2) / maxD
          const alpha = t * t * 0.28
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.strokeStyle = `rgba(61, 214, 198, ${alpha})`
          ctx.lineWidth = 0.7
          ctx.stroke()
        }
      }

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        const c = p.hue === 0 ? teal : amber
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3.2)
        g.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${p.a})`)
        g.addColorStop(0.45, `rgba(${c.r},${c.g},${c.b},${p.a * 0.35})`)
        g.addColorStop(1, `rgba(${c.r},${c.g},${c.b},0)`)
        ctx.beginPath()
        ctx.fillStyle = g
        ctx.arc(p.x, p.y, p.r * 3.2, 0, Math.PI * 2)
        ctx.fill()
      }

      raf = requestAnimationFrame(tick)
    }

    resize()
    window.addEventListener('resize', resize, { passive: true })
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerleave', onLeave)
    document.addEventListener('visibilitychange', onVis)
    raf = requestAnimationFrame(tick)

    return () => {
      running = false
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return <canvas ref={canvasRef} className="home-particles" aria-hidden="true" />
}
