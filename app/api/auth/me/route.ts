import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/guard';

// GET /api/auth/me - current user; 401 if the session is missing or expired
export const GET = withAuth(async (_req, _ctx, session) => {
  return NextResponse.json({
    success: true,
    data: { username: session.username, expires_at: session.expiresAt },
  });
});
