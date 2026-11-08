export interface TimeLeft {
  hours: number
  minutes: number
  seconds: number
  totalSeconds: number
  formatted: string
  isUrgent: boolean
  isExpired: boolean
}

export function computeTimeLeft(deadlineAt: string, now: number = Date.now()): TimeLeft {
  const target = Date.parse(deadlineAt)
  const remainingMs = Math.max(0, target - now)
  const totalSeconds = Math.floor(remainingMs / 1000)

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const pad = (n: number) => String(n).padStart(2, '0')
  const formatted = hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`

  return {
    hours,
    minutes,
    seconds,
    totalSeconds,
    formatted,
    isUrgent: totalSeconds < 300 && totalSeconds > 0, // < 5 minutes
    isExpired: totalSeconds === 0,
  }
}
