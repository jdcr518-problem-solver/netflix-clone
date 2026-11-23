import {prepareEdition} from '../lib/delivery/package.ts';
const [dir,entry,seconds,...captions]=process.argv.slice(2);
if(!dir||!entry) throw new Error('Usage: media:plan -- <directory> <entry> <durationSeconds> [caption.vtt ...]');
console.log(JSON.stringify(await prepareEdition(dir,entry,Number(seconds),captions),null,2));
