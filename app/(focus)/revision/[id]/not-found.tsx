import Link from "next/link";
export default function ReviewNotFound() {
  return <div className="mx-auto max-w-md px-6 py-24 text-center"><h1 className="text-xl font-semibold">Revision not found</h1><p className="mt-2 text-sm text-sub">It doesn&apos;t exist, or it isn&apos;t yours.</p><div className="mt-6 flex justify-center"><Link href="/revision" className="btn-primary">Back to revision queue</Link></div></div>;
}
