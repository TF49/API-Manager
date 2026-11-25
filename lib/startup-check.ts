/**
 * Production startup security check. Imported only from instrumentation.ts, Node.js runtime only.
 * Refuses to boot with an insecure configuration instead of discovering it later.
 */
import { encryptSecretProblem } from './crypto';

export function collectConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];

  const secretProblem = encryptSecretProblem(env.ENCRYPT_SECRET);
  if (secretProblem) problems.push(secretProblem);

  const origin = env.APP_ORIGIN;
  if (!origin) {
    problems.push('APP_ORIGIN 未设置（例如 https://api.example.com），CSRF 校验需要它');
  } else {
    try {
      const u = new URL(origin);
      if (u.protocol !== 'https:') problems.push('APP_ORIGIN 必须是 https:// 地址');
      if (u.pathname !== '/' || u.search || u.hash) problems.push('APP_ORIGIN 只能包含协议、域名和端口');
    } catch {
      problems.push('APP_ORIGIN 不是合法 URL');
    }
  }

  if (env.TRUST_PROXY !== '1') {
    problems.push(
      'TRUST_PROXY 未设为 1。生产环境应部署在 Nginx/Caddy 之后并监听 127.0.0.1，否则无法识别客户端 IP，所有人会共用一个限流桶'
    );
  }

  return problems;
}

export function assertSecureProductionConfig(): void {
  const problems = collectConfigProblems();
  if (!problems.length) return;
  console.error(['[security] 生产环境配置不安全，拒绝启动：', ...problems.map((p) => `  - ${p}`)].join('\n'));
  // Next only logs a throw from register() and keeps serving 500s; exit so a process manager notices.
  process.exit(1);
}
