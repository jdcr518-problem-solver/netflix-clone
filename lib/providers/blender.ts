import type { SubtitleSource } from '../../types/playback';

export interface ProviderFile { name: string; url: string; format: 'mp4'|'hls'; testStatus?: string }
export interface PublisherEdition {
  name:string;
  url:string;
  format:string;
  bytes:number;
}
export interface FilmCandidate {
  provider: 'blender'|'archive';
  id: string;
  title: string;
  year?: number;
  description: string;
  owner: string;
  director?: string;
  collections?: string[];
  runtime?: number;
  originalPage: string;
  licenseClaim?: string;
  evidence?: string;
  attribution?: string;
  creditsRequirement?: string;
  licenseUrl?: string;
  files: ProviderFile[];
  publisherEditions?: PublisherEdition[];
  subtitles: SubtitleSource[];
  subtitleNotes: string[];
  playbackNote: string;
}

const blender = [
  {
    id:'big-buck-bunny', title:'Big Buck Bunny', year:2008, director:'Sacha Goedegebure', runtime:10,
    description:'A rabbit responds to the antics of three forest bullies.',
    originalPage:'https://peach.blender.org/download/', evidence:'https://peach.blender.org/about/',
    licenseClaim:'CC BY 3.0', licenseUrl:'https://creativecommons.org/licenses/by/3.0/', creditsRequirement:'Keep the complete film credits and the Blender Foundation attribution. Review the exact edition before release.', attribution:'© 2008 Blender Foundation / www.bigbuckbunny.org',
    publisherEditions:[
      {name:'Peach original 320×180 MP4 ZIP',url:'https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4.zip',format:'MP4 in ZIP',bytes:64657225},
      {name:'Sunflower 1080p 30fps normal edition MP4 ZIP',url:'https://download.blender.org/demo/movies/BBB/bbb_sunflower_1080p_30fps_normal.mp4.zip',format:'MP4 in ZIP',bytes:275524128},
    ],
    url:'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', subtitleNotes:[],
  },
  {
    id:'sintel', title:'Sintel', year:2010, director:'Colin Levy', runtime:15,
    description:'A young woman searches for the dragon she rescued.',
    originalPage:'https://durian.blender.org/download/', evidence:'https://durian.blender.org/sharing/',
    licenseClaim:'CC BY 3.0', licenseUrl:'https://creativecommons.org/licenses/by/3.0/', creditsRequirement:'The publisher requires the complete credit scroll when screening or redistributing the film.',
    attribution:'© Blender Foundation / durian.blender.org',
    publisherEditions:[
      {name:'Durian second-render release 1080p MKV',url:'https://download.blender.org/durian/movies/Sintel.2010.1080p.mkv',format:'MKV',bytes:1180090590},
    ],
    url:'https://archive.org/download/Sintel/sintel-2048-stereo_512kb.mp4', subtitleNotes:[],
  },
  {
    id:'tears-of-steel', title:'Tears of Steel', year:2012, director:'Ian Hubert', runtime:12,
    description:'A team in a future Amsterdam recreates a moment from the past to stop a robot apocalypse.',
    originalPage:'https://mango.blender.org/download/', evidence:'https://mango.blender.org/about/',
    licenseClaim:'CC BY 3.0', licenseUrl:'https://creativecommons.org/licenses/by/3.0/', creditsRequirement:'Keep the complete credits and Blender Foundation attribution. Review any applicable performer portrait and privacy rights before reuse.', attribution:'© Blender Foundation / mango.blender.org',
    publisherEditions:[
      {name:'Mango first-render HD 1080p WebM, publisher-linked Xiph mirror',url:'https://media.xiph.org/tearsofsteel/tears_of_steel_1080p.webm',format:'WebM',bytes:571346576},
    ],
    url:'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
    alternate:'https://archive.org/download/Tears-of-Steel/tears_of_steel_720p.mp4',
    subtitleNotes:['Publisher-linked Xiph mirror lists SRT translations. They require separately verified rights and WebVTT conversion before registration.'],
  },
] as const;

export function blenderCandidate(id: string): FilmCandidate | undefined {
  const entry = blender.find(movie => movie.id === id);
  if (!entry) return;
  const {url,subtitleNotes,...metadata} = entry;
  const files:ProviderFile[] = [{name:'Full film (review stream)',url,format:url.endsWith('.mp4') ? 'mp4' : 'hls',testStatus:entry.id === 'tears-of-steel' ? 'Playback started during local QA. A seek stalled; prefer the MP4 for review.' : 'Played in local QA. Release playback and credit checks are pending.'}];
  if ('alternate' in entry) files.push({name:'Full film (Internet Archive MP4)',url:entry.alternate,format:'mp4',testStatus:'Played and sought during local QA. Release playback and credit checks are pending.'});
  return {...metadata,publisherEditions:[...entry.publisherEditions],collections:['blender-open-movies'],provider:'blender',owner:'Blender Foundation',subtitles:[],subtitleNotes:[...subtitleNotes],
    files,
    playbackNote:'Publisher editions are listed for staging and review. Confirm the exact edition and the playback host’s permission before import.'};
}

export function searchBlender(query: string) {
  return blender.filter(entry => entry.title.toLowerCase().includes(query.toLowerCase()))
    .map(({id,title,year}) => ({id,title,year}));
}
