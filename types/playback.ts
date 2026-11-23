export interface SubtitleSource { id: string; label: string; language: string; url: string }
export interface MediaSource { id: string; url?: string; format: 'mp4' | 'hls'; availability: 'available' | 'unavailable'; progressId?: string; subtitles: SubtitleSource[]; audioTracks?: {id:string;label:string;language:string}[]; quality?: {height:number}; label?: string; credit?: {text:string;origin:string;license:string;owner?:string;licenseName?:string;modificationNotice?:string} }
export interface Episode { id:string; season:number; number:number; title:string; duration?:string; nextEpisodeId?:string|null; source:MediaSource; sources?:MediaSource[] }
export interface PlaybackProgress { version:1; id:string; position:number; duration:number; completed:boolean; updatedAt:number }

export interface PlaybackOptions {
  availability: 'available' | 'unavailable';
  sources: MediaSource[];
  episodes: (Episode & {sources: MediaSource[]})[];
  artwork?: {poster?:string;backdrop?:string};
}
