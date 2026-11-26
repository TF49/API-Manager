import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/guard';
import { schedulerStatus, startRunInBackground } from '@/lib/price-scheduler';

// GET /api/refresh - 同步状态：是否在运行、上次结果、下次时间
async function handleGET() {
  return NextResponse.json({ success: true, data: schedulerStatus() }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * POST /api/refresh - 在后台开始同步所有站点，立即返回。
 * 站点多时一轮可能要几分钟，同步等待会超过反向代理的超时；前端轮询 GET 直到 running 为 false。
 */
async function handlePOST() {
  const started = startRunInBackground();
  return NextResponse.json({ success: true, data: { started, status: schedulerStatus() } }, { status: started ? 202 : 200 });
}

export const GET = withAuth(handleGET);
export const POST = withAuth(handlePOST);
