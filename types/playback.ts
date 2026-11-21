export interface SubtitleSource { id: string; label: string; language: string; url: string }
export interface MediaSource { id: string; url?: string; format: 'mp4' | 'hls'; availability: 'available' | 'unavailable'; subtitles: SubtitleSource[]; audioTracks?: {id:string;label:string;language:string}[]; quality?: {height:number}; label?: string }
export interface Episode { id:string; season:number; number:number; title:string; duration?:string; source:MediaSource }
export interface PlaybackProgress { version:1; id:string; position:number; duration:number; completed:boolean; updatedAt:number }
