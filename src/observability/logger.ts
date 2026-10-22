/**
 * The logs of the studio (spec §9).
 *
 * The logs are structured: every line is a json document with a level, a
 * message and the fields of the event. The identifiers of the request and
 * of the caller travel with the event, so a line of the studio can be
 * followed in the logs of the gateway and in the logs of the backend.
 *
 * The studio never writes a token, a secret or the body of a row in a
 * log: the fields of an event are chosen by the caller of the logger and
 * the values that could carry a credential are not among them.
 */

/** The levels of a log. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** The logger of the studio. */
export interface Logger {
  debug: (message: string, fields?: Record<string, unknown>) => void
  info: (message: string, fields?: Record<string, unknown>) => void
  warn: (message: string, fields?: Record<string, unknown>) => void
  error: (message: string, fields?: Record<string, unknown>) => void
}

/** The options of the logger. */
export interface LoggerOptions {
  /** The level below which nothing is written. */
  readonly level?: LogLevel
  /** The sink of the lines. */
  readonly write?: (line: string) => void
}

/** The order of the levels. */
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** The logger that writes to the console. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = LEVELS[options.level ?? 'info']
  const write = options.write ?? ((line: string) => console.log(line))
  const log =
    (level: LogLevel) =>
    (message: string, fields: Record<string, unknown> = {}) => {
      if (LEVELS[level] < threshold) return
      const line = JSON.stringify({
        level,
        time: new Date().toISOString(),
        service: 'bridge',
        message,
        ...fields,
      })
      write(line)
    }
  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
  }
}

/** The logger that writes nothing. */
export function silentLogger(): Logger {
  return createLogger({ level: 'error', write: () => {} })
}
