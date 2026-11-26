// GET /api/groups - 获取所有分组标签（预设分组 + 已使用的自定义分组）
import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/guard';
import { mergeGroups } from '@/lib/groups';

async function handleGET() {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT DISTINCT group_tag FROM sites WHERE group_tag IS NOT NULL AND group_tag != '' ORDER BY group_tag ASC"
    );
    return NextResponse.json({ success: true, data: mergeGroups(rows.map((r) => String(r.group_tag))) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '获取分组失败';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export const GET = withAuth(handleGET);
