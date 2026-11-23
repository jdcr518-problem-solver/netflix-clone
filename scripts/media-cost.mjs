import {parseArgs} from 'node:util';
const {values}=parseArgs({options:Object.fromEntries(['movies','seasons','episodes','episode-min','movie-hours','viewers','hours','mbps','ladder-mbps','storage','transfer','read-million','write-million','encode-minute','hit-rate'].map(k=>[k,{type:'string'}]))});
function number(key,fallback,max=1e9){
  const n=Number(values[key]??fallback);
  if(!Number.isFinite(n)||n<0||n>max)throw Error('Invalid --'+key);
  return n;
}
const minutes=number('movies',100)*number('movie-hours',2)*60+number('seasons',0)*number('episodes',10)*number('episode-min',45);
const viewers=number('viewers',100),hours=number('hours',2),mbps=number('mbps',3);
const storageGB=minutes*60*number('ladder-mbps',8)/8000;
const transferGB=viewers*hours*3600*mbps/8000;
const segments=viewers*hours*600;
const writes=minutes*10*2; // two six-second muxed renditions
console.log(JSON.stringify({contentMinutes:minutes,storageGB,transferGB,sustainedMbps:viewers*mbps,
  segmentRequests:segments,estimatedOriginReads:segments*(1-number('hit-rate',0,1)),segmentWrites:writes,
  usdBeforeAllowances:{storagePerMonth:storageGB*number('storage',0.015),deliveryForWindow:transferGB*number('transfer',0),
    readsForWindow:segments*(1-number('hit-rate',0,1))*number('read-million',0.36)/1e6,
    initialWrites:writes*number('write-million',4.50)/1e6,initialEncoding:minutes*number('encode-minute',0)},
  streamMinutePricing:{storagePerMonth:5*Math.ceil(minutes/1000),deliveryForWindow:viewers*hours*60/1000}},null,2));
