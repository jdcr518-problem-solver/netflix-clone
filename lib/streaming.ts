import { MediaSource, Episode } from '../types/playback';
export const RIGHTS_CLEARED_STREAMS: Record<string,string> = {
 default:'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
 tearsOfSteel:'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
 bigBuckBunny:'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
 elephantsDream:'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
 sintel:'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
};
export const unavailable = (id:string):MediaSource => ({id,format:'mp4',availability:'unavailable',subtitles:[]});
export const DEMO_MOVIE:MediaSource = {id:'demo-flower',url:RIGHTS_CLEARED_STREAMS.default,format:'mp4',availability:'available',label:'Flower — CC0 demonstration',subtitles:[{id:'en',label:'English demo captions',language:'en',url:'/subtitles/demo-en.vtt'},{id:'es',label:'Spanish demo captions',language:'es',url:'/subtitles/demo-es.vtt'}]};
export const DEMO_EPISODES:Episode[] = [
 {id:'demo-e1',season:1,number:1,title:'Flower study',duration:'5 seconds',source:{...DEMO_MOVIE,id:'demo-e1'}},
 {id:'demo-e2',season:1,number:2,title:'Big Buck Bunny — HLS sample',source:{id:'demo-e2',format:'hls',availability:'available',url:'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',subtitles:[]}},
 {id:'demo-e3',season:2,number:1,title:'Unavailable episode example',source:unavailable('demo-e3')},
];
// Catalog metadata does not grant playback rights. Demo sources live only in /player-demo.
export function sourceFor(id:number):MediaSource { return unavailable(`movie-${id}`); }
export function canPlay(id:number):boolean { return sourceFor(id).availability === 'available'; }
export function resolveStreamSource(id:number):MediaSource { return sourceFor(id); }
