import '../scripts/load-env';
import mysql from 'mysql2/promise';

async function ensureColumn(
  conn: mysql.Connection,
  dbName: string,
  table: string,
  column: string,
  definition: string
) {
  const [rows] = (await conn.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [dbName, table, column]
  ));
  if (Number(rows[0]?.cnt) === 0) {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function initDB() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    timezone: '+08:00',
  });

  const dbName = process.env.DB_NAME || 'api_manager';

  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${dbName}\``);

  // Sites table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS sites (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL COMMENT '站点名称',
      base_url VARCHAR(500) NOT NULL COMMENT 'Base URL',
      api_key_encrypted TEXT DEFAULT NULL COMMENT '加密后的 API Key(可选,仅连通/模型测试需要)',
      group_tag VARCHAR(100) DEFAULT NULL COMMENT '分组标签',
      notes TEXT DEFAULT NULL COMMENT '备注',
      status ENUM('unknown','ok','error','quota') DEFAULT 'unknown' COMMENT '状态',
      last_tested_at DATETIME DEFAULT NULL COMMENT '最后测试时间',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // API Key is optional: group/ratio fetching works without one
  await conn.query(
    `ALTER TABLE sites MODIFY COLUMN api_key_encrypted TEXT DEFAULT NULL COMMENT '加密后的 API Key(可选,仅连通/模型测试需要)'`
  );

  // sub2api site account: only used to log in and read groups when the model plaza is not public
  await ensureColumn(conn, dbName, 'sites', 'login_email', "VARCHAR(255) DEFAULT NULL COMMENT 'sub2api 登录邮箱(可选)' AFTER api_key_encrypted");
  await ensureColumn(conn, dbName, 'sites', 'login_password_encrypted', "TEXT DEFAULT NULL COMMENT '加密后的 sub2api 登录密码(可选)' AFTER login_email");

  // Models table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS models (
      id INT AUTO_INCREMENT PRIMARY KEY,
      site_id INT NOT NULL,
      model_id VARCHAR(200) NOT NULL COMMENT '模型标识符',
      owned_by VARCHAR(200) DEFAULT NULL COMMENT '所属组织',
      model_created_at BIGINT DEFAULT NULL COMMENT '模型创建时间戳',
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '拉取时间',
      test_status ENUM('unknown','ok','error','quota','timeout') DEFAULT 'unknown' COMMENT '模型测试状态',
      test_latency_ms INT DEFAULT NULL COMMENT '模型测试延迟(ms)',
      test_status_code INT DEFAULT NULL COMMENT '模型测试HTTP状态码',
      test_error_msg TEXT DEFAULT NULL COMMENT '模型测试错误信息',
      last_tested_at DATETIME DEFAULT NULL COMMENT '最后测试时间',
      UNIQUE KEY uq_site_model (site_id, model_id),
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migrate existing models table if needed
  await ensureColumn(conn, dbName, 'models', 'test_status', "ENUM('unknown','ok','error','quota','timeout') DEFAULT 'unknown' COMMENT '模型测试状态'");
  await ensureColumn(conn, dbName, 'models', 'test_latency_ms', "INT DEFAULT NULL COMMENT '模型测试延迟(ms)'");
  await ensureColumn(conn, dbName, 'models', 'test_status_code', "INT DEFAULT NULL COMMENT '模型测试HTTP状态码'");
  await ensureColumn(conn, dbName, 'models', 'test_error_msg', "TEXT DEFAULT NULL COMMENT '模型测试错误信息'");
  await ensureColumn(conn, dbName, 'models', 'last_tested_at', "DATETIME DEFAULT NULL COMMENT '最后测试时间'");

  // Call history table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS call_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      site_id INT NOT NULL,
      site_name VARCHAR(100) DEFAULT NULL,
      model_id VARCHAR(200) DEFAULT NULL COMMENT '被测模型ID',
      action_type ENUM('test','fetch_models','batch_test','model_test','fetch_groups') NOT NULL COMMENT '操作类型',
      status ENUM('ok','error','quota','timeout') NOT NULL,
      status_code INT DEFAULT NULL,
      latency_ms INT DEFAULT NULL COMMENT '响应延迟(ms)',
      error_msg TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migrate existing call_history table if needed
  await ensureColumn(conn, dbName, 'call_history', 'model_id', "VARCHAR(200) DEFAULT NULL COMMENT '被测模型ID' AFTER site_name");
  await conn.query(
    `ALTER TABLE call_history MODIFY COLUMN action_type ENUM('test','fetch_models','batch_test','model_test','fetch_groups') NOT NULL COMMENT '操作类型'`
  );

  // Pricing groups (计费分组及倍率) fetched from the upstream new-api/one-api site
  await conn.query(`
    CREATE TABLE IF NOT EXISTS site_price_groups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      site_id INT NOT NULL,
      group_name VARCHAR(100) NOT NULL COLLATE utf8mb4_bin COMMENT '分组名(区分大小写和空格)',
      ratio DOUBLE DEFAULT NULL COMMENT '分组倍率',
      svip_ratio DOUBLE DEFAULT NULL COMMENT '会员倍率(部分站点提供)',
      prev_ratio DOUBLE DEFAULT NULL COMMENT '最近一次变动前的倍率',
      ratio_changed_at DATETIME DEFAULT NULL COMMENT '倍率最近一次变动时间',
      description VARCHAR(500) DEFAULT NULL COMMENT '分组说明',
      model_count INT DEFAULT NULL COMMENT '分组可用模型数',
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '拉取时间',
      UNIQUE KEY uq_site_group (site_id, group_name),
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ---- Authentication ----
  // All auth timestamps are BIGINT epoch milliseconds: no timezone ambiguity.

  await conn.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) NOT NULL COLLATE utf8mb4_unicode_ci COMMENT '登录名(大小写不敏感)',
      password_hash VARCHAR(255) NOT NULL COMMENT 'Argon2id 哈希',
      is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
      password_changed_at BIGINT NOT NULL DEFAULT 0 COMMENT '改密时间,早于此时间的会话全部失效',
      last_login_at BIGINT DEFAULT NULL,
      last_login_ip VARCHAR(64) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash CHAR(64) NOT NULL PRIMARY KEY COMMENT '会话 token 的 SHA-256,不存明文',
      user_id INT NOT NULL,
      created_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL COMMENT '绝对过期时间',
      ip VARCHAR(64) DEFAULT NULL,
      user_agent VARCHAR(255) DEFAULT NULL,
      KEY idx_user (user_id, created_at),
      KEY idx_expires (expires_at),
      FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS auth_rate_limits (
      bucket_key VARCHAR(128) NOT NULL PRIMARY KEY COMMENT 'ip:<addr> 或 user:<name>',
      attempt_count INT NOT NULL DEFAULT 0,
      window_start BIGINT NOT NULL DEFAULT 0,
      locked_until BIGINT NOT NULL DEFAULT 0,
      lock_level INT NOT NULL DEFAULT 0,
      last_attempt_at BIGINT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS auth_audit_log (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      event VARCHAR(32) NOT NULL,
      user_id INT DEFAULT NULL,
      username_attempted VARCHAR(64) DEFAULT NULL,
      ip VARCHAR(64) DEFAULT NULL,
      user_agent VARCHAR(255) DEFAULT NULL,
      detail VARCHAR(255) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_created (created_at),
      KEY idx_event (event, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.end();
  console.log('✅ Database initialized & migrated successfully');
}

initDB().catch((err) => {
  console.error('❌ Database init failed:', err.message);
  process.exit(1);
});
