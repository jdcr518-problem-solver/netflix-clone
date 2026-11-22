import HomeClient from '../components/HomeClient';
import {catalog} from '../lib/tmdb';
export const revalidate=3600;
export default async function Home(){const data=await catalog();return <HomeClient rows={data.rows} hero={data.hero} catalogError={data.error}/>;}
