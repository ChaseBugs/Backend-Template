import pino, { Logger, LoggerOptions } from 'pino';

export interface CreateLoggerOptions {
  service: string;
  level?: string;
  pretty?: boolean;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const { service, level = process.env.LOG_LEVEL || 'info', pretty = process.env.NODE_ENV !== 'production' } = options;

  const pinoOptions: LoggerOptions = {
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
  };

  if (pretty) {
    return pino({
      ...pinoOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino(pinoOptions);
}

export type { Logger };
export { pino };
