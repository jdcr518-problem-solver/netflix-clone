import {S3Client,GetObjectCommand,HeadObjectCommand} from '@aws-sdk/client-s3';
import {Upload} from '@aws-sdk/lib-storage';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import type {MediaOrigin} from './gateway.ts';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareEdition,type Asset} from './package.ts';
export interface PrivateStorage {
  matches(key:string,asset:Asset):Promise<boolean>;
  put(key:string,path:string,asset:Asset):Promise<void>;
}
export function s3Storage(client:S3Client,bucket:string):PrivateStorage {
  return {
    async matches(key,asset) {
      try {
        const object=await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}));
        if(object.ContentLength!==asset.bytes || object.Metadata?.sha256!==asset.sha256) throw new Error('Private object conflict');
        return true;
      } catch(error) {if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404)return false;throw error;}
    },
    async put(key,path,asset) {
      async function* verifiedBytes() {
        const hash=createHash('sha256');
        for await(const chunk of createReadStream(path)) {hash.update(chunk);yield chunk;}
        if(hash.digest('hex')!==asset.sha256) throw new Error('Staging bytes changed during upload');
      }
      await new Upload({client,params:{Bucket:bucket,Key:key,Body:Readable.from(verifiedBytes()),ContentLength:asset.bytes,
        ContentType:asset.contentType,IfNoneMatch:'*',Metadata:{sha256:asset.sha256}},partSize:16*1024*1024,queueSize:2}).done();
    }
  };
}
// Operators keep staging immutable throughout preparation and transfer.
export async function stageEdition(store:PrivateStorage,directory:string,entry:string,duration:number,captions:string[]=[]) {
  const plan=await prepareEdition(directory,entry,duration,captions);
  for(const asset of plan.assets) {
    const key=plan.group+'/'+asset.name;
    if(!await store.matches(key,asset)) await store.put(key,join(directory,asset.name),asset);
  }
  return plan;
}
// Gateway-only origin access. Pass Range unchanged; S3 enforces 206/416.
export function s3Origin(client:S3Client,bucket:string):MediaOrigin {
  return {async read(key,range,head) {
    const input={Bucket:bucket,Key:key,Range:range};
    const object=head ? await client.send(new HeadObjectCommand(input)) : await client.send(new GetObjectCommand(input));
    return {body:'Body' in object && object.Body ? (object.Body as import('@aws-sdk/client-s3').GetObjectCommandOutput['Body'])!.transformToWebStream():null,
      length:object.ContentLength!,type:object.ContentType??'application/octet-stream',contentRange:object.ContentRange};
  }};
}
