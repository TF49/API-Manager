import { decrypt } from '@/lib/crypto';
import type { Sub2apiCredentials } from '@/lib/price-groups';

/**
 * sub2api 站点账号（登录邮箱 + 加密密码）。
 * 只在站点没开放模型广场时用来登录读取分组；密码和 API Key 一样用 ENCRYPT_SECRET 加密存储，从不返回给前端。
 */

const MAX_EMAIL_LEN = 255;
const MAX_PASSWORD_LEN = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SiteLoginInputError extends Error {}

export interface LoginInput {
  /** 规范化后的邮箱；null 表示不保存账号 */
  email: string | null;
  /** 新密码明文；null 表示不修改 */
  password: string | null;
  /** 显式清除已保存的账号 */
  clear: boolean;
}

/** 从请求体读取并校验登录信息（login_email / login_password / clear_login） */
export function readLoginInput(body: Record<string, unknown>): LoginInput {
  const clear = body.clear_login === true;
  const rawEmail = typeof body.login_email === 'string' ? body.login_email.trim() : '';
  // 密码不 trim：空格可能是密码的一部分，只判断是否全空
  const rawPassword = typeof body.login_password === 'string' ? body.login_password : '';

  if (clear) return { email: null, password: null, clear: true };

  if (rawEmail && (rawEmail.length > MAX_EMAIL_LEN || !EMAIL_RE.test(rawEmail))) {
    throw new SiteLoginInputError('sub2api 登录邮箱格式不正确');
  }
  if (rawPassword.length > MAX_PASSWORD_LEN) {
    throw new SiteLoginInputError('sub2api 登录密码过长');
  }
  const password = rawPassword.trim() ? rawPassword : null;
  if (password && !rawEmail) {
    throw new SiteLoginInputError('填写了 sub2api 登录密码，也需要填写登录邮箱');
  }
  return { email: rawEmail || null, password, clear: false };
}

/**
 * 计算要写入数据库的值。
 * hasStoredPassword：编辑时站点是否已有密码（新增时为 false）。
 * 返回 undefined 的字段表示保持不变。
 */
export function resolveLoginColumns(
  input: LoginInput,
  hasStoredPassword: boolean,
  encrypt: (plain: string) => string
): { login_email: string | null; login_password_encrypted?: string | null } {
  if (input.clear || !input.email) return { login_email: null, login_password_encrypted: null };
  if (input.password) return { login_email: input.email, login_password_encrypted: encrypt(input.password) };
  if (!hasStoredPassword) throw new SiteLoginInputError('填写了 sub2api 登录邮箱，也需要填写登录密码');
  return { login_email: input.email };
}

/** 去掉加密字段后返回给前端的站点数据 */
export function toPublicSite<T extends Record<string, unknown>>(row: T) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { api_key_encrypted, login_password_encrypted, ...rest } = row;
  return {
    ...rest,
    login_email: (row.login_email as string | null | undefined) ?? null,
    has_login_password: !!login_password_encrypted,
  };
}

/** 取出可用于 sub2api 登录的凭据；没配置完整时返回 null */
export function siteCredentials(row: { login_email?: string | null; login_password_encrypted?: string | null }): Sub2apiCredentials | null {
  if (!row.login_email || !row.login_password_encrypted) return null;
  return { email: row.login_email, password: decrypt(row.login_password_encrypted) };
}

/** 数据库还没迁移（缺新列）时给出可操作的提示 */
export function schemaErrorMessage(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') return '数据库结构需要更新，请先运行 npm run db:init 完成迁移';
    if (err.code === 'ER_NO_SUCH_TABLE') return '数据表不存在，请先运行 npm run db:init 完成数据库迁移';
  }
  return null;
}
