# API Manager

自托管的中转站比价面板：自动获取各个中转站的「分组 + 模型 + 倍率」，按模型类别（GPT / Claude / Gemini / 国模）横向对比，一眼找到同一模型最便宜的站点和分组，并记录每次倍率变动。

## 功能

| 页面 | 作用 |
|---|---|
| 价格对比（首页） | 选类别看所有站点、所有分组的倍率，从低到高排；再选具体模型，按**实际价格**（模型基础价 × 分组倍率，美元/百万 token）排序。最便宜的一行高亮，分组倍率变动和模型基础价变动都显示 ↑/↓ 和原值 |
| 倍率变动 | 每次同步发现的分组倍率涨跌、模型基础价涨跌、分组和模型的上架/下架，可按类别和类型筛选；导航栏显示未读数 |
| 站点管理 | 只需填站点地址（sub2api 站点可选填登录账号）；添加或修改后自动获取一次 |
| 站点详情 | 全部分组及其模型、基础价和实际价；分组类别判断不准时可以手动改 |
| 分组查询 | 临时查询任意站点的分组，不保存 |

**自动更新**：服务启动后每 `PRICE_REFRESH_MINUTES` 分钟（默认 30）同步全部站点，对比页每 30 秒刷新一次，有新变动时弹出提示。「立即同步」在后台运行，页面轮询进度，不受反向代理超时限制。

**变动记录规则**：站点第一次获取（或改了 Base URL 的域名）时不记录变动，避免和旧数据对比出大量噪音；同一个模型在多个分组里的同一次调价合并成一条。

**分类规则**：按模型名判断（`lib/model-category.ts`），分组的类别是组内所有模型类别的并集，一个分组可以同时属于多个类别。没有模型数据时，按 sub2api 平台或分组名推断。

**价格口径**：这里的「美元」是站点的额度单位，没有考虑各站充值汇率的差异。

技术栈：Next.js 16 (App Router) · React 19 · MySQL · Tailwind CSS 4

## 分组倍率获取

站点详情页的「获取分组」和「分组查询」页会自动识别站点架构：

| 架构 | 数据来源 | 需要凭据 |
|---|---|---|
| new-api / one-api | `/api/pricing`、`/api/user/groups` | 不需要 |
| sub2api（已开放模型广场） | `/api/v1/model-plaza` | 不需要 |
| sub2api（未开放模型广场） | 登录后读 `/api/v1/groups/available`、`/api/v1/groups/rates` | 站点账号邮箱和密码 |

sub2api 站点没开放模型广场时，在「编辑站点 → sub2api 登录」里填写账号。获取分组时会自动登录，读完立即退出（撤销本次 refresh token）。密码用 `ENCRYPT_SECRET` 加密存储，不会返回给浏览器。读到的是这个账号能用的分组，倍率是实际生效的倍率（有个人专属倍率时优先用它）。站点开启了验证码、两步验证或后台模式时，无法自动登录。

## 本地开发

```bash
npm install
npm run db:init                 # 建库、建表、迁移（可重复执行）
npm run user:create -- admin    # 创建管理员，会提示输入密码
npm run dev
```

数据库连接从环境变量读取：`DB_HOST`、`DB_PORT`、`DB_USERNAME`、`DB_PASSWORD`、`DB_NAME`。

## 登录与安全设计

系统只有登录，没有注册。管理员账号只能在服务器上用 CLI 创建。

| 机制 | 实现 |
|---|---|
| 密码存储 | Argon2id（64 MiB / t=3）；用户名不存在时也做一次等价耗时的校验，不泄露账号是否存在 |
| 密码策略 | 至少 12 位，包含大写字母、小写字母、数字、符号中的至少三类 |
| 会话 | 服务端会话存在 MySQL；Cookie 里是 256 位随机 token，库里只存 SHA-256；`HttpOnly` + `Secure` + `SameSite=Strict` + `__Host-` 前缀 |
| 会话时长 | 空闲 30 分钟或登录满 12 小时即失效；每个用户最多 5 个会话，超出时淘汰最早的 |
| 立即吊销 | 退出、改密码、禁用账号时，相关会话立刻失效 |
| 限流 | 每个 IP 15 分钟内最多 10 次尝试；每个用户名 15 分钟内最多 5 次。超出后锁定 15 分钟，再犯翻倍（IP 最长 24 小时，用户名最长 1 小时）。尝试次数在校验密码**之前**原子预占，并发请求无法绕过 |
| 防 CPU 耗尽 | 同时最多 4 个 Argon2 校验，排队超过 32 个直接返回 503 |
| CSRF | 写操作要求 `Origin` 与 `APP_ORIGIN` 一致，并检查 `Sec-Fetch-Site`；Cookie 为 SameSite=Strict |
| 鉴权位置 | `proxy.ts` 只做第一道粗筛；**每个 API 路由**都用 `withAuth()` 在数据旁再校验一次 |
| 审计 | `auth_audit_log` 记录登录成功、失败、被锁、登出、改密、禁用 |
| 安全响应头 | CSP、HSTS、`X-Frame-Options: DENY`、`nosniff`、`Referrer-Policy: no-referrer`、COOP/CORP |
| SSRF | 服务器请求站点 `base_url` 时，在**建立连接时**校验 DNS 结果，禁止访问内网、本机、云元数据和保留地址（防 DNS rebinding）；只跟随同主机跳转，登录凭据不会被带到其他域名 |
| 启动自检 | 生产环境缺少 `APP_ORIGIN`、`TRUST_PROXY`，或 `ENCRYPT_SECRET` 不合格时直接拒绝启动 |

> CSP 说明：项目开启了 `cacheComponents`，它和 nonce 型 CSP 不兼容，所以 `script-src` 带 `'unsafe-inline'`，其他指令都已收紧。会话 Cookie 是 HttpOnly，脚本读不到。

### 管理命令

```bash
npm run user:create  -- <用户名>       # 创建管理员（隐藏输入密码，也支持从 stdin 管道读入）
npm run user:passwd  -- <用户名>       # 改密码，同时注销该用户的所有会话
npm run user:disable -- <用户名>       # 禁用账号，同时注销其所有会话
npm run user:enable  -- <用户名>
npm run user:list
npm run sessions:revoke -- <用户名>    # 让该用户在所有设备上退出登录
npm run auth:unlock  -- [ip:<地址> | user:<用户名>]   # 解除登录锁定；不带参数则清空全部锁定
```

## 生产部署（GitHub + 一键脚本）

适用于已经装好 **Node.js 20.9+、MySQL/MariaDB、Nginx** 的 Linux 服务器，使用 IP + 自签名证书提供 HTTPS。

### 首次部署

```bash
# 1. 在服务器上生成只读部署密钥，把公钥加到 GitHub 仓库 Settings → Deploy keys（不要勾 write）
ssh-keygen -t ed25519 -N "" -f ~/.ssh/api_manager_deploy -C "api-manager deploy"
cat ~/.ssh/api_manager_deploy.pub
cat >> ~/.ssh/config <<'EOF'
Host github-api-manager
    HostName github.com
    User git
    IdentityFile ~/.ssh/api_manager_deploy
    IdentitiesOnly yes
EOF

# 2. 拉代码并安装
git clone git@github-api-manager:<你的用户名>/<仓库名>.git /opt/api-manager
cd /opt/api-manager
sudo bash deploy/install.sh
```

`deploy/install.sh` 会依次完成：

1. 检查 Node / npm / nginx / openssl / mysql 是否就绪
2. 询问服务器 IP、对外 HTTPS 端口（默认 8443，避开已有网站的 443）、内部端口（默认 3100）
3. 用 MySQL root 建库，并建一个**只拥有这个库权限**的专用账号（密码随机生成）
4. 生成 `.env.production.local`：数据库连接、随机的 `ENCRYPT_SECRET`、`APP_ORIGIN`、`TRUST_PROXY=1`（权限 640，不进 git）
5. `npm ci` → `npm run build` → `npm run db:init`
6. 注册 systemd 服务 `api-manager`：以低权限用户 `apimanager` 运行，只监听 `127.0.0.1`，开机自启
7. 为这个 IP 生成自签名证书，写入 Nginx 配置（覆盖 `X-Real-IP`，对登录接口额外限速）
8. 引导创建第一个管理员

安装完后访问 `https://<服务器IP>:8443`。浏览器会提示证书不受信任，点「高级 → 继续前往」即可。别忘了在云服务商的安全组里放行这个端口。

### 更新

```bash
# 本地
git push

# 服务器
cd /opt/api-manager && git pull && sudo bash deploy/install.sh
```

重复执行安装脚本是安全的：已有的密钥、数据库、证书和 Nginx 端口都会沿用，只重新构建、迁移、重启。

### 日常运维

```bash
journalctl -u api-manager -f              # 看日志
systemctl restart api-manager             # 重启
cd /opt/api-manager && npm run user:list  # 账号管理（user:create / user:passwd / user:disable / auth:unlock ...）
```

**一定要备份 `/opt/api-manager/.env.production.local`**：丢了里面的 `ENCRYPT_SECRET`，库里所有 sub2api 登录密码都无法解密。

### 环境变量参考

| 变量 | 说明 |
|---|---|
| `PRICE_REFRESH_MINUTES` | 可选。定时同步间隔（分钟），默认 30，设为 `0` 关闭定时同步 |
| `DB_HOST` `DB_PORT` `DB_USERNAME` `DB_PASSWORD` `DB_NAME` | MySQL 连接信息 |
| `ENCRYPT_SECRET` | 加密 sub2api 登录密码的密钥，至少 32 位，不能是默认值 |
| `APP_ORIGIN` | 对外访问地址，必须是 https，例如 `https://1.2.3.4:8443` |
| `TRUST_PROXY` | 设为 `1`，信任 Nginx 传入的 `X-Real-IP` |
| `SSRF_ALLOWED_HOSTS` | 可选。允许访问的内网主机，逗号分隔，例如同机部署的中转 `localhost` |
| `SSRF_ALLOWED_CIDRS` | 可选。允许访问的内网网段。开发环境默认 `198.18.0.0/15`（Clash 等的 fake-ip 网段），生产环境默认为空 |

生产环境缺少 `APP_ORIGIN`、`TRUST_PROXY`，或 `ENCRYPT_SECRET` 不合格时，服务会拒绝启动。

### 迁移旧数据时更换加密密钥

如果要把用默认密钥加密的旧数据搬到线上，先重新加密（sub2api 登录密码）：

```bash
DRY_RUN=1 NEW_ENCRYPT_SECRET=<新密钥> npm run secret:rotate   # 演练，不写库
NEW_ENCRYPT_SECRET=<新密钥> npm run secret:rotate             # 正式执行（单事务，失败即回滚）
```

旧密钥不是默认值时，另外传 `OLD_ENCRYPT_SECRET=<旧密钥>`。

## 测试

```bash
npm test          # 单元测试：分组/模型/价格解析、模型分类、限流状态机、Origin 校验、IP 识别、SSRF 地址判断、会话过期规则、密码策略
npm run typecheck
```
