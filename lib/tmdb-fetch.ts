import 'server-only';
const BASE='https://api.themoviedb.org/3';
type Raw=Record<string,any>;
export async function tmdb(path:string,params:Record<string,string>={},ttl=3600,signal?:AbortSignal):Promise<Raw>{
 const token=process.env.TMDB_READ_ACCESS_TOKEN;if(!token)throw new Error('Catalog is not configured.');
 const url=new URL(BASE+path);url.searchParams.set('language','en-US');Object.entries(params).forEach(([k,v])=>v ? url.searchParams.set(k,v) : url.searchParams.delete(k));
 try{const res=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),redirect:'error',next:{revalidate:ttl,tags:['tmdb-catalog']}});if(!res.ok)throw new Error(res.status===429?'Catalog is busy. Please try again shortly.':'Catalog is temporarily unavailable.');return await res.json();}catch(e){throw new Error(e instanceof Error&&e.message.startsWith('Catalog')?e.message:'Catalog is temporarily unavailable.');}
}
