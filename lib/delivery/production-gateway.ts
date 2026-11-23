import 'server-only';
import {S3Client} from '@aws-sdk/client-s3';
import {databasePool} from '../database/connection.ts';
import {validateRegistry} from '../registry-schema.ts';
import {trustedCountry} from '../package-rights.ts';
import {deliveryConfig} from '../media-delivery.ts';
import {productionConfig} from '../production-config.ts';
import {serveMedia} from './gateway.ts';
import {s3Origin} from './storage.ts';

// Instantiate only on the private Node media gateway behind the trusted edge.
// Mount on /v1/* before any cache. Only the validated package key reaches S3.
export function createProductionGateway() {
  productionConfig('gateway');
  const env=process.env;
  const client=new S3Client({endpoint:env.STREAMFRAME_STORAGE_ENDPOINT,region:env.STREAMFRAME_STORAGE_REGION,
    credentials:{accessKeyId:env.STREAMFRAME_STORAGE_ACCESS_KEY_ID!,secretAccessKey:env.STREAMFRAME_STORAGE_SECRET_ACCESS_KEY!,
      sessionToken:env.STREAMFRAME_STORAGE_SESSION_TOKEN}});
  const origin=s3Origin(client,env.STREAMFRAME_STORAGE_BUCKET!);
  const config=deliveryConfig();
  const site=env.STREAMFRAME_PLAYER_ORIGIN!;
  return {close:()=>client.destroy(),handle:(request:Request)=>serveMedia(request,config,origin,site,trustedCountry(request.headers),async(id,kind,tmdbId)=>{
    const db=await databasePool('reader').connect();
    try {
      const result=await db.query("SELECT record FROM streamframe.playback_records WHERE kind=$1 AND tmdb_id=$2 AND record->>'id'=$3",[kind,tmdbId,id]);
      return validateRegistry({version:1,sources:result.rows.map(row=>row.record)},'tmdb')[0];
    } finally {db.release();}
  })};
}
