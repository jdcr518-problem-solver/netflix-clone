'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main style={{padding:'100px 4%'}}><h1>Catalog temporarily unavailable</h1><button onClick={reset}>Try again</button></main>;}
