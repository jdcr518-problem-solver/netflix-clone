import { NextResponse } from 'next/server';

export function middleware() {
  if (process.env.NODE_ENV !== 'development') return new NextResponse(null, {
    status:404, headers:{'Cache-Control':'no-store'},
  });
  return NextResponse.next();
}

export const config = {matcher:['/admin/sources/:path*','/api/admin/sources/:path*','/api/admin/providers/:path*','/api/admin/sync/:path*']};
