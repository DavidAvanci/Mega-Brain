export type TaskSound = 'started' | 'input' | 'finished' | 'failed'

let audio: AudioContext | undefined

const cues: Record<TaskSound, Array<[frequency: number, duration: number]>> = {
  started: [
    [523.25, 0.07],
    [659.25, 0.07],
    [783.99, 0.13],
  ],
  input: [
    [659.25, 0.08],
    [0, 0.055],
    [659.25, 0.08],
    [987.77, 0.15],
  ],
  finished: [
    [523.25, 0.065],
    [659.25, 0.065],
    [783.99, 0.065],
    [1046.5, 0.2],
  ],
  failed: [
    [392, 0.1],
    [311.13, 0.12],
    [261.63, 0.22],
  ],
}

export function playTaskSound(kind: TaskSound) {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
    let cursor = audio.currentTime
    for (const [frequency, duration] of cues[kind]) {
      if (frequency) {
        const oscillator = audio.createOscillator()
        const gain = audio.createGain()
        oscillator.type = 'square'
        oscillator.frequency.value = frequency
        gain.gain.setValueAtTime(0.0001, cursor)
        gain.gain.exponentialRampToValueAtTime(0.035, cursor + 0.006)
        gain.gain.setValueAtTime(0.035, cursor + Math.max(0.007, duration - 0.035))
        gain.gain.exponentialRampToValueAtTime(0.0001, cursor + duration)
        oscillator.connect(gain).connect(audio.destination)
        oscillator.onended = () => {
          oscillator.disconnect()
          gain.disconnect()
        }
        oscillator.start(cursor)
        oscillator.stop(cursor + duration)
      }
      cursor += duration + 0.012
    }
  } catch {
    // Audio may be unavailable until the webview receives a user gesture.
  }
}
