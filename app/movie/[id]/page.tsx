import { ContentDetailsPage } from '../../../components/ContentDetailsPage';

export default async function Page({params}: {params: Promise<{id: string}>}) {
  return <ContentDetailsPage type="movie" id={(await params).id} />;
}
