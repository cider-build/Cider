import ViewerClient from "./ViewerClient";

export const metadata = { title: "Sandbox view — Cider" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ViewerClient sandboxId={id} />;
}
