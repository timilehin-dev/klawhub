import { cookies } from 'next/headers';
import { verifyWorkspaceId } from '@/utils/session';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('kh_auth_session')?.value;
    const workspaceId = sessionCookie ? await verifyWorkspaceId(sessionCookie) : null;
    const isLoggedIn = !!workspaceId;

    return NextResponse.json({ isLoggedIn });
  } catch (error) {
    console.error('Error checking session:', error);
    return NextResponse.json({ isLoggedIn: false }, { status: 500 });
  }
}
