import {NextRequest,NextResponse} from 'next/server';
import {catalog,search,details,season,list,tmdb,titleLogo} from '../../../lib/tmdb';
export async function GET(req:NextRequest){const q=req.nextUrl.searchParams;const action=q.get('action')||'catalog';const type=q.get('type');const id=Number(q.get('id'));const page=Number(q.get('page')||1);if(!Number.isInteger(page)||page<1||page>500)return NextResponse.json({error:'Invalid page'},{status:400});try{
 if(action==='genres'&&(type==='movie'||type==='tv'))return NextResponse.json((await tmdb(`/genre/${type}/list`,{},86400)).genres);
 if(action==='discover'&&(type==='movie'||type==='tv')){const genre=Number(q.get('genre'));const allowed=(await tmdb(`/genre/${type}/list`,{},86400)).genres;if(!allowed.some((g:{id:number})=>g.id===genre))return NextResponse.json({error:'Invalid genre'},{status:400});return NextResponse.json(await list(`/discover/${type}`,type,{with_genres:String(genre),page:String(page),include_adult:'false'}));}
 if(action==='catalog')return NextResponse.json(await catalog());
 if(action==='search'){const text=(q.get('query')||'').trim().slice(0,150);return NextResponse.json(text?await search(text,String(page)):{items:[],page:1,totalPages:0});}
 if(action==='list'){const category=q.get('category')||'popular';if(!['movie','tv'].includes(type||'')||!['popular','top_rated','now_playing','upcoming'].includes(category)||(type==='tv'&&['now_playing','upcoming'].includes(category)))return NextResponse.json({error:'Invalid category'},{status:400});return NextResponse.json(await list(`/${type}/${category}`,type as 'movie'|'tv',{page:String(page)}));}
 if(!Number.isSafeInteger(id)||id<=0)return NextResponse.json({error:'Invalid title'},{status:400});
 if(action==='logo'&&(type==='movie'||type==='tv'))return NextResponse.json({logo:await titleLogo(type,id)});
 if(action==='details'&&(type==='movie'||type==='tv'))return NextResponse.json(await details(type,id));
 const n=Number(q.get('season'));if(action==='season'&&Number.isInteger(n)&&n>=0&&n<100)return NextResponse.json(await season(id,n));
 const episode=Number(q.get('episode'));if(action==='episode'&&Number.isInteger(n)&&n>=0&&n<100&&Number.isInteger(episode)&&episode>0&&episode<1000){const d=await tmdb(`/tv/${id}/season/${n}/episode/${episode}`);return NextResponse.json({id:`tv:${id}:season:${n}:episode:${episode}`,title:d.name,overview:d.overview,runtime:d.runtime});}
 return NextResponse.json({error:'Unknown request'},{status:400});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Catalog unavailable'},{status:503});}}
