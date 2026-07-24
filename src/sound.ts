// Web Audio API Synthesizer for Snake Game
let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (AudioContextClass) {
            audioCtx = new AudioContextClass()
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume()
    }
    return audioCtx
}

export function playEatSound(enabled = true) {
    if (!enabled) return
    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'square'
    osc.frequency.setValueAtTime(523.25, now) // C5
    osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.08) // E5
    osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.15) // G5

    gain.gain.setValueAtTime(0.12, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.16)

    triggerHaptic(20)
}

export function playBonusSound(enabled = true) {
    if (!enabled) return
    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    const notes = [523.25, 659.25, 783.99, 1046.50] // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()

        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq, now + idx * 0.05)

        gain.gain.setValueAtTime(0.15, now + idx * 0.05)
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.1)

        osc.connect(gain)
        gain.connect(ctx.destination)

        osc.start(now + idx * 0.05)
        osc.stop(now + idx * 0.05 + 0.1)
    })

    triggerHaptic([30, 30, 50])
}

export function playPowerUpSound(enabled = true) {
    if (!enabled) return
    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(400, now)
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.25)

    gain.gain.setValueAtTime(0.2, now)
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.25)

    triggerHaptic([40, 60])
}

export function playDeathSound(enabled = true) {
    if (!enabled) return
    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(300, now)
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.35)

    gain.gain.setValueAtTime(0.25, now)
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.35)

    triggerHaptic([100, 50, 100])
}

export function playHighScoreSound(enabled = true) {
    if (!enabled) return
    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    const freqs = [523.25, 659.25, 783.99, 1046.50, 1318.51] // C5, E5, G5, C6, E6
    freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()

        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, now + idx * 0.08)

        gain.gain.setValueAtTime(0.2, now + idx * 0.08)
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.2)

        osc.connect(gain)
        gain.connect(ctx.destination)

        osc.start(now + idx * 0.08)
        osc.stop(now + idx * 0.08 + 0.2)
    })
}

export function triggerHaptic(pattern: number | number[]) {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
            navigator.vibrate(pattern)
        } catch {
            // ignore if unsupported
        }
    }
}
