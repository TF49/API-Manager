import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/guard';

// GET /api/history
async function handleGET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get('page') || 1);
    const limit = Number(searchParams.get('limit') || 20);
    const siteId = searchParams.get('site_id');
    const offset = (page - 1) * limit;

    let sql = 'SELECT h.*, s.name as site_name_live FROM call_history h LEFT JOIN sites s ON h.site_id = s.id';
    const params: any[] = [];
    if (siteId) { sql += ' WHERE h.site_id = ?'; params.push(siteId); }
    sql += ' ORDER BY h.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [rows] = await pool.query(sql, params) as any[];

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM call_history${siteId ? ' WHERE site_id = ?' : ''}`,
      siteId ? [siteId] : []
    ) as any[];

    return NextResponse.json({ success: true, data: rows, total, page, limit });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// DELETE /api/history - 清空历史
async function handleDELETE() {
  try {
    await pool.query('DELETE FROM call_history');
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export const GET = withAuth(handleGET);
export const DELETE = withAuth(handleDELETE);
