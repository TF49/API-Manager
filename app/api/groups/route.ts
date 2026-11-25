// GET /api/groups - 获取所有分组标签
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/guard';

async function handleGET() {
  try {
    const [rows] = await pool.query(
      "SELECT DISTINCT group_tag FROM sites WHERE group_tag IS NOT NULL AND group_tag != '' ORDER BY group_tag ASC"
    ) as any[];
    return NextResponse.json({ success: true, data: rows.map((r: any) => r.group_tag) });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export const GET = withAuth(handleGET);
