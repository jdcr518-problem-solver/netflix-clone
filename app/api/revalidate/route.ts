import {revalidateTag} from 'next/cache';
import {NextRequest,NextResponse} from 'next/server';
export async function POST(req:NextRequest){if(process.env.NODE_ENV!=='development')return new NextResponse(null,{status:404});const origin=req.headers.get('origin');if(origin&&origin!==req.nextUrl.origin)return new NextResponse(null,{status:403});revalidateTag('tmdb-catalog');return NextResponse.json({revalidated:true});}
