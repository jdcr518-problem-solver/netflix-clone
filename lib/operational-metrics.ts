type Counts={requests:number;denied:number;failures:number;bytes:number};
const fresh=():Counts=>({requests:0,denied:0,failures:0,bytes:0});

// Emit bounded-cardinality, process-local windows; a gateway can inject its own
// exporter. Byte counts represent successful response lengths, before disconnects.
export function mediaMeter(emit:(counts:Counts)=>void,now=Date.now) {
  let since=now(),counts=fresh();
  return (status:number,length=0)=>{
    counts.requests++;
    if(status===403) counts.denied++;
    if(status>=500) counts.failures++;
    if(Number.isSafeInteger(length) && length>0) counts.bytes+=length;
    if(now()-since>=60000 || counts.requests>=10000) {
      emit(counts);counts=fresh();since=now();
    }
  };
}
export const recordMedia=mediaMeter(counts=>console.info(JSON.stringify({event:'media_requests',...counts})));
