import type { MediaSource } from '../types/playback';

export default function FilmAttribution({title,credit}: {title:string;credit:NonNullable<MediaSource['credit']>}) {
  return <section aria-label="Film attribution" className="detail-muted">
    <p><strong>{title}</strong>{credit.owner && <> · {credit.owner}</>}</p>
    <p>{credit.text}</p>
    <p><a href={credit.license} target="_blank" rel="noreferrer">{credit.licenseName ?? 'License evidence'}</a>
      {' · '}<a href={credit.origin} target="_blank" rel="noreferrer">Original film</a></p>
    {credit.modificationNotice && <p>{credit.modificationNotice}</p>}
  </section>;
}
