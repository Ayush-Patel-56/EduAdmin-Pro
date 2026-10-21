import { useEffect, type RefObject } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { TOASTS } from './content'

gsap.registerPlugin(ScrollTrigger)

const CONFETTI = ['#4f46e5', '#059669', '#f59e0b', '#c2410c', '#0ea5e9']

/**
 * All landing-page motion: intro, live sample data, scroll scenes and smooth scroll.
 * Everything it starts (tweens, ScrollTriggers, Lenis, timers, listeners, confetti) is torn down on unmount.
 * With prefers-reduced-motion only the clock keeps updating and the page is shown static.
 */
export function useLandingMotion(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s)
    const $$ = <T extends Element = HTMLElement>(s: string, c: ParentNode = root) => Array.from(c.querySelectorAll<T>(s))
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timers: number[] = []
    const cleanups: (() => void)[] = []
    const listen = <K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      window.addEventListener(t, fn, opts)
      cleanups.push(() => window.removeEventListener(t, fn))
    }

    // Nav: solid background once scrolled, hides while scrolling down.
    const nav = $('#nav')
    let last = 0
    listen(
      'scroll',
      () => {
        const y = window.scrollY
        nav?.classList.toggle('solid', y > 30)
        nav?.classList.toggle('hide', y > last && y > 400)
        last = y
      },
      { passive: true },
    )

    // Live clock (also with reduced motion).
    const lt = $('#liveTime')
    const tick = () => {
      const d = new Date()
      const h = d.getHours()
      const pad = (n: number) => String(n).padStart(2, '0')
      if (lt) lt.textContent = `${h % 12 || 12}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${h < 12 ? 'am' : 'pm'}`
    }
    tick()
    timers.push(window.setInterval(tick, 1000))

    const confetti: HTMLElement[] = []
    const burst = (x: number, y: number) => {
      if (reduce) return
      for (let i = 0; i < 26; i++) {
        const d = document.createElement('i')
        d.className = 'lp-confetti'
        d.style.background = CONFETTI[i % CONFETTI.length]
        document.body.appendChild(d)
        confetti.push(d)
        gsap.set(d, { x, y, rotation: Math.random() * 360 })
        gsap.to(d, { x: x + (Math.random() - 0.5) * 360, y: y - 120 - Math.random() * 200, rotation: '+=360', duration: 0.9, ease: 'power2.out' })
        gsap.to(d, { y: '+=320', opacity: 0, duration: 1.1, delay: 0.85, ease: 'power1.in', onComplete: () => d.remove() })
      }
    }
    const cta = $('#cta')
    const onCta = () => {
      const r = cta!.getBoundingClientRect()
      burst(r.left + r.width / 2, r.top)
    }
    cta?.addEventListener('click', onCta)
    cleanups.push(() => cta?.removeEventListener('click', onCta))

    if (reduce) {
      root.classList.add('static')
      $$('.reveal').forEach((e) => {
        e.style.opacity = '1'
        e.style.transform = 'none'
      })
      $$('.s2,.s3,.s4').forEach((e) => (e.style.opacity = '0'))
      const cur = $('#cur')
      if (cur) cur.style.display = 'none'
      return () => {
        timers.forEach(clearInterval)
        cleanups.forEach((f) => f())
        root.classList.remove('static')
      }
    }

    const lenis = new Lenis({ lerp: 0.09 })
    lenis.on('scroll', ScrollTrigger.update)
    const raf = (t: number) => lenis.raf(t * 1000)
    gsap.ticker.add(raf)
    gsap.ticker.lagSmoothing(0)
    $$<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
      const onClick = (e: MouseEvent) => {
        const t = root.querySelector<HTMLElement>(a.getAttribute('href')!)
        if (t) {
          e.preventDefault()
          lenis.scrollTo(t, { offset: -20 })
        }
      }
      a.addEventListener('click', onClick)
      cleanups.push(() => a.removeEventListener('click', onClick))
    })

    const mm = gsap.matchMedia()
    const ctx = gsap.context(() => {
      const spring = 'back.out(1.7)'
      const expo = 'expo.out'

      // Live sample data in the dashboard mockup.
      const cells = $$('#ttg .p')
      let ni = 0
      timers.push(
        window.setInterval(() => {
          cells.forEach((c) => c.classList.remove('now'))
          cells[ni % cells.length]?.classList.add('now')
          ni += 3
        }, 2200),
      )
      const kpis: [string, number, number, string | null, number][] = [
        ['#k1', 90, 97, '#k1b', 100],
        ['#k2', 12, 22, '#k2b', 24],
        ['#k3', 4, 8, null, 0],
      ]
      timers.push(
        window.setInterval(() => {
          for (const [sel, lo, hi, bar, max] of kpis) {
            const el = $(sel)
            if (!el) continue
            const v = Number(el.textContent)
            const n = Math.max(lo, Math.min(hi, v + (Math.random() < 0.65 ? 1 : -1)))
            const o = { v }
            gsap.to(o, { v: n, duration: 0.6, onUpdate: () => (el.textContent = String(Math.round(o.v))) })
            const b = bar ? $(bar) : null
            if (b) b.style.transform = `scaleX(${n / max})`
          }
          const pts = Array.from({ length: 7 }, (_, i) => `${i * 20},${4 + Math.round(Math.random() * 16)}`)
          $('#spk')?.setAttribute('points', pts.join(' '))
        }, 2600),
      )
      let mi = 0
      timers.push(
        window.setInterval(() => {
          mi = (mi + 1) % TOASTS.length
          gsap
            .timeline()
            .to('#toast', {
              y: 14,
              opacity: 0,
              duration: 0.3,
              ease: 'power2.in',
              onComplete: () => {
                $('#tTitle')!.textContent = TOASTS[mi][0]
                $('#tSub')!.textContent = TOASTS[mi][1]
              },
            })
            .to('#toast', { y: 0, opacity: 1, duration: 0.55, ease: 'back.out(1.8)' })
        }, 3200),
      )

      // Intro: headline, underline, dashboard assembling itself.
      const sp = $<SVGPathElement>('#scribP')!
      const L = sp.getTotalLength()
      gsap.set(sp, { strokeDasharray: L, strokeDashoffset: L })
      const as = $$('#ui .as')
      const side = $$('#ui nav.side a')
      const tiles = $$('#ui .tile, #ui .qa-btn, #ui .invite, #ui tbody tr')
      gsap.set(as, { opacity: 0, y: 24 })
      gsap.set(side, { opacity: 0, x: -14 })
      gsap.set(tiles, { opacity: 0, y: 12, scale: 0.96 })
      gsap.set('#laptop', { y: 60, opacity: 0 })
      gsap
        .timeline({ defaults: { ease: expo } })
        .from('#h1 .ln>span', { yPercent: 115, rotate: 3, duration: 1.3, stagger: 0.12 })
        .to(sp, { strokeDashoffset: 0, duration: 0.9, ease: 'power2.inOut' }, '-=.5')
        .from('.h-in', { y: 24, opacity: 0, duration: 1, stagger: 0.12 }, '-=1')
        .to('#laptop', { y: 0, opacity: 1, duration: 1.3 }, '-=.8')
        .to(as, { opacity: 1, y: 0, duration: 0.9, stagger: 0.07, ease: spring }, '-=.7')
        .to(side, { opacity: 1, x: 0, duration: 0.6, stagger: 0.03 }, '-=1.1')
        .to(tiles, { opacity: 1, y: 0, scale: 1, duration: 0.7, stagger: 0.04, ease: spring }, '-=.8')

      // Demo cursor walking the dashboard.
      const cur = $('#cur')!
      const screen = $('#screen')!
      const tgt = (sel: string) => {
        const s = screen.getBoundingClientRect()
        const r = $(sel)!.getBoundingClientRect()
        const k = s.width / screen.offsetWidth
        return { x: (r.left - s.left) / k + (r.width / k) * 0.5, y: (r.top - s.top) / k + (r.height / k) * 0.5 }
      }
      gsap.set(cur, { x: 420, y: 300, opacity: 0 })
      gsap
        .timeline({ repeat: -1, delay: 4.2, repeatDelay: 1 })
        .to(cur, { opacity: 1, duration: 0.3 })
        .to(cur, { x: () => tgt('.sel').x, y: () => tgt('.sel').y, duration: 1.2, ease: 'power3.inOut' })
        .to(cur, { scale: 0.8, duration: 0.1, yoyo: true, repeat: 1 })
        .to('.sel', { scale: 1.05, duration: 0.15, yoyo: true, repeat: 1 }, '<')
        .to(cur, { x: () => tgt('.qa-btn').x, y: () => tgt('.qa-btn').y, duration: 1.3, ease: 'power3.inOut' }, '+=.4')
        .to(cur, { scale: 0.8, duration: 0.1, yoyo: true, repeat: 1 })
        .to('.qa-btn', { scale: 0.96, duration: 0.12, yoyo: true, repeat: 1 }, '<')
        .to(cur, { x: () => tgt('.invite.t').x, y: () => tgt('.invite.t').y, duration: 1.3, ease: 'power3.inOut' }, '+=.4')
        .to('.invite.t', { y: -3, duration: 0.3, yoyo: true, repeat: 1 }, '<.9')
        .to(cur, { opacity: 0, duration: 0.4 }, '+=.8')

      $$<SVGPathElement>('.linec .ln1,.linec .ln2').forEach((p, i) => {
        const l = p.getTotalLength()
        gsap.fromTo(
          p,
          { strokeDasharray: l, strokeDashoffset: l },
          { strokeDashoffset: 0, duration: 2.2, delay: i * 0.3, ease: 'power2.inOut', repeat: -1, repeatDelay: 2.5, yoyo: true },
        )
      })
      gsap.from('#toast', { y: 30, opacity: 0, duration: 0.8, delay: 3.2, ease: 'back.out(1.8)' })

      // Desktop-only scroll scenes.
      mm.add('(min-width:901px)', () => {
        gsap.fromTo('#laptop', { scale: 1.08 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '#stage', start: 'top 85%', end: 'top 15%', scrub: 0.6 } })
        const rx = gsap.quickTo('#laptop', 'rotationY', { duration: 0.8, ease: 'power3' })
        const ry = gsap.quickTo('#laptop', 'rotationX', { duration: 0.8, ease: 'power3' })
        const mv = (e: PointerEvent) => {
          rx((e.clientX / window.innerWidth - 0.5) * 5)
          ry(-(e.clientY / window.innerHeight - 0.5) * 4)
        }
        window.addEventListener('pointermove', mv)
        const tr = $('#track')!
        gsap.to(tr, {
          x: () => -(tr.scrollWidth - window.innerWidth),
          ease: 'none',
          scrollTrigger: { trigger: '#modules', start: 'top top', end: () => `+=${tr.scrollWidth - window.innerWidth}`, pin: true, scrub: 0.7, invalidateOnRefresh: true },
        })
        gsap.from('.panel', { y: 80, opacity: 0, stagger: 0.08, duration: 1.1, ease: spring, scrollTrigger: { trigger: '#modules', start: 'top 85%' } })
        const tks = $$('.tk')
        gsap.set(tks.slice(1), { opacity: 0, yPercent: 100 })
        const beats = $$('.beat')
        const S = [$$('.s1'), $$('.s2'), $$('.s3'), $$('.s4')]
        gsap.set(beats.slice(1), { opacity: 0 })
        S.slice(1).forEach((s) => gsap.set(s, { opacity: 0, y: 40, scale: 0.96 }))
        const st = gsap.timeline({ scrollTrigger: { trigger: '#story', start: 'top top', end: '+=2200', pin: true, scrub: 0.7 } })
        st.to({}, { duration: 0.6 })
        for (let i = 1; i < 4; i++) {
          st.to(tks[i - 1], { yPercent: -100, opacity: 0, duration: 0.45, ease: 'power3.inOut' })
            .fromTo(tks[i], { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.45, ease: 'power3.inOut' }, '<')
            .to(beats[i - 1], { opacity: 0, y: -30, duration: 0.3 }, '<')
            .to(S[i - 1], { opacity: 0, y: -40, scale: 0.96, stagger: 0.04, duration: 0.35 }, '<')
            .fromTo(beats[i], { y: 30 }, { opacity: 1, y: 0, duration: 0.35 }, '<.2')
            .to(S[i], { opacity: 1, y: 0, scale: 1, stagger: 0.06, duration: 0.45, ease: 'back.out(1.4)' }, '<')
            .to({}, { duration: 0.6 })
        }
        return () => window.removeEventListener('pointermove', mv)
      })

      $$('.mask').forEach((h) =>
        gsap.from($$('.ln>span', h), { yPercent: 115, rotate: 2, duration: 1.2, stagger: 0.1, ease: expo, scrollTrigger: { trigger: h, start: 'top 98%' } }),
      )
      ScrollTrigger.batch($$('.reveal'), {
        start: 'top 100%',
        onEnter: (b) => gsap.to(b, { opacity: 1, y: 0, duration: 1.1, stagger: 0.08, ease: expo, overwrite: true }),
      })
      const pcs = $$('#ttg .p')
      gsap.set(pcs, { opacity: 0, scale: 0.6, y: 10 })
      gsap.to(pcs, { opacity: 1, scale: 1, y: 0, ease: spring, stagger: { each: 0.08, from: 'start' }, scrollTrigger: { trigger: '#tt', start: 'top 95%', end: 'top 35%', scrub: 0.6 } })
      gsap.from('#n2', { opacity: 0, rotate: -15, y: 10, duration: 0.8, ease: spring, scrollTrigger: { trigger: '#tt', start: 'top 85%' } })

      // Report card: ticks, stamp, confetti.
      const ticks = $$('#rc td:last-child span')
      gsap.set(ticks, { scale: 0, rotate: -30, opacity: 0 })
      gsap.set('#stamp', { scale: 2.6, opacity: 0, rotate: -40 })
      gsap
        .timeline({ scrollTrigger: { trigger: '#rc', start: 'top 88%' } })
        .from('#rc', { y: 80, rotate: 4, opacity: 0, duration: 1.1, ease: expo })
        .to(ticks, { scale: 1, rotate: 0, opacity: 1, stagger: 0.16, duration: 0.5, ease: 'back.out(3)' }, '-=.4')
        .to('#stamp', { scale: 1, opacity: 0.92, rotate: -14, duration: 0.45, ease: 'power4.in' }, '+=.2')
        .to('#rc', { x: -6, y: 4, duration: 0.06, yoyo: true, repeat: 3 }, '>')
        .add(() => {
          const r = $('#stamp')!.getBoundingClientRect()
          burst(r.left + r.width / 2, r.top + r.height / 2)
        }, '<')

      // Magnetic buttons.
      if (window.matchMedia('(hover:hover)').matches) {
        $$('.mag').forEach((b) => {
          const x = gsap.quickTo(b, 'x', { duration: 0.6, ease: 'elastic.out(1,.4)' })
          const y = gsap.quickTo(b, 'y', { duration: 0.6, ease: 'elastic.out(1,.4)' })
          const move = (e: PointerEvent) => {
            const r = b.getBoundingClientRect()
            x((e.clientX - r.left - r.width / 2) * 0.3)
            y((e.clientY - r.top - r.height / 2) * 0.4)
          }
          const leave = () => {
            x(0)
            y(0)
          }
          b.addEventListener('pointermove', move)
          b.addEventListener('pointerleave', leave)
          cleanups.push(() => {
            b.removeEventListener('pointermove', move)
            b.removeEventListener('pointerleave', leave)
          })
        })
      }
    }, root)

    // Fonts change line lengths; re-measure scroll positions once they're in.
    let alive = true
    document.fonts?.ready.then(() => alive && ScrollTrigger.refresh())
    listen('load', () => ScrollTrigger.refresh())

    return () => {
      alive = false
      timers.forEach(clearInterval)
      cleanups.forEach((f) => f())
      mm.revert()
      ctx.revert()
      gsap.ticker.remove(raf)
      lenis.destroy()
      confetti.forEach((d) => d.remove())
    }
  }, [rootRef])
}
