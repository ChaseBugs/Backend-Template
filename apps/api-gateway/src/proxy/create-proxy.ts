import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { Logger } from '@ecommerce/logger';

export function createServiceProxy(target: string, pathRewrite?: Record<string, string>, logger?: Logger) {
  const options: Options = {
    target,
    changeOrigin: true,
    pathRewrite,
    on: {
      error: (err, req, res) => {
        logger?.error({ err, target }, 'Proxy error');
        if (res && 'status' in res) {
          (res as any).status(503).json({
            success: false,
            error: { code: 'SERVICE_UNAVAILABLE', message: 'Upstream service unavailable' },
          });
        }
      },
    },
  };
  return createProxyMiddleware(options);
}
