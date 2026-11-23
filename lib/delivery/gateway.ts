import {authorizedObject,type DeliveryConfig} from '../media-delivery.ts';

export interface OriginObject {
  body:ReadableStream<Uint8Array>|null;
  length:number;
  type:string;
  contentRange?:string;
}
export interface MediaOrigin {
  read(key:string,range?:string,head?:boolean):Promise<OriginObject>;
}
// Mount on a separate CDN gateway. All response paths are private and uncached.
// An edge may cache immutable origin bytes AFTER checking the grant and denylist.
export async function serveMedia(request:Request,config:DeliveryConfig,origin:MediaOrigin,
  site:string,edgeCountry:string|undefined,isRevoked:(sourceId:string)=>Promise<boolean>) {
  const headers=new Headers({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','Vary':'Origin'});
  const error=(status:number)=>new Response(null,{status,headers});
  const caller=request.headers.get('Origin');
  if(caller && caller!==site) return error(403);
  headers.set('Access-Control-Allow-Origin',site);
  headers.set('Access-Control-Expose-Headers','Content-Length, Content-Range, Accept-Ranges');
  if(request.method==='OPTIONS') {
    headers.set('Access-Control-Allow-Methods','GET, HEAD, OPTIONS');headers.set('Access-Control-Allow-Headers','Range');
    return error(204);
  }
  if(!['GET','HEAD'].includes(request.method)) return error(405);
  const grant=authorizedObject(new URL(request.url),edgeCountry,config);
  if(!grant)return error(403);
  try {
    if(await isRevoked(grant.sourceId)) return error(403);
    const range=request.headers.get('Range')??undefined;
    if(range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return error(416);
    const head=request.method==='HEAD';
    const object=await origin.read(grant.key,range,head);
    if(range && !object.contentRange) return error(502);
    headers.set('Content-Type',object.type);headers.set('Content-Length',String(object.length));
    headers.set('Accept-Ranges','bytes');
    if(object.contentRange) headers.set('Content-Range',object.contentRange);
    return new Response(head?null:object.body,{status:object.contentRange?206:200,headers});
  } catch(errorValue) {
    const status=(errorValue as {$metadata?:{httpStatusCode?:number}})?.$metadata?.httpStatusCode;
    return error(status===416?416:status===404?404:503);
  }
}
